export type DataChannelEvent = {
  id: number;
  type: "open" | "close" | "message";
  data?: ArrayBuffer;
};

export type DataChannel = {
  id: number;
  send(data: ArrayBuffer): void;
  close(): void;
};

import { server, channels, compile, instantiate, send } from "./wasm";

self.onmessage = (event) => {
  const data: DataChannelEvent | Uint8Array = event.data;

  if (data instanceof Uint8Array) {
    compile(data)
      .then(instantiate)
      .then(() => {
        self.postMessage({ type: "open" });
      })
      .catch((err) => {
        self.postMessage({ type: "error", message: err.message });
      });
    return;
  }

  switch (data.type) {
    case "open":
      const newChannel = {
        id: data.id,
        send: (message: ArrayBuffer) => {
          self.postMessage({ id: data.id, type: "message", data: message }, [
            message,
          ]);
        },
        close: () => {
          self.postMessage({ id: data.id, type: "close" });
        },
      };
      channels.set(data.id, newChannel as any);
      break;

    case "close":
      channels.delete(data.id);
      break;

    case "message":
      const channel = channels.get(data.id) as DataChannel | undefined;
      if (!channel || !server) return;
      send(channel.id, data.data!);
      break;
  }
};
