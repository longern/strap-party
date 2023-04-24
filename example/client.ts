class Client {
  serverEndpoint: string;
  serverAsm: () => Promise<ArrayBuffer>;

  constructor(serverEndpoint: string, serverAsm: () => Promise<ArrayBuffer>) {
    this.serverEndpoint = serverEndpoint;
    this.serverAsm = serverAsm;

    const conn = new RTCPeerConnection();
    const channel = conn.createDataChannel("main", {
      ordered: false,
    });
    conn.createOffer().then(async (offer) => {
      await conn.setLocalDescription(offer);

      const answer = await fetch("http://localhost:5794/", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: conn.localDescription!.sdp,
      }).then((res) => res.text());

      conn.setRemoteDescription({ type: "answer", sdp: answer });

      channel.addEventListener("message", function (event) {
        console.log(event.data);
        const data = event.data as string;
        const { status } = JSON.parse(data);
        if (status === 404) {
          serverAsm().then((bytes) => this.send(bytes));
        }
      });
    });
  }
}

export { Client };
