/*
 * CTRL+AI 기능 상자 — the SDK a member app talks through (app-platform P1).
 *
 * Served at apps.ctrlai.my/_ctrlai/sdk.js and added to the top of every HTML
 * page of a member app when its files are written (app_runtime.SDK_TAG).
 *
 * The app runs in a sandboxed frame with an opaque origin: it has no
 * cookies, no storage and no network of its own (CSP connect-src 'none').
 * Everything goes through the trusted shell page around it, by
 * postMessage, and only to that parent.
 *
 *   ctrlai.storage.get(key)          → Promise<value | null>
 *   ctrlai.storage.set(key, value)   → Promise<void>   (any JSON value)
 *   ctrlai.storage.remove(key)       → Promise<void>
 *   ctrlai.storage.keys()            → Promise<string[]>
 *   ctrlai.storage.clear()           → Promise<void>
 *   ctrlai.app()                     → Promise<{ slug, mode, framed }>
 *
 * P2 — signed-in CTRL+AI members only (the first use asks them to sign in
 * and allow the app; signed-out visitors get an error with code
 * "login_required"):
 *
 *   ctrlai.user()                    → Promise<{ displayName, appUserId } | null>
 *   ctrlai.login() / ctrlai.logout() → Promise
 *   ctrlai.ai.ask({ prompt, system?, images?, json?, model?, maxTokens? })
 *                                    → Promise<{ text, json, chargedKrw, model }>
 *   ctrlai.ai.stream(options, onChunk) → Promise<{ text, chargedKrw, model }>
 *
 * AI is paid by the visitor from their own 동아리 지원 (at most 200원 a call).
 * `json` is a JSON Schema; the answer comes back parsed and checked.
 * `model` is "fast" (default) or "smart". `images` are data URLs, 5 MB each.
 *
 * Storage is per app and per visitor (this browser), about 1 MB per app,
 * and works signed out. `localStorage` keeps working too: apps written
 * before the SDK use it, so it is replaced by a copy that the shell keeps
 * (best effort — a synchronous API over an asynchronous channel: reads come
 * from the copy handed over when the app starts, writes are sent on).
 */
(function () {
  "use strict";
  if (window.ctrlai) return;

  var parentWindow = window.parent !== window ? window.parent : null;
  // Messages go only to the shell's origin — our own address's origin,
  // even though this document's origin is opaque.
  var shellOrigin = location.protocol + "//" + location.host;
  var NAME_PREFIX = "ctrlai-v1:";
  var TIMEOUT_MS = 10000;
  // Signing in (a person reading a consent screen) and AI answers take
  // longer than storage.
  var LONG_TIMEOUT_MS = 5 * 60 * 1000;

  // ------------------------------------------------- localStorage, kept by the shell
  var initial = {};
  try {
    if (typeof window.name === "string" && window.name.indexOf(NAME_PREFIX) === 0) {
      var parsed = JSON.parse(window.name.slice(NAME_PREFIX.length));
      if (parsed && typeof parsed === "object") initial = parsed;
    }
  } catch (error) {
    initial = {};
  }
  try {
    window.name = "";
  } catch (error) {
    /* nothing to clear */
  }

  function post(message) {
    if (!parentWindow) return;
    message.ctrlai = 1;
    try {
      parentWindow.postMessage(message, shellOrigin);
    } catch (error) {
      /* the shell is gone */
    }
  }

  function memoryStorage(data, persist) {
    var own = Object.prototype.hasOwnProperty;
    return {
      getItem: function (key) {
        key = String(key);
        return own.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        key = String(key);
        value = String(value);
        data[key] = value;
        if (persist) post({ type: "ls.set", key: key, value: value });
      },
      removeItem: function (key) {
        key = String(key);
        delete data[key];
        if (persist) post({ type: "ls.remove", key: key });
      },
      clear: function () {
        for (var key in data) if (own.call(data, key)) delete data[key];
        if (persist) post({ type: "ls.clear" });
      },
      key: function (index) {
        return Object.keys(data)[index] || null;
      },
      get length() {
        return Object.keys(data).length;
      },
    };
  }

  var realStorage = false;
  try {
    window.localStorage.getItem("_");
    realStorage = true;
  } catch (error) {
    realStorage = false;
  }
  if (!realStorage) {
    try {
      Object.defineProperty(window, "localStorage", {
        value: memoryStorage(initial, true),
        configurable: true,
      });
      Object.defineProperty(window, "sessionStorage", {
        value: memoryStorage({}, false),
        configurable: true,
      });
    } catch (error) {
      /* a browser that refuses: the app sees its own storage error */
    }
  }

  // ------------------------------------------------- asking the shell
  var counter = 0;
  var waiting = {};

  window.addEventListener("message", function (event) {
    if (event.source !== parentWindow || event.origin !== shellOrigin) return;
    var data = event.data;
    if (!data || data.ctrlai !== 1) return;
    if (data.event === "storage-full") {
      if (window.console) console.warn("[CTRL+AI] 이 앱의 저장 공간(약 1MB)이 가득 찼어요.");
      return;
    }
    if (data.event === "ai-chunk") {
      var streaming = waiting[data.id];
      if (streaming && streaming.onChunk && typeof data.text === "string") {
        try {
          streaming.onChunk(data.text);
        } catch (error) {
          /* the app's own callback failed; the answer keeps coming */
        }
      }
      return;
    }
    var pending = waiting[data.reply];
    if (!pending) return;
    delete waiting[data.reply];
    clearTimeout(pending.timer);
    if (data.ok) pending.resolve(data.value);
    else {
      var error = new Error(data.error || "CTRL+AI 기능 상자에서 오류가 났어요.");
      error.code = data.code || "error";
      pending.reject(error);
    }
  });

  // Outside the shell (the page opened on its own) nothing answers: keep
  // the values in this page, so the app still runs.
  var loose = {};

  function ask(type, fields, onChunk) {
    if (!parentWindow) {
      try {
        return Promise.resolve(alone(type, fields || {}));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    var long = type === "login" || type.indexOf("ai.") === 0;
    return new Promise(function (resolve, reject) {
      counter += 1;
      var id = "m" + counter;
      var timer = setTimeout(function () {
        delete waiting[id];
        reject(new Error("CTRL+AI 기능 상자와 연결되지 않았어요. 새로 고쳐 보세요."));
      }, long ? LONG_TIMEOUT_MS : TIMEOUT_MS);
      waiting[id] = { resolve: resolve, reject: reject, timer: timer, onChunk: onChunk };
      var message = fields || {};
      message.type = type;
      message.id = id;
      post(message);
    });
  }

  function alone(type, fields) {
    if (type === "storage.get") return Object.prototype.hasOwnProperty.call(loose, fields.key) ? JSON.parse(loose[fields.key]) : null;
    if (type === "storage.set") loose[fields.key] = JSON.stringify(fields.value);
    if (type === "storage.remove") delete loose[fields.key];
    if (type === "storage.keys") return Object.keys(loose);
    if (type === "storage.clear") loose = {};
    if (type === "hello") return { slug: null, mode: "alone" };
    if (type === "user.get") return null;
    if (type === "login" || type.indexOf("ai.") === 0) {
      var error = new Error("CTRL+AI 안에서 열었을 때만 쓸 수 있어요.");
      error.code = "not_in_ctrlai";
      throw error;
    }
    return null;
  }

  function checkedKey(key) {
    if (typeof key !== "string" || key.length === 0 || key.length > 200) {
      throw new TypeError("저장 이름(key)은 1~200자 글자여야 해요.");
    }
    return key;
  }

  var storage = Object.freeze({
    get: function (key) {
      return ask("storage.get", { key: checkedKey(key) });
    },
    set: function (key, value) {
      if (value === undefined) return Promise.reject(new TypeError("undefined는 저장할 수 없어요. null을 쓰세요."));
      var text = JSON.stringify(value);
      if (text === undefined) return Promise.reject(new TypeError("JSON으로 바꿀 수 있는 값만 저장할 수 있어요."));
      return ask("storage.set", { key: checkedKey(key), value: JSON.parse(text) });
    },
    remove: function (key) {
      return ask("storage.remove", { key: checkedKey(key) });
    },
    keys: function () {
      return ask("storage.keys");
    },
    clear: function () {
      return ask("storage.clear");
    },
  });

  function aiOptions(options) {
    options = options || {};
    if (typeof options === "string") options = { prompt: options };
    var out = {
      prompt: typeof options.prompt === "string" ? options.prompt : "",
      system: typeof options.system === "string" ? options.system : "",
      images: Array.isArray(options.images) ? options.images.slice(0, 4) : [],
      model: options.model === "smart" ? "smart" : "fast",
    };
    if (options.json && typeof options.json === "object") out.json = options.json;
    if (options.maxTokens) out.maxTokens = Number(options.maxTokens);
    return out;
  }

  var ai = Object.freeze({
    ask: function (options) {
      return ask("ai.ask", { options: aiOptions(options) });
    },
    stream: function (options, onChunk) {
      var settings = aiOptions(options);
      delete settings.json;
      return ask("ai.stream", { options: settings }, typeof onChunk === "function" ? onChunk : null);
    },
  });

  var api = Object.freeze({
    version: "2",
    /** True inside CTRL+AI (the shell around the app answers). */
    connected: !!parentWindow,
    storage: storage,
    ai: ai,
    app: function () {
      return ask("hello");
    },
    user: function () {
      return ask("user.get");
    },
    login: function () {
      return ask("login");
    },
    logout: function () {
      return ask("logout");
    },
  });
  try {
    Object.defineProperty(window, "ctrlai", { value: api, configurable: false, writable: false });
  } catch (error) {
    window.ctrlai = api;
  }
})();
