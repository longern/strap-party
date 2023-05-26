import { Client } from "./client";
import "./main.css";

async function fetchWasm() {
  const res = await fetch(new URL("tic_tac_toe_wasm.wasm", import.meta.url));
  return res.arrayBuffer();
}

document.getElementById("app")!.innerHTML = `
<div class="container">
  <form id="connect-form">
    <input type="text" id="server-endpoint" placeholder="Server Endpoint" required />
    <button type="submit" id="connect" class="primary">Connect</button>
  </form>
  <table>
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
</div>
`;

document
  .getElementById("connect-form")!
  .addEventListener("submit", function (e) {
    e.preventDefault();

    const endpoint = (
      document.getElementById("server-endpoint") as HTMLInputElement
    ).value;
    const client = new Client(endpoint, fetchWasm);
    document.querySelector(".container")!.classList.add("connected");

    client.onmessage((data) => {
      const view = new Uint8Array(data);
      const message = view[0];
      const player = message >> 4;
      const move = message & 0b1111;
      if (!move) myself = player;
      else
        document.querySelector(`[cell-id="${move}"]`)!.textContent =
          chars[player];
    });

    const chars = ["×", "○"];
    let myself: number | null = null;

    for (let i = 1; i <= 9; i++) {
      document
        .querySelector(`[cell-id="${i}"]`)!
        .addEventListener("click", function () {
          if (this.textContent || myself === null) return;
          client.send(new Uint8Array([i | (myself << 4)]).buffer);
        });
    }

    return false;
  });
