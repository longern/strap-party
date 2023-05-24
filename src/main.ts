import router from "./router";
import { HOST } from "./state";

const ws = new WebSocket(`ws://${HOST}/"`);
const env = {};

ws.onmessage = async function (event) {
  const data = JSON.parse(event.data);
  if (data.className == "Request") {
    const reqId = data.id;
    const { url, headers, ...init } = data.init;
    const req = {
      url: new URL(url, "http://localhost/"),
      headers: new Headers(headers),
      ...init,
      text: () => Promise.resolve(init.body),
      json: () => Promise.resolve(JSON.parse(init.body)),
    };
    const res = await router.fetch(req, env);
    ws.send(
      JSON.stringify({
        id: reqId,
        className: "Response",
        init: {
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          text: await res.text(),
        },
      })
    );
  } else if (data.className == "Env") {
    Object.assign(env, data.entries);
  }
};
