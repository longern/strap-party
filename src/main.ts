import router from "./router";

const ws = new WebSocket("ws://127.0.0.1:5794/");
const env = {};

ws.onmessage = async function (event) {
  const data = JSON.parse(event.data);
  if (data.className == "Request") {
    const reqId = data.id;
    const { url, ...init } = data.init;
    const req = new Request(new URL(url, "http://localhost"), init);
    const res = await router.handle(req, env);
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
  } else if (data.className == "Env") {
    Object.assign(env, data.entries);
  }
};
