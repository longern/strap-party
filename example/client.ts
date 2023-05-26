class Client {
  serverEndpoint: string;
  #channel: RTCDataChannel;

  constructor(serverEndpoint: string, serverAsm: () => Promise<ArrayBuffer>) {
    this.serverEndpoint = serverEndpoint;

    const conn = new RTCPeerConnection();
    this.#channel = conn.createDataChannel("main", {
      negotiated: true,
      id: 0,
      ordered: false,
    });

    conn.addEventListener("datachannel", async (event) => {
      if (event.channel.label !== "wasm") return;
      const bytes = await serverAsm();
      event.channel.send(bytes.byteLength.toString());
      const CHUNK_SIZE = 16384;
      for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
        event.channel.send(bytes.slice(i, i + CHUNK_SIZE));
      }
    });

    conn.createOffer().then(async (offer) => {
      await conn.setLocalDescription(offer);

      const answer = await fetch(serverEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      }).then((res) => res.text());

      conn.setRemoteDescription({ type: "answer", sdp: answer });
    });
  }

  send(data: ArrayBuffer) {
    this.#channel.send(data);
  }

  onmessage(callback: (data: ArrayBuffer) => void) {
    const callbackWrapper = (event: MessageEvent) => {
      if (typeof event.data === "string") return;
      callback(event.data as ArrayBuffer);
    };
    this.#channel.addEventListener("message", callbackWrapper);
    return () => {
      this.#channel.removeEventListener("message", callbackWrapper);
    };
  }
}

export { Client };
