interface DataChannelEventMap {
  message: MessageEvent;
  send: MessageEvent;
  beforeclose: Event;
  close: Event;
}

export class DataChannel extends EventTarget {
  send(data: ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("send", { data }));
  }

  close() {
    this.dispatchEvent(new Event("beforeclose"));
  }
}

export interface DataChannel {
  addEventListener<K extends keyof DataChannelEventMap>(
    event: K,
    listener: (ev: DataChannelEventMap[K]) => void
  ): void;

  removeEventListener<K extends keyof DataChannelEventMap>(
    event: K,
    listener: (ev: DataChannelEventMap[K]) => void
  ): void;
}

export class DataChannelEvent extends Event {
  channel: DataChannel;
  constructor(type: string, eventInitDict: { channel: DataChannel }) {
    super(type);
    this.channel = eventInitDict.channel;
  }
}

interface SocketEventMap {
  datachannel: DataChannelEvent;
  close: Event;
}

export class Socket extends EventTarget {}

export interface Socket {
  addEventListener<K extends keyof SocketEventMap>(
    event: K,
    listener: (ev: SocketEventMap[K]) => void
  ): void;

  removeEventListener<K extends keyof SocketEventMap>(
    event: K,
    listener: (ev: SocketEventMap[K]) => void
  ): void;
}
