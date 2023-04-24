import { Client } from "./client";

async function fetchWasm() {
  const res = await fetch(new URL("server.wasm", import.meta.url));
  return res.arrayBuffer();
}

const client = new Client("http://localhost:5794/", fetchWasm);

document.getElementById("app")!.innerHTML = `
  <table style="border: 1px solid black; border-collapse: collapse;">
    <tr>
      <td cell-id="0"></td>
      <td cell-id="1"></td>
      <td cell-id="2"></td>
    </tr>
    <tr>
      <td cell-id="3"></td>
      <td cell-id="4"></td>
      <td cell-id="5"></td>
    </tr>
    <tr>
      <td cell-id="6"></td>
      <td cell-id="7"></td>
      <td cell-id="8"></td>
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

for (let i = 0; i < 9; i++) {
  document
    .querySelector(`[cell-id="${i}"]`)!
    .addEventListener("click", function () {
      if (this.textContent) return;
      this.textContent = "O";
      client.send(new Uint8Array([i]).buffer);
    });
}

client.onmessage((data) => {
  const view = new Uint8Array(data);
  const move = view[0];
  document.querySelector(`[cell-id="${move}"]`)!.textContent = "X";
});

export {};
