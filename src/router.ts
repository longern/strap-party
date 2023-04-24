import { Router, RequestLike } from "itty-router";
import { createCors } from "itty-cors";

const { preflight, corsify } = createCors({ methods: ["*"] });

const router = Router();
const resources: Record<
  string,
  { peerConnection: RTCPeerConnection; dataChannel: RTCDataChannel | null }
> = {};
let serverAsm: WebAssembly.WebAssemblyInstantiatedSource | null = null;

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

interface GameServer {
  memory: WebAssembly.Memory;
  ondatachannel(channelId: number): void;
  onmessage(channelId: number, buffer: number, length: number): void;
}

function send(id: number, begin: number, length: number) {
  const exports = serverAsm?.instance.exports as unknown as GameServer;
  const buffer = exports.memory.buffer.slice(begin, length);
  channels[id].send(buffer);
}

const channels: Record<number, RTCDataChannel> = {};
function handleDataChannel(channel: RTCDataChannel) {
  // Max id in channels.
  const id = Object.keys(channels).reduce((a, b) => Math.max(a, +b), 0) + 1;
  channels[id] = channel;

  channel.binaryType = "arraybuffer";
  if (!serverAsm) {
    channel.send(JSON.stringify({ status: 404 }));
  } else {
    channel.send(JSON.stringify({ status: 200 }));
  }

  function onopen() {
    if (!serverAsm) return;
    const exports = serverAsm?.instance.exports as unknown as GameServer;
    exports.ondatachannel(id);
  }

  onopen();

  channel.addEventListener("message", async function (event) {
    const data = event.data as ArrayBuffer;
    if (!serverAsm) {
      try {
        serverAsm = await WebAssembly.instantiate(data, { env: { send } });
        onopen();
        this.send(JSON.stringify({ status: 204 }));
      } catch (e: any) {
        this.send(JSON.stringify({ status: 400, message: e.message }));
      }
    } else {
      const exports = serverAsm?.instance.exports as unknown as GameServer;
      const array = new Uint8Array(exports.memory.buffer, 0, data.byteLength);
      array.set(new Uint8Array(data));
      exports.onmessage(id, array.byteOffset, array.length);
    }
  });
}

router.post("/", async (req, env) => {
  const offer: string = await req.text();
  const peerConnection = new RTCPeerConnection();
  const resourceId = crypto.randomUUID();
  resources[resourceId] = { peerConnection, dataChannel: null };

  peerConnection.addEventListener("datachannel", (event) => {
    resources[resourceId].dataChannel = event.channel;
    handleDataChannel(event.channel);
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
