// Store WebRTC connections
export const server: {
  hash: string | null;
  size: number | null;
} = { hash: null, size: null };

export const connections: Record<
  number,
  { peerConnection: RTCPeerConnection; dataChannel: RTCDataChannel | null }
> = {};

let channelCounter = 0; // 0, 1, 2 are reserved for stdin, stdout, stderr

export function allocateChannel(): number {
  channelCounter++;
  return channelCounter;
}

export const HOST = "127.0.0.1:5794";
