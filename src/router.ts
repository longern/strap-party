import { Router, RequestLike } from "itty-router";
import { createCors } from "itty-cors";

import { server, channels, compile, instantiate, send } from "./wasm";

const { preflight, corsify } = createCors({ methods: ["*"] });

const router = Router();
const resources: Record<
  string,
  { peerConnection: RTCPeerConnection; dataChannel: RTCDataChannel | null }
> = {};

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
      channel.close();
    }
  });

  channel.addEventListener("close", async function () {
    // Merge all buffers
    const bytes = new Uint8Array(
      buffer.reduce((acc, cur) => acc + cur.byteLength, 0)
    );
    let offset = 0;
    for (const buf of buffer) {
      bytes.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    // Hash the buffer
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const hashHex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    console.log(`WASM hash: ${hashHex}`);

    await compile(bytes.buffer);
    await instantiate();
  });
}

function handleDataChannel(channel: RTCDataChannel) {
  const id = Math.max(...channels.keys(), 0) + 1;
  channels.set(id, channel);

  channel.binaryType = "arraybuffer";
  if (!server) {
    channel.send(JSON.stringify({ status: 404 }));
  } else {
    channel.send(JSON.stringify({ status: 200 }));
  }

  server?.onopen?.(id);

  channel.addEventListener("message", async function (event) {
    send(id, event.data as ArrayBuffer);
  });

  channel.addEventListener("close", function () {
    server!.onclose?.(id);
  });
}

router.post("/", async (req, env) => {
  const offer: string = await req.text();
  const peerConnection = new RTCPeerConnection();
  const resourceId = crypto.randomUUID();
  resources[resourceId] = { peerConnection, dataChannel: null };

  peerConnection.addEventListener("datachannel", (event) => {
    resources[resourceId].dataChannel = event.channel;
    if (event.channel.label === "wasm") handleWasmDataChannel(event.channel);
    else handleDataChannel(event.channel);
  });

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
