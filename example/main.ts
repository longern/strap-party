import { Client } from "./client";

async function fetchWasm() {
  const res = await fetch(new URL("server.wasm", import.meta.url));
  return res.arrayBuffer();
}

new Client("http://localhost:5794/", fetchWasm);

export {};
