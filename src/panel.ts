import { connections, server } from "./state";

document.getElementById("app")!.innerHTML = `
<div id="server-hash"></div>
<div id="server-size"></div>
<div id="connections"></div>
`;

setInterval(() => {
  document.getElementById("server-hash")!.textContent = `Server SHA256: ${
    server.hash || "N/A"
  }`;
  document.getElementById(
    "server-size"
  )!.textContent = `Server Size: ${server.size}`;
  document.getElementById("connections")!.textContent =
    Object.keys(connections).length.toString() + " connections";
}, 1000);
