export let serverModule: WebAssembly.Module | null = null;
export let server: GameServer | null = null;
export let messageBuffer: [number, ArrayBuffer][] = [];
export const channels: Map<number, RTCDataChannel> = new Map();

interface GameServer {
  memory: WebAssembly.Memory;
  _start?(): void;
  onopen?(channelId: number): void;
  onmessage(channelId: number, length: number): void;
  onclose?(channelId: number): void;
}

const env = {
  recv(id: number, begin: number, length: number) {
    const [channelId, data] = messageBuffer.shift()!;

    if (channelId !== id) {
      console.error(`Channel ID mismatch: ${channelId} !== ${id}`);
      return -1;
    }

    if (data.byteLength > length) {
      console.error(
        `Received ${data.byteLength} bytes, but only ${length} bytes are available`
      );
      return -1;
    }

    const serverMemory = new Uint8Array(
      server!.memory.buffer,
      begin,
      begin + length
    );
    serverMemory.set(new Uint8Array(data));
    return data.byteLength;
  },

  send(id: number, begin: number, length: number) {
    const buffer = server!.memory.buffer.slice(begin, begin + length);
    const channel = channels.get(id);
    if (!channel) {
      console.error(`Channel ${id} not found`);
      return -1;
    }
    channel.send(buffer);
    return 0;
  },

  close(id: number) {
    const channel = channels.get(id);
    if (!channel) {
      console.error(`Channel ${id} not found`);
      return -1;
    }
    channel.close();
    return 0;
  },
};

export async function compile(data: ArrayBuffer) {
  serverModule = await WebAssembly.compile(data);
  return serverModule;
}

export async function instantiate() {
  const serverInstance = await WebAssembly.instantiate(serverModule!, { env });
  server = serverInstance.exports as unknown as GameServer;
  server._start?.();
  return server;
}

export async function send(channelId: number, data: ArrayBuffer) {
  if (!server) throw new Error("Server not instantiated");
  messageBuffer.push([channelId, data]);
  server.onmessage(channelId, data.byteLength);
}
