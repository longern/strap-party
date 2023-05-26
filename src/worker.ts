import { WASI } from "./wasm";

declare const self: DedicatedWorkerGlobalScope;

export type DataChannelEvent = {
  id: number;
  type: "open" | "close" | "message";
  data?: ArrayBuffer;
};

class DataChannel extends EventTarget {
  send(data: ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("send", { data }));
  }

  close() {
    this.dispatchEvent(new Event("close"));
  }
}

class PeerConnection extends EventTarget {
  createDataChannel() {
    const channel = new DataChannel();
    this.dispatchEvent(new CustomEvent("datachannel", { detail: channel }));
    return channel;
  }
}

let peerConnection = new PeerConnection();
const channelMap = new Map<number, DataChannel>();

function getSocketImport(wasi: WASI, conn: PeerConnection) {
  let socketResolve: (() => void) | null = null;
  const pendingConnections: number[] = [];

  conn.addEventListener("datachannel", (event) => {
    const fd = Math.max(...wasi.fds.keys()) + 1;
    const channel = (event as CustomEvent).detail as DataChannel;
    const messageBuffer: ArrayBuffer[] = [];
    let messageResolve: () => void;
    let messagePromise: Promise<void> = new Promise((resolve) => {
      messageResolve = resolve;
    });

    channel.addEventListener("message", (event) => {
      const data = (event as MessageEvent).data as ArrayBuffer;
      messageBuffer.push(data);
      messageResolve();
    });

    wasi.fds.set(fd, {
      read: () => {
        const data = messageBuffer.shift();
        if (!data) throw new Error("No data");
        if (messageBuffer.length === 0) {
          messagePromise = new Promise((resolve) => (messageResolve = resolve));
        }
        return data;
      },
      write: (buffer: ArrayBuffer) => {
        channel.send(buffer);
      },
      ready: () => messagePromise,
    });
    pendingConnections.push(fd);
    socketResolve?.();
  });

  return {
    sock_open(_addrFamily: number, _socketType: number, fdPtr: number): number {
      let socketPromise = new Promise<void>((resolve) => {
        socketResolve = resolve;
      });

      const fd = Math.max(...wasi.fds.keys()) + 1;
      wasi.fds.set(fd, {
        read: () => {
          const socket = pendingConnections.shift();
          if (!socket) throw new Error("No pending connections");
          if (pendingConnections.length === 0) {
            socketPromise = new Promise((resolve) => (socketResolve = resolve));
          }
          return new Uint8Array([socket]).buffer;
        },
        ready: () => socketPromise,
      });

      if (fdPtr) {
        const view = new DataView(wasi.exports.memory.buffer, fdPtr, 4);
        view.setInt32(0, fd, true);
      }

      return 0;
    },
  };
}

self.onmessage = (event) => {
  const data: DataChannelEvent | Uint8Array = event.data;

  if (data instanceof Uint8Array) {
    const wasi = new WASI();
    const wasiImports = wasi.getWasiImports();

    const socketImports = getSocketImport(wasi, peerConnection);

    Object.assign(wasiImports.wasi_snapshot_preview1, socketImports);

    WebAssembly.compile(data)
      .then((wasmModule) => WebAssembly.instantiate(wasmModule, wasiImports))
      .then((wasiInstance) => {
        wasi.start(wasiInstance);
        for (const channel of channelMap.values()) {
          peerConnection.dispatchEvent(
            new CustomEvent("datachannel", { detail: channel })
          );
        }
        self.postMessage({ type: "open" });
      });
    return;
  }

  switch (data.type) {
    case "open": {
      const channelId = data.id;
      const channel = peerConnection.createDataChannel();
      channel.addEventListener("send", (event) => {
        const data = (event as MessageEvent).data as ArrayBuffer;
        self.postMessage({ type: "message", id: channelId, data }, [data]);
      });
      channelMap.set(channelId, channel);
      break;
    }

    case "close": {
      const channel = channelMap.get(data.id);
      if (!channel) return;
      channel.dispatchEvent(new Event("close"));
      channelMap.delete(data.id);
      break;
    }

    case "message": {
      const channel = channelMap.get(data.id);
      if (!channel) return;
      channel.dispatchEvent(new MessageEvent("message", { data: data.data }));
      break;
    }
  }
};
