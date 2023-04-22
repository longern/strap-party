import router from "./router";

const ws = new WebSocket("ws://127.0.0.1:5794/");

ws.onmessage = async function (event) {
  const data = JSON.parse(event.data);
  if (data.className == "Request") {
    const reqId = data.id;
    const { relUrl, ...init } = data.init;
    const url = new URL(relUrl, "http://localhost");
    const req = new Request(url, init);
    const res = await router.handle(req);
    ws.send(
      JSON.stringify({
        id: reqId,
        className: "Response",
        init: {
          status: res.status,
          text: await res.text(),
        },
      })
    );
  }
};
