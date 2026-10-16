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
 * P3 — ctrlai.db, the app's own database on the server. A collection is a
 * named list of JSON objects; the first save decides whether it is
 * private (each signed-in visitor sees only their own items) or shared
 * (everyone reads, signed-out visitors too; members write):
 *
 *   ctrlai.db.save(collection, data, { shared?: boolean })
 *                                    → Promise<item>
 *   ctrlai.db.list(collection, { where?, orderBy?, order?, limit?, cursor?, mine? })
 *                                    → Promise<{ items, nextCursor }>
 *   ctrlai.db.get(collection, id)    → Promise<item | null>
 *   ctrlai.db.update(collection, id, changes) → Promise<item>
 *   ctrlai.db.remove(collection, id) → Promise<void>
 *   ctrlai.db.count(collection, { where?, mine? }) → Promise<number>
 *   ctrlai.db.report(collection, id, reason) → Promise<void>   (shared only)
 *
 * An item is { id, data, createdAt, updatedAt, mine, canDelete, author:
 * { displayName, appUserId } }. `where` is simple equality on top-level
 * fields; `orderBy` is "createdAt" (default, newest first), "updatedAt" or
 * a field name; `limit` ≤ 100. Items are ≤ 4 KB; an app holds ≤ 2,000
 * items / 5 MB; a visitor writes ≤ 30 times a minute. Writing asks the
 * visitor to sign in (and to allow the app) when needed.
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
    // Signing in may be part of a write: db calls get the long timeout too.
    var long = type === "login" || type.indexOf("ai.") === 0 || type.indexOf("db.") === 0;
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
    if (type === "login" || type.indexOf("ai.") === 0 || type.indexOf("db.") === 0) {
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

  function checkedCollection(name) {
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(name)) {
      throw new TypeError("목록 이름은 영문·숫자·_·- 로 1~40자여야 해요.");
    }
    return name;
  }

  function checkedObject(value, what) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(what + "은(는) 객체({ ... })여야 해요.");
    var text = JSON.stringify(value);
    if (text === undefined) throw new TypeError("JSON으로 바꿀 수 있는 값만 저장할 수 있어요.");
    return JSON.parse(text);
  }

  function checkedId(id) {
    if (typeof id !== "string" || id.length === 0 || id.length > 20) throw new TypeError("항목 id가 올바르지 않아요.");
    return id;
  }

  function dbCall(type, fields) {
    try {
      return ask(type, fields);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  var db = Object.freeze({
    save: function (collection, data, options) {
      return dbCall("db.save", {
        collection: checkedCollection(collection),
        data: checkedObject(data, "저장할 값"),
        shared: options && typeof options.shared === "boolean" ? options.shared : null,
      });
    },
    list: function (collection, options) {
      options = options || {};
      var query = { collection: checkedCollection(collection) };
      if (options.where) query.where = checkedObject(options.where, "where");
      if (options.orderBy) query.orderBy = String(options.orderBy);
      if (options.order) query.order = String(options.order);
      if (options.limit) query.limit = Number(options.limit);
      if (options.cursor) query.cursor = String(options.cursor);
      if (options.mine) query.mine = true;
      return dbCall("db.list", query);
    },
    get: function (collection, id) {
      return dbCall("db.get", { collection: checkedCollection(collection), id: checkedId(id) });
    },
    update: function (collection, id, changes) {
      return dbCall("db.update", {
        collection: checkedCollection(collection),
        id: checkedId(id),
        data: checkedObject(changes, "바꿀 값"),
      });
    },
    remove: function (collection, id) {
      return dbCall("db.remove", { collection: checkedCollection(collection), id: checkedId(id) });
    },
    count: function (collection, options) {
      options = options || {};
      var query = { collection: checkedCollection(collection) };
      if (options.where) query.where = checkedObject(options.where, "where");
      if (options.mine) query.mine = true;
      return dbCall("db.count", query);
    },
    report: function (collection, id, reason) {
      return dbCall("db.report", {
        collection: checkedCollection(collection),
        id: checkedId(id),
        reason: typeof reason === "string" ? reason : "",
      });
    },
  });

  var api = Object.freeze({
    version: "3",
    /** True inside CTRL+AI (the shell around the app answers). */
    connected: !!parentWindow,
    storage: storage,
    ai: ai,
    db: db,
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
