class Client {
  serverEndpoint: string;
  #channel: RTCDataChannel;

  constructor(serverEndpoint: string, serverAsm: () => Promise<ArrayBuffer>) {
    this.serverEndpoint = serverEndpoint;

    const conn = new RTCPeerConnection();
    this.#channel = conn.createDataChannel("main", {
      ordered: false,
    });
    conn.createOffer().then(async (offer) => {
      await conn.setLocalDescription(offer);

      const answer = await fetch(serverEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      }).then((res) => res.text());

      conn.setRemoteDescription({ type: "answer", sdp: answer });

      this.#channel.addEventListener("message", function (event) {
        if (typeof event.data !== "string") return;
        const data = event.data;
        const { status } = JSON.parse(data);
        if (status === 404) {
          serverAsm().then((bytes) => {
            const wasmChannel = conn.createDataChannel("wasm");
            wasmChannel.onopen = () => {
              wasmChannel.send(bytes.byteLength.toString());
              const CHUNK_SIZE = 16384;
              for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
                wasmChannel.send(bytes.slice(i, i + CHUNK_SIZE));
              }
            };
          });
        }
      });
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
