import { Router } from "itty-router";

const router = Router();
const resources: Record<
  string,
  { peerConnection: RTCPeerConnection; dataChannel: RTCDataChannel | null }
> = {};

router.post("/", async (req, env) => {
  const offer: string = await req.text();
  const peerConnection = new RTCPeerConnection();
  const resourceId = crypto.randomUUID();
  resources[resourceId] = { peerConnection, dataChannel: null };

  peerConnection.addEventListener("datachannel", (event) => {
    resources[resourceId].dataChannel = event.channel;
  });

  peerConnection.setRemoteDescription({ type: "offer", sdp: offer });
  let answer = await peerConnection.createAnswer();
  peerConnection.setLocalDescription(answer);
  if (env.PUBLIC_IP) {
    // Replace local mDNS hostname with public IP.
    answer.sdp = answer.sdp!.replace(/[A-Za-z0-9-]+\.local/g, env.PUBLIC_IP);
  }

  const origin = new URL(req.url).origin;
  return new Response(answer.sdp, {
    status: 201,
    headers: {
      "Content-Type": "application/sdp",
      Location: `${origin}/resource/${resourceId}`,
    },
  });
});

router.all("/", () => new Response("Method Not Allowed", { status: 405 }));

router.all("*", () => new Response("Not Found", { status: 404 }));

export default router;
