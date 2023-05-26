import { Router, RequestLike } from "itty-router";
import { createCors } from "itty-cors";
import { allocateChannel, connections as resources, server } from "./state";
export let worker: Worker | null = null;

const { preflight, corsify } = createCors({ methods: ["*"] });

const router = Router();

async function waitToCompleteICEGathering(peerConnection: RTCPeerConnection) {
  return new Promise<RTCSessionDescriptionInit>((resolve) => {
    /** Wait at most 1 second for ICE gathering. */
    setTimeout(function () {
      resolve(peerConnection.localDescription!);
    }, 1000);
    peerConnection.onicegatheringstatechange = (_ev) =>
      peerConnection.iceGatheringState === "complete" &&
      resolve(peerConnection.localDescription!);
  });
}

router.all("*", preflight as any);

function handleWasmDataChannel(channel: RTCDataChannel) {
  const workerUrl = new URL("./worker.ts", import.meta.url);
  worker = new Worker(workerUrl, { type: "module" });

  function handler(event: MessageEvent) {
    if (["open", "error"].includes(event.data.type)) {
      if (event.data.type === "error") console.error(event.data.message);
      channel.close();
      worker!.removeEventListener("message", handler);
    }
  }

  worker.addEventListener("message", handler);

  channel.binaryType = "arraybuffer";
  let fileLength = 0;
  let accumulatedLength = 0;
  const buffer: ArrayBuffer[] = [];

  channel.addEventListener("message", function (event) {
    const data = event.data as ArrayBuffer;
    if (typeof data === "string") {
      fileLength = parseInt(data);
      return;
    }
    buffer.push(data);
    accumulatedLength += data.byteLength;
    if (accumulatedLength >= fileLength) {
      // Merge all buffers
      const bytes = new Uint8Array(accumulatedLength);
      let offset = 0;
      for (const buf of buffer) {
        bytes.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
      server.size = bytes.byteLength;

      // Hash the buffer
      crypto.subtle.digest("SHA-256", bytes).then((hash) => {
        const hashHex = Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        console.log(`WASM hash: ${hashHex}`); // eslint-disable-line no-console
        server.hash = hashHex;
      });

      worker!.postMessage(bytes);
    }
  });
}

function handleDataChannel(resourceId: number, channel: RTCDataChannel) {
  channel.binaryType = "arraybuffer";

  function handleWorkerMessage(event: MessageEvent) {
    const data = event.data as {
      id: number;
      type: "open" | "message" | "close";
      data?: ArrayBuffer;
    };
    if (data.id !== resourceId) return;
    if (data.type === "message") channel.send(data.data!);
    else if (data.type === "close") channel.close();
  }
  worker?.addEventListener("message", handleWorkerMessage);

  channel.addEventListener("open", function () {
    worker?.postMessage({ id: resourceId, type: "open" });
  });

  channel.addEventListener("message", async function (event) {
    const data = event.data as ArrayBuffer;
    worker?.postMessage({ id: resourceId, type: "message", data }, [data]);
  });

  channel.addEventListener("close", function () {
    worker?.postMessage({ id: resourceId, type: "close" });
    worker?.removeEventListener("message", handleWorkerMessage);
  });
}

router.post("/", async (req, env) => {
  const offer: string = await req.text();
  const peerConnection = new RTCPeerConnection();
  const mainChannel = peerConnection.createDataChannel("main", {
    negotiated: true,
    id: 0,
    ordered: false,
  });
  const resourceId = allocateChannel();
  resources[resourceId] = { peerConnection, dataChannel: mainChannel };

  if (!worker) {
    const wasmChannel = peerConnection.createDataChannel("wasm");
    handleWasmDataChannel(wasmChannel);
  }

  handleDataChannel(resourceId, mainChannel);

  peerConnection.addEventListener("connectionstatechange", function () {
    if (["failed", "closed"].includes(peerConnection.connectionState)) {
      delete resources[resourceId];
    }
  });

  peerConnection.setRemoteDescription({ type: "offer", sdp: offer });
  let answer = await peerConnection.createAnswer();
  peerConnection.setLocalDescription(answer);
  answer = await waitToCompleteICEGathering(peerConnection);
  if (env.PUBLIC_IP) {
    // Replace local mDNS hostname with public IP.
    answer.sdp = answer.sdp!.replace(/[A-Za-z0-9-]+\.local/g, env.PUBLIC_IP);
  }

  const origin = new URL(req.url).origin;
  const headers = new Headers({
    "Content-Type": "application/sdp",
    Location: `${origin}/resource/${resourceId}`,
  });
  return new Response(answer.sdp, { status: 201, headers });
});

router.all("/", () => new Response("Method Not Allowed", { status: 405 }));

router.all("*", () => new Response("Not Found", { status: 404 }));

export default {
  fetch: (request: RequestLike, ...args: any) =>
    router.handle(request, ...args).then(corsify),
};
