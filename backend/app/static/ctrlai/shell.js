/*
 * CTRL+AI 기능 상자 — the trusted shell around a member app (app-platform P1).
 *
 * apps.ctrlai.my/<slug>/ serves this page, never the member's files. It
 * runs the app one level down, in a frame sandboxed WITHOUT
 * allow-same-origin (so the app's origin is opaque: no cookies, no storage,
 * no reach into this page), loading the files from /<slug>/_app/ — which
 * the server also sends with a `sandbox` CSP, so opened directly they are
 * just as fenced in.
 *
 * The app talks to this page only through the SDK (/_ctrlai/sdk.js), by
 * postMessage. A message is accepted only when it comes from this page's
 * own frame (event.source) with an opaque origin; anything else — another
 * window, a page that opened this one, a frame elsewhere — is ignored.
 *
 * The app's slug comes from this page's own address, not from anything the
 * app says. Storage lives in this origin's localStorage under a key that
 * starts with the slug, about 1 MB per app.
 */
(function () {
  "use strict";

  var match = /^\/([a-z2-9]{10})\/$/.exec(location.pathname);
  var body = document.body;
  var mode = body.getAttribute("data-mode") === "preview" ? "preview" : "app";
  var LIMIT = 1024 * 1024; // characters of key + value, per app
  var SANDBOX = "allow-scripts allow-forms allow-popups allow-downloads";

  function say(text) {
    var box = document.createElement("p");
    box.id = "ctrlai-message";
    box.setAttribute("role", "alert");
    box.textContent = text;
    body.appendChild(box);
  }

  if (!match) {
    say("앱 주소가 올바르지 않아요.");
    return;
  }
  var slug = match[1];

  // A copy of this page opened by a member app inherits its sandbox: no
  // origin, no storage. It must not pretend to be the app's shell.
  var store = null;
  try {
    if (window.origin !== "null") {
      store = window.localStorage;
      store.getItem("_");
    }
  } catch (error) {
    store = null;
  }
  if (!store) {
    say("이 앱은 여기서 열 수 없어요. CTRL+AI의 CtrlAIApps에서 열어 주세요.");
    return;
  }

  var PREFIX = "ctrlai:" + slug + ":";
  var LS = "l:"; // the app's own localStorage, kept here
  var KV = "k:"; // ctrlai.storage

  function ownKeys(space) {
    var out = [];
    for (var index = 0; index < store.length; index += 1) {
      var key = store.key(index);
      if (key && key.indexOf(PREFIX + space) === 0) out.push(key.slice(PREFIX.length + space.length));
    }
    return out;
  }

  function used() {
    var total = 0;
    for (var index = 0; index < store.length; index += 1) {
      var key = store.key(index);
      if (key && key.indexOf(PREFIX) === 0) total += key.length - PREFIX.length + (store.getItem(key) || "").length;
    }
    return total;
  }

  function put(space, key, value) {
    var full = PREFIX + space + key;
    var old = store.getItem(full);
    var size = used() - (old === null ? 0 : space.length + key.length + old.length) + space.length + key.length + value.length;
    if (size > LIMIT) throw new Error("이 앱의 저장 공간(약 1MB)이 가득 찼어요.");
    store.setItem(full, value);
  }

  function drop(space, key) {
    store.removeItem(PREFIX + space + key);
  }

  function snapshot() {
    var data = {};
    var keys = ownKeys(LS);
    for (var index = 0; index < keys.length; index += 1) data[keys[index]] = store.getItem(PREFIX + LS + keys[index]);
    return data;
  }

  var frame = document.createElement("iframe");
  frame.setAttribute("sandbox", SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", document.title);
  // The app's saved localStorage, read synchronously by the SDK at start.
  frame.name = "ctrlai-v1:" + JSON.stringify(snapshot());
  frame.src = "/" + slug + "/_app/index.html" + (location.hash || "");
  body.appendChild(frame);

  function send(message) {
    message.ctrlai = 1;
    // The frame's origin is opaque, so no narrower target exists; the
    // message goes to this page's own frame only.
    if (frame.contentWindow) frame.contentWindow.postMessage(message, "*");
  }

  function validKey(key) {
    return typeof key === "string" && key.length > 0 && key.length <= 200;
  }

  function handle(message) {
    var type = message.type;
    var key = message.key;
    switch (type) {
      case "ls.set":
        if (!validKey(key) || typeof message.value !== "string") return null;
        try {
          put(LS, key, message.value);
        } catch (error) {
          send({ event: "storage-full" });
        }
        return null;
      case "ls.remove":
        if (validKey(key)) drop(LS, key);
        return null;
      case "ls.clear":
        ownKeys(LS).forEach(function (name) {
          drop(LS, name);
        });
        return null;
      case "storage.get": {
        if (!validKey(key)) throw new Error("저장 이름(key)이 올바르지 않아요.");
        var raw = store.getItem(PREFIX + KV + key);
        return { value: raw === null ? null : JSON.parse(raw) };
      }
      case "storage.set":
        if (!validKey(key) || message.value === undefined) throw new Error("저장할 값이 올바르지 않아요.");
        put(KV, key, JSON.stringify(message.value));
        return { value: null };
      case "storage.remove":
        if (!validKey(key)) throw new Error("저장 이름(key)이 올바르지 않아요.");
        drop(KV, key);
        return { value: null };
      case "storage.keys":
        return { value: ownKeys(KV) };
      case "storage.clear":
        ownKeys(KV).forEach(function (name) {
          drop(KV, name);
        });
        return { value: null };
      case "hello":
        return { value: { slug: slug, mode: mode, framed: window.top !== window } };
      default:
        throw new Error("알 수 없는 요청이에요: " + String(type).slice(0, 40));
    }
  }

  window.addEventListener("message", function (event) {
    // Only this page's own app frame, running sandboxed (opaque origin).
    if (event.source !== frame.contentWindow || event.origin !== "null") return;
    var message = event.data;
    if (!message || typeof message !== "object" || message.ctrlai !== 1 || typeof message.type !== "string") return;
    var id = typeof message.id === "string" ? message.id.slice(0, 40) : null;
    try {
      var result = handle(message);
      if (id && result) send({ reply: id, ok: true, value: result.value });
    } catch (error) {
      if (id) send({ reply: id, ok: false, error: String((error && error.message) || error) });
    }
  });
})();
