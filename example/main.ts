const conn = new RTCPeerConnection();
conn.createDataChannel("main", {
  ordered: false,
});
const offer = await conn.createOffer();
await conn.setLocalDescription(offer);

const answer = await fetch("http://localhost:5794/", {
  method: "POST",
  headers: { "Content-Type": "application/sdp" },
  body: conn.localDescription!.sdp,
}).then((res) => res.text());

conn.setRemoteDescription({ type: "answer", sdp: answer });

export {};
