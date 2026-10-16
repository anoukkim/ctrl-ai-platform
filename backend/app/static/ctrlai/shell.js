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
 *
 * P2: sign-in, `ctrlai.user`, `ctrlai.ai`. The shell calls this origin's
 * /_ctrlai/v1/* itself (same origin, the `X-CtrlAI-App` header, this
 * app's own cookie, which the app frame can never send). Signing in opens
 * the club's consent page in a new window; the callback window tells this
 * page — accepted only from that window. Each AI charge is shown in a
 * small note: the visitor pays from their own 동아리 지원.
 *
 * P3: `ctrlai.db` — every call goes to /_ctrlai/v1/data/<op>. Reads work
 * signed out (shared collections); a write that needs a sign-in, or a
 * consent given before "data" was asked for, runs the sign-in first and
 * tries once more.
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

  // ------------------------------------------------------------ P2: the server
  var info = null; // what /_ctrlai/v1/app said last
  var siteOrigin = "";

  function api(path, options) {
    options = options || {};
    var init = {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: { "X-CtrlAI-App": slug },
    };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    return fetch("/_ctrlai" + path, init).then(function (response) {
      if (options.raw) return response;
      return response.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (error) {
          data = null;
        }
        if (!response.ok) throw failure(response.status, data && data.detail);
        return data;
      });
    });
  }

  function failure(status, detail) {
    var code = null;
    if (detail && typeof detail === "object") {
      code = typeof detail.code === "string" ? detail.code : null;
      detail = detail.message;
    }
    var error = new Error(typeof detail === "string" ? detail : "요청을 처리하지 못했어요 (" + status + ").");
    error.code =
      code || (status === 401 ? "login_required" : status === 403 ? "forbidden" : status === 402 ? "budget" : status === 429 ? "rate" : "error");
    error.status = status;
    return error;
  }

  function refresh() {
    return api("/v1/app").then(function (data) {
      info = data;
      return data;
    });
  }

  // --------------------------------------------------- the shell's own notes
  var note = null;
  var banner = null;

  function toast(text) {
    if (!note) {
      note = document.createElement("div");
      note.id = "ctrlai-note";
      note.setAttribute("role", "status");
      note.style.cssText =
        "position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:min(320px,calc(100% - 24px));" +
        "padding:8px 12px;border-radius:10px;background:rgba(20,20,24,.92);color:#fff;" +
        "font:13px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);transition:opacity .3s";
      body.appendChild(note);
    }
    note.textContent = text;
    note.style.opacity = "1";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      note.style.opacity = "0";
    }, 3500);
  }

  function hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  /** "CTRL+AI 회원만 쓸 수 있어요" + 로그인 — when a window could not open by itself. */
  function showBanner(onLogin) {
    hideBanner();
    banner = document.createElement("div");
    banner.id = "ctrlai-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "CTRL+AI 로그인");
    banner.style.cssText =
      "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:8px;" +
      "align-items:center;flex-wrap:wrap;max-width:calc(100% - 24px);padding:10px 12px;border-radius:12px;" +
      "background:#fff;color:#111;border:1px solid #ddd;font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.25)";
    var text = document.createElement("span");
    text.textContent = "CTRL+AI 회원만 쓸 수 있어요.";
    var go = document.createElement("button");
    go.type = "button";
    go.textContent = "로그인";
    go.style.cssText = "padding:6px 12px;border-radius:8px;border:0;background:#2563eb;color:#fff;font:inherit;cursor:pointer";
    go.addEventListener("click", onLogin);
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "닫기";
    close.style.cssText = "padding:6px 10px;border-radius:8px;border:1px solid #ccc;background:#fff;color:#111;font:inherit;cursor:pointer";
    close.addEventListener("click", function () {
      hideBanner();
      if (pendingLogin) pendingLogin.reject(loginError("로그인하지 않았어요."));
    });
    banner.appendChild(text);
    banner.appendChild(go);
    banner.appendChild(close);
    body.appendChild(banner);
    go.focus();
  }

  // ------------------------------------------------------------ P2: sign-in
  var pendingLogin = null; // { promise, resolve, reject, window, timer }

  function loginError(text) {
    var error = new Error(text);
    error.code = "login_required";
    return error;
  }

  function finishLogin(ok) {
    var pending = pendingLogin;
    if (!pending) return;
    pendingLogin = null;
    clearInterval(pending.timer);
    hideBanner();
    if (!ok) {
      pending.reject(loginError("로그인하지 않았어요."));
      return;
    }
    refresh().then(
      function (data) {
        if (data.signedIn) pending.resolve(data.user);
        else pending.reject(loginError("로그인하지 못했어요. 다시 시도해 주세요."));
      },
      function (error) {
        pending.reject(error);
      }
    );
  }

  function openLogin(url) {
    var popup = window.open(url, "ctrlai-login-" + slug, "width=480,height=720");
    if (!popup) return false;
    pendingLogin.window = popup;
    pendingLogin.timer = setInterval(function () {
      if (popup.closed && pendingLogin && pendingLogin.window === popup) finishLogin(false);
    }, 600);
    return true;
  }

  function login(again) {
    if (info && info.signedIn && !again) return Promise.resolve(info.user);
    if (pendingLogin) return pendingLogin.promise;
    var pending = {};
    pending.promise = new Promise(function (resolve, reject) {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    pendingLogin = pending;
    api("/v1/login/start", { method: "POST", body: {} }).then(
      function (data) {
        try {
          siteOrigin = new URL(data.connectUrl).origin;
        } catch (error) {
          siteOrigin = "";
        }
        if (!openLogin(data.connectUrl)) {
          // Opened without the visitor's click: ask for one.
          showBanner(function () {
            if (pendingLogin === pending && openLogin(data.connectUrl)) hideBanner();
          });
        }
      },
      function (error) {
        if (pendingLogin === pending) pendingLogin = null;
        pending.reject(error);
      }
    );
    return pending.promise;
  }

  // The consent page (the site) or the callback (this origin) — only from
  // the window this page opened.
  window.addEventListener("message", function (event) {
    if (!pendingLogin || !pendingLogin.window || event.source !== pendingLogin.window) return;
    if (event.origin !== location.origin && event.origin !== siteOrigin) return;
    var data = event.data;
    if (!data || data.ctrlai !== "login") return;
    finishLogin(data.ok === true && event.origin === location.origin);
  });

  /** Signed in, or sign in first (the first AI use asks for consent). */
  function signedIn() {
    if (info && info.signedIn) return Promise.resolve(info.user);
    return refresh().then(function (data) {
      return data.signedIn ? data.user : login();
    });
  }

  // ------------------------------------------------------------- P3: data
  var DB_WRITES = { "db.save": 1, "db.update": 1, "db.remove": 1, "db.report": 1 };

  function dbCall(type, fields, retried) {
    var op = type.slice(3);
    return api("/v1/data/" + op, { method: "POST", body: fields }).then(
      function (data) {
        if (op === "list") return data;
        if (op === "count") return data.count;
        if (op === "get" || op === "save" || op === "update") return data.item;
        return null;
      },
      function (error) {
        if (retried || !DB_WRITES[type]) throw error;
        // Not signed in, or allowed before "data" was asked: sign in (the
        // consent screen) and try once more.
        if (error.code === "login_required") {
          info = null;
          return login().then(function () {
            return dbCall(type, fields, true);
          });
        }
        if (error.code === "consent_required") {
          return login(true).then(function () {
            return dbCall(type, fields, true);
          });
        }
        throw error;
      }
    );
  }

  function charged(amount) {
    if (amount > 0) toast("앱 AI · " + amount.toLocaleString("ko-KR") + "원 · 내 동아리 지원금에서");
  }

  function askAI(options) {
    return signedIn().then(function () {
      return api("/v1/ai/ask", { method: "POST", body: options }).then(
        function (data) {
          charged(data.chargedKrw);
          return data;
        },
        function (error) {
          if (error.status === 401) info = null;
          throw error;
        }
      );
    });
  }

  function streamAI(id, options) {
    return signedIn().then(function () {
      return api("/v1/ai/stream", { method: "POST", body: options, raw: true }).then(function (response) {
        if (!response.ok) {
          return response.text().then(function (text) {
            var data = null;
            try {
              data = JSON.parse(text);
            } catch (error) {
              data = null;
            }
            throw failure(response.status, data && data.detail);
          });
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";
        var result = null;
        function pump() {
          return reader.read().then(function (part) {
            if (part.value) buffer += decoder.decode(part.value, { stream: true });
            var blocks = buffer.split("\n\n");
            buffer = blocks.pop();
            blocks.forEach(function (block) {
              var name = (/^event: (.*)$/m.exec(block) || [])[1];
              var line = (/^data: (.*)$/m.exec(block) || [])[1];
              if (!name || !line) return;
              var data = JSON.parse(line);
              if (name === "delta") send({ event: "ai-chunk", id: id, text: data.text });
              else if (name === "done") result = data;
              else if (name === "error") {
                charged(data.chargedKrw || 0);
                throw failure(503, data.message);
              }
            });
            if (part.done) {
              if (!result) throw failure(503, "AI 답을 끝까지 받지 못했어요.");
              charged(result.chargedKrw);
              return result;
            }
            return pump();
          });
        }
        return pump();
      });
    });
  }

  refresh().catch(function () {
    info = null;
  });

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
      case "user.get":
        return refresh().then(function (data) {
          return { value: data.signedIn ? data.user : null };
        });
      case "login":
        return login().then(function (user) {
          return { value: user };
        });
      case "logout":
        return api("/v1/logout", { method: "POST", body: {} }).then(function () {
          info = null;
          return { value: null };
        });
      case "ai.ask":
        return askAI(message.options || {}).then(function (data) {
          return { value: data };
        });
      case "db.save":
      case "db.list":
      case "db.get":
      case "db.update":
      case "db.remove":
      case "db.count":
      case "db.report": {
        // The envelope's `id` is the request id; the item's id came as `item`.
        var fields = {};
        for (var name in message) {
          if (Object.prototype.hasOwnProperty.call(message, name) && name !== "type" && name !== "id" && name !== "ctrlai") {
            fields[name === "item" ? "id" : name] = message[name];
          }
        }
        return dbCall(type, fields, false).then(function (data) {
          return { value: data };
        });
      }
      case "ai.stream":
        return streamAI(typeof message.id === "string" ? message.id.slice(0, 40) : "", message.options || {}).then(
          function (data) {
            return { value: data };
          }
        );
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
    Promise.resolve()
      .then(function () {
        return handle(message);
      })
      .then(
        function (result) {
          if (id && result) send({ reply: id, ok: true, value: result.value });
        },
        function (error) {
          if (id) {
            send({
              reply: id,
              ok: false,
              error: String((error && error.message) || error),
              code: (error && error.code) || "error",
            });
          }
        }
      );
  });
})();
