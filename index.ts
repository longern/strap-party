import crypto from "crypto";
import fs from "fs";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";

let backend: WebSocket | null = null;
const requestMap = new Map<string, (reponse: Response) => void>();

const server = createServer(function (req, res) {
  if (req.method === "GET") {
    let { pathname } = new URL(req.url!, "http://localhost/");
    if (pathname === "/") pathname = "/index.html";
    if (!fs.existsSync(`./dist${pathname}`)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": {
        ".html": "text/html",
        ".js": "text/javascript",
      }[pathname.slice(pathname.lastIndexOf("."))],
    });
    res.end(fs.readFileSync(`./dist${pathname}`));
    return;
  }

  if (!backend) {
    res.statusCode = 503;
    res.end("No backend connected");
    return;
  }

  const requestId = crypto.randomUUID();
  new Promise<Response>((resolve, reject) => {
    requestMap.set(requestId, resolve);
    setTimeout(() => reject(new Error("Timeout")), 10000);
  })
    .then(async (response: Response) => {
      res.writeHead(response.status || 200, response.headers as any);
      res.end(response.text);
    })
    .catch((error: Error) => {
      res.statusCode = 408;
      res.end(error.message);
    })
    .finally(() => {
      requestMap.delete(requestId);
    });

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    backend!.send(
      JSON.stringify({
        id: requestId,
        className: "Request",
        init: {
          url: req.url,
          method: req.method,
          headers: req.headers,
          body,
        },
      })
    );
  });
});
const wss = new WebSocketServer({ server });

wss.on("connection", function connection(ws, request) {
  const whitelist = ["127.0.0.1", "::1", "localhost"];
  if (!whitelist.includes(request.socket.remoteAddress as string) || backend) {
    console.warn(`Backend socket ${request.socket.remoteAddress} rejected`);
    ws.close();
    return;
  }

  backend = ws;
  const socket = `${request.socket.remoteAddress}:${request.socket.remotePort}`;
  console.log(`Backend socket ${socket} connected`);

  ws.on("error", console.error);

  ws.on("message", function message(data) {
    const response = JSON.parse(data.toString());
    if (response.className !== "Response") return;
    requestMap.get(response.id)?.(response.init);
  });

  ws.on("close", (code, reason) => console.info(code, reason.toString()));

  ws.send(
    JSON.stringify({
      className: "Env",
      entries: process.env,
    })
  );
});

if (process.env.HEADLESS_CHROME) {
  import("child_process").then(({ spawn }) => {
    const chrome = spawn("chromium-browser", [
      "--headless",
      "--no-sandbox",
      "--remote-debugging-port=0",
      "http://localhost:5794/",
    ]);
    chrome.on("close", (code) => {
      console.warn(`child process exited with code ${code}`);
    });
  });
}

server.listen(5794, "0.0.0.0");
