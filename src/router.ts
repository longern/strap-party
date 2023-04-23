import { Router, RequestLike } from "itty-router";
import { createCors } from "itty-cors";

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

router.post("/", async (req, env) => {
  const offer: string = await req.text();
  const peerConnection = new RTCPeerConnection();
  const resourceId = crypto.randomUUID();
  resources[resourceId] = { peerConnection, dataChannel: null };

  peerConnection.addEventListener("datachannel", (event) => {
    resources[resourceId].dataChannel = event.channel;
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
