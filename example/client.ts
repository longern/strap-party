class Client {
  serverEndpoint: string;
  serverAsm: () => Promise<ArrayBuffer>;
  channel: RTCDataChannel;

  constructor(serverEndpoint: string, serverAsm: () => Promise<ArrayBuffer>) {
    this.serverEndpoint = serverEndpoint;
    this.serverAsm = serverAsm;

    const conn = new RTCPeerConnection();
    this.channel = conn.createDataChannel("main", {
      ordered: false,
    });
    conn.createOffer().then(async (offer) => {
      await conn.setLocalDescription(offer);

      const answer = await fetch(serverEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: conn.localDescription!.sdp,
      }).then((res) => res.text());

      conn.setRemoteDescription({ type: "answer", sdp: answer });

      this.channel.addEventListener("message", function (event) {
        if (typeof event.data !== "string") return;
        const data = event.data;
        const { status } = JSON.parse(data);
        if (status === 404) {
          serverAsm().then((bytes) => this.send(bytes));
        }
      });
    });
  }

  send(data: ArrayBuffer) {
    this.channel.send(data);
  }

  onmessage(callback: (data: ArrayBuffer) => void) {
    this.channel.addEventListener("message", function (event) {
      if (typeof event.data === "string") return;
      callback(event.data as ArrayBuffer);
    });
  }
}

export { Client };
