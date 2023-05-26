interface WASIExports {
  memory: WebAssembly.Memory;
  _start(): void;
}

export interface FileDescriptor {
  close?(): void;
  read?(): ArrayBuffer;
  ready?(): Promise<void>;
  write?(buffer: ArrayBuffer): void;
}

export class WASI {
  args: string[];
  env: Record<string, string>;
  exports!: WASIExports;
  fds: Map<number, FileDescriptor>;

  constructor(options?: { args?: string[]; env?: Record<string, string> }) {
    const args = options?.args ?? [];
    const env = options?.env ?? {};

    this.args = args;
    this.env = env;
    this.fds = new Map();

    this.fds.set(1, {
      write: (buffer: ArrayBuffer) => {
        console.log(buffer);
      },
    });

    this.fds.set(2, {
      write: (buffer: ArrayBuffer) => {
        console.error(buffer);
      },
    });
  }

  getWasiImports() {
    const builtins = {
      fd_close: (fd: number) => {
        const fdEntry = this.fds.get(fd);
        if (!fdEntry) return -1;
        fdEntry.close?.();
        this.fds.delete(fd);
        return 0;
      },

      fd_read: (fd: number, iovs: number, iovsLen: number, nread: number) => {
        const fdEntry = this.fds.get(fd);
        if (!fdEntry) return -1;
        let data: ArrayBuffer | undefined;
        try {
          data = fdEntry.read!();
        } catch (err) {
          console.error(err);
          return -1;
        }

        const buffer = new Uint8Array(
          this.exports.memory.buffer,
          iovs,
          iovsLen
        );
        if (data.byteLength > buffer.byteLength) return -1;
        const result = data.byteLength;
        buffer.set(new Uint8Array(data));

        if (nread) {
          const view = new DataView(this.exports.memory.buffer, nread, 4);
          view.setUint32(0, result, true);
        }
        return 0;
      },

      fd_write: (
        fd: number,
        iovs: number,
        iovsLen: number,
        nwritten: number
      ) => {
        const fdEntry = this.fds.get(fd);
        if (!fdEntry) return -1;
        const buffer = this.exports.memory.buffer.slice(iovs, iovs + iovsLen);
        const result = fdEntry.write?.(buffer);
        if (result === undefined) return -1;
        if (nwritten === 0) {
          const view = new DataView(this.exports.memory.buffer, nwritten, 4);
          view.setUint32(0, result, true);
        }
        return 0;
      },

      poll_async: (fds: number, nfds: number, rp0: number) => {
        const fdArray = new Uint32Array(this.exports.memory.buffer, fds, nfds);
        const promises = [];
        for (let i = 0; i < nfds; i++) {
          const fd = fdArray[i];
          const fdEntry = this.fds.get(fd);
          if (!fdEntry?.ready) return -1;
          promises.push(fdEntry.ready().then(() => fd));
        }
        Promise.race(promises).then((fd) => {
          const view = new DataView(this.exports.memory.buffer, rp0, 4);
          view.setUint32(0, fd, true);
          this.exports._start();
        });
        return 0;
      },

      random_get: (buffer: number, length: number) => {
        crypto.getRandomValues(
          new Uint8Array(this.exports.memory.buffer, buffer, length)
        );
        return 0;
      },

      timer_create: (ms: number) => {
        const newFd = Math.max(...this.fds.keys()) + 1;
        let resolve: () => void;
        let promise: Promise<void> = new Promise((res) => (resolve = res));
        const interval = window.setInterval(() => resolve(), ms);
        this.fds.set(newFd, {
          close: () => window.clearInterval(interval),
          ready: () => promise,
          read: () => {
            promise = new Promise((res) => (resolve = res));
            return new Uint8Array([0]).buffer;
          },
        });
        return newFd;
      },
    };

    return {
      wasi_snapshot_preview1: builtins as typeof builtins &
        Record<string, WebAssembly.ImportValue>,
    };
  }

  start(instance: WebAssembly.Instance) {
    this.exports = instance.exports as any;
    if (!this.exports.memory) throw new Error("No memory exported");
    this.exports._start();
  }
}
