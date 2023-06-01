import express from "express";
import cors from "cors";
import crypto from "crypto";
import nodeDataChannel from "node-datachannel";
import { WASI } from "./wasm.ts";
import { DataChannel, DataChannelEvent, Socket } from "./types.ts";

const app = express();
app.use(cors());
app.use(express.text({ type: "application/sdp" }));

let socket = new Socket();
let server: any = null;

function polyfillDataChannel(channel: nodeDataChannel.DataChannel) {
  const channelTarget = new DataChannel();
  channelTarget.addEventListener("send", (event) => {
    if (typeof event.data === "string") channel.sendMessage(event.data);
    else channel.sendMessageBinary(Buffer.from(event.data));
  });
  channelTarget.addEventListener("beforeclose", () => {
    channel.close();
    // Closing channel manually will not trigger the close event
    channelTarget.dispatchEvent(new Event("close"));
  });
  channel.onMessage((data) => {
    const buffer = typeof data === "string" ? data : Buffer.from(data);
    channelTarget.dispatchEvent(new MessageEvent("message", { data: buffer }));
  });
  channel.onClosed(() => channelTarget.dispatchEvent(new Event("close")));
  return channelTarget;
}

function getSocketImport(wasi: WASI, socket: Socket) {
  let socketResolve: (() => void) | null = null;
  const pendingConnections: number[] = [];

  function handleMainChannel(event: DataChannelEvent) {
    const channel = event.channel;
    const fd = Math.max(...wasi.fds.keys()) + 1;
    const messageBuffer: ArrayBuffer[] = [];
    let messageResolve: () => void;
    let messagePromise: Promise<void> = new Promise((resolve) => {
      messageResolve = resolve;
    });

    function handleMessage(event: MessageEvent) {
      const message = event.data;
      if (typeof message === "string") return;
      messageBuffer.push(message);
      messageResolve();
    }

    channel.addEventListener("message", handleMessage);
    channel.addEventListener("close", function handleClose() {
      channel.removeEventListener("message", handleMessage);
      channel.removeEventListener("close", handleClose);
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
        channel.send(Buffer.from(buffer));
      },
      ready: () => messagePromise,
    });
    pendingConnections.push(fd);
    socketResolve?.();
  }

  socket.addEventListener("datachannel", handleMainChannel);

  const imports = {
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

  return imports;
}

function handleWasmDataChannel(channel: DataChannel) {
  server = { hash: null, size: null };
  let fileLength = 0;
  let accumulatedLength = 0;
  const buffer: ArrayBuffer[] = [];
  const hash = crypto.createHash("sha256");

  channel.addEventListener("message", (event) => {
    const data = event.data;
    if (typeof data === "string") {
      fileLength = parseInt(data);
      return;
    }
    buffer.push(data);
    hash.write(data);
    accumulatedLength += data.byteLength;
    if (accumulatedLength < fileLength) return;

    // Merge all buffers
    const bytes = new Uint8Array(accumulatedLength);
    let offset = 0;
    for (const buf of buffer) {
      bytes.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    server.size = bytes.byteLength;

    // Hash the buffer
    console.log(`WASM hash: ${hash.digest("hex")}`);

    WebAssembly.compile(bytes)
      .then(async (wasmModule) => {
        const wasi = new WASI();
        const imports = wasi.getWasiImports();
        const socketImports = getSocketImport(wasi, socket);
        Object.assign(imports.wasi_snapshot_preview1, socketImports);
        const instance = await WebAssembly.instantiate(wasmModule, imports);
        server.instance = instance;
        wasi.start(instance);
      })
      .finally(() => {
        channel.close();
      });
  });
}

app.post("/", async (req, res) => {
  if (req.body === undefined) {
    res.status(400).end("Bad request");
    return;
  }

  const offer = req.body;

  const conn = new nodeDataChannel.PeerConnection(crypto.randomUUID(), {
    iceServers: [],
  });

  function handleDataChannel(channel: nodeDataChannel.DataChannel) {
    socket.dispatchEvent(
      new DataChannelEvent("datachannel", {
        channel: polyfillDataChannel(channel),
      })
    );
  }

  const mainChannel = conn.createDataChannel("main", {
    negotiated: true,
    id: 0,
    ordered: false,
  });

  if (!server) {
    const wasmChannel = conn.createDataChannel("wasm");
    const wasmChannelTarget = polyfillDataChannel(wasmChannel);
    wasmChannel.onOpen(() => {
      handleWasmDataChannel(wasmChannelTarget);
      wasmChannelTarget.addEventListener("close", () => {
        handleDataChannel(mainChannel);
      });
    });
  } else {
    mainChannel.onOpen(() => handleDataChannel(mainChannel));
  }

  conn.setRemoteDescription(offer, "offer" as nodeDataChannel.DescriptionType);

  const desc = await new Promise((resolve) => {
    setTimeout(() => {
      resolve(conn.localDescription()?.sdp);
    }, 4);
  });

  res.setHeader("content-type", "application/sdp");
  res.status(201).send(desc);
  res.end();
});

app.listen(5794, () => {
  console.log("Listening on http://localhost:5794");
});
