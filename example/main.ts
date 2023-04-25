import { Client } from "./client";

async function fetchWasm() {
  const res = await fetch(new URL("server.wasm", import.meta.url));
  return res.arrayBuffer();
}

const client = new Client("http://localhost:5794/", fetchWasm);

document.getElementById("app")!.innerHTML = `
  <table style="border: 1px solid black; border-collapse: collapse;">
    <tr>
      <td cell-id="1"></td>
      <td cell-id="2"></td>
      <td cell-id="3"></td>
    </tr>
    <tr>
      <td cell-id="4"></td>
      <td cell-id="5"></td>
      <td cell-id="6"></td>
    </tr>
    <tr>
      <td cell-id="7"></td>
      <td cell-id="8"></td>
      <td cell-id="9"></td>
    </tr>
  </table>
  <style>
    td {
      width: 100px;
      height: 100px;
      border: 1px solid black;
      text-align: center;
      vertical-align: middle;
    }
  </style>
`;

const chars = ["X", "O"];
let myself: number | null = null;

for (let i = 1; i <= 9; i++) {
  document
    .querySelector(`[cell-id="${i}"]`)!
    .addEventListener("click", function () {
      if (this.textContent || myself === null) return;
      client.send(new Uint8Array([i | (myself << 4)]).buffer);
    });
}

client.onmessage((data) => {
  const view = new Uint8Array(data);
  const message = view[0];
  const player = message >> 4;
  const move = message & 0b1111;
  if (!move) myself = player;
  else
    document.querySelector(`[cell-id="${move}"]`)!.textContent =
      chars[player - 1];
});

export {};
