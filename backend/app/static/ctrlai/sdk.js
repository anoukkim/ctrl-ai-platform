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
 *   ctrlai.ai.estimate(options)        → Promise<{ typicalKrw, maxKrw, model }>  (free, signed out too)
 *   ctrlai.ai.mode()                   → Promise<"live" | "demo">
 *
 * AI is paid by the visitor from their own 동아리 지원 (at most 200원 a call).
 * `json` is a JSON Schema; the answer comes back parsed and checked.
 * `model` is "fast" (default) or "smart". `images` are data URLs, 5 MB each.
 *
 * app-ai-access — 데모. The maker opens an app's AI to other members as
 * 데모만 or 전체 기능, and every visitor has a 데모 switch in the shell. In
 * 데모 no call is made and nothing is charged: `ask` / `stream` fail with
 * code "demo" — show the app's own demo answer, marked "데모". `mode()`
 * says which it is now, and the window event "ctrlai:ai-mode"
 * (`event.detail.mode`) fires when the visitor flips the switch. Outside
 * CTRL+AI the mode is always "demo".
 *
 * P3 — ctrlai.db, the app's own database on the server. A collection is a
 * list of JSON objects named by (name, kind): **private** (each signed-in
 * visitor sees only their own items) or **shared** (everyone reads,
 * signed-out visitors too; members write). Every call says which with
 * `shared: true` — without it, the private list of that name. "posts"
 * private and "posts" shared are two different lists, so nobody's write
 * can change what another app's call means.
 *
 *   ctrlai.db.save(collection, data, { shared? })      → Promise<item>
 *   ctrlai.db.list(collection, { shared?, where?, orderBy?, order?, limit?, cursor?, mine? })
 *                                                      → Promise<{ items, nextCursor }>
 *   ctrlai.db.get(collection, id, { shared? })         → Promise<item | null>
 *   ctrlai.db.update(collection, id, changes, { shared? }) → Promise<item>
 *   ctrlai.db.remove(collection, id, { shared? })      → Promise<void>
 *   ctrlai.db.count(collection, { shared?, where?, mine? }) → Promise<number>
 *   ctrlai.db.report(collection, id, reason)           → Promise<void>   (shared only)
 *
 * An item is { id, data, createdAt, updatedAt, mine, canDelete, author:
 * { displayName, appUserId } }. `where` is simple equality on top-level
 * fields; `orderBy` is "createdAt" (default, newest first), "updatedAt" or
 * a field name; `limit` ≤ 100. Items are ≤ 4 KB; an app holds ≤ 2,000
 * items / 5 MB; a visitor writes ≤ 30 times a minute. Writing asks the
 * visitor to sign in (and to allow the app) when needed.
 *
 * P4 — the app's lists are the **app maker's** to define: in the project's
 * `ctrlai.json` — { "db": [ { "name": "posts", "shared": true },
 * { "name": "notes" } ] } — or by the maker's own first save. A visitor's
 * save into a list that is not there fails with code "no_collection".
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
    if (data.event === "capture") {
      // ui-improvements thumbnails: the shell (for the club's site, the
      // maker's own Builder page) asks for a picture of this page. Drawn
      // here, in the app's own frame; nothing leaves but the PNG.
      capture(data.width, data.height).then(
        function (dataUrl) {
          post({ type: "capture.result", capture: String(data.id), dataUrl: dataUrl });
        },
        function (error) {
          post({ type: "capture.failed", capture: String(data.id), error: String((error && error.message) || error) });
        }
      );
      return;
    }
    if (data.event === "ai-mode") {
      // The visitor flipped the shell's 데모 switch (app-ai-access).
      try {
        window.dispatchEvent(new CustomEvent("ctrlai:ai-mode", { detail: { mode: data.mode === "live" ? "live" : "demo" } }));
      } catch (error) {
        /* an app without CustomEvent support simply asks mode() */
      }
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

  // ------------------------------------------------- a picture of this page
  var CAPTURE_MAX_NODES = 5000;
  var CAPTURE_MAX_EDGE = 1600;
  // The serialized page at most — a cap on what the SVG image has to parse,
  // whatever the node count (a long list app has many small nodes).
  var CAPTURE_MAX_CHARS = 4000000;
  var TOO_BIG = "페이지가 너무 커서 썸네일을 만들지 못했어요.";

  // Only what differs from the browser's own default for that tag is
  // inlined: ~350 computed properties per node would make a few thousand
  // nodes tens of megabytes. The defaults come from a bare element of the
  // same tag in an off-screen probe, read once per tag per capture.
  var probe = null;
  var defaults = {};

  function defaultStyle(tag) {
    if (defaults[tag]) return defaults[tag];
    if (!probe) {
      probe = document.createElement("div");
      probe.setAttribute("style", "position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none");
      (document.body || document.documentElement).appendChild(probe);
    }
    var bare = document.createElement(tag);
    probe.appendChild(bare);
    var computed = window.getComputedStyle(bare);
    var map = {};
    for (var index = 0; index < computed.length; index += 1) {
      var name = computed[index];
      map[name] = computed.getPropertyValue(name);
    }
    defaults[tag] = map;
    return map;
  }

  function dropProbe() {
    if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
    probe = null;
    defaults = {};
  }

  function copyStyle(source, target) {
    var computed = window.getComputedStyle(source);
    var base = defaultStyle(source.tagName.toLowerCase());
    var text = "";
    for (var index = 0; index < computed.length; index += 1) {
      var name = computed[index];
      var value = computed.getPropertyValue(name);
      if (base[name] !== value) text += name + ":" + value + ";";
    }
    if (text) target.setAttribute("style", text);
    else target.removeAttribute("style");
  }

  /** The page as an SVG data URL: the DOM cloned with its computed styles. */
  function snapshot(width, height) {
    try {
      return snapshotInner(width, height);
    } finally {
      dropProbe();
    }
  }

  function snapshotInner(width, height) {
    var root = document.documentElement;
    var sources = root.querySelectorAll("*");
    if (sources.length > CAPTURE_MAX_NODES) throw new Error(TOO_BIG);
    var clone = root.cloneNode(true);
    var targets = clone.querySelectorAll("*");
    copyStyle(root, clone);
    var drop = [];
    for (var index = 0; index < sources.length; index += 1) {
      var source = sources[index];
      var target = targets[index];
      var tag = source.tagName;
      if (tag === "SCRIPT" || tag === "NOSCRIPT" || tag === "IFRAME" || tag === "LINK") {
        drop.push(target);
        continue;
      }
      copyStyle(source, target);
      if (tag === "CANVAS") {
        var picture = document.createElement("img");
        try {
          picture.setAttribute("src", source.toDataURL("image/png"));
          picture.setAttribute("style", target.getAttribute("style") || "");
          target.parentNode.replaceChild(picture, target);
        } catch (error) {
          /* a tainted or WebGL canvas: left as it is (blank) */
        }
      } else if (tag === "INPUT") {
        target.setAttribute("value", source.value);
        if (source.checked) target.setAttribute("checked", "checked");
        else target.removeAttribute("checked");
      } else if (tag === "TEXTAREA") {
        target.textContent = source.value;
      } else if (tag === "SELECT") {
        var options = target.querySelectorAll("option");
        for (var option = 0; option < options.length; option += 1) {
          if (option === source.selectedIndex) options[option].setAttribute("selected", "selected");
          else options[option].removeAttribute("selected");
        }
      }
    }
    for (var dead = 0; dead < drop.length; dead += 1) {
      if (drop[dead].parentNode) drop[dead].parentNode.removeChild(drop[dead]);
    }
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    clone.style.width = width + "px";
    clone.style.height = height + "px";
    clone.style.overflow = "hidden";
    var html = new XMLSerializer().serializeToString(clone);
    if (html.length > CAPTURE_MAX_CHARS) throw new Error(TOO_BIG);
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
      '<foreignObject width="100%" height="100%">' + html + "</foreignObject></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /** A PNG data URL of this page at the frame's size (scaled under CAPTURE_MAX_EDGE). */
  function capture(width, height) {
    return new Promise(function (resolve, reject) {
      var w = Math.max(1, Math.floor(Number(width) || document.documentElement.clientWidth || 1280));
      var h = Math.max(1, Math.floor(Number(height) || document.documentElement.clientHeight || 800));
      var url;
      try {
        url = snapshot(w, h);
      } catch (error) {
        reject(error);
        return;
      }
      var scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(w, h));
      var image = new Image();
      image.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          var context = canvas.getContext("2d");
          var background = window.getComputedStyle(document.body).backgroundColor;
          context.fillStyle = background && background !== "rgba(0, 0, 0, 0)" ? background : "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = function () {
        reject(new Error("페이지를 그림으로 만들지 못했어요."));
      };
      image.src = url;
    });
  }

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
    if (type === "ai.mode") return "demo";
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
    // What ask/stream with these options would cost — free, works signed
    // out: { typicalKrw, maxKrw, model }. `images` may be a count. A call
    // made with the same options never costs more than maxKrw (P4b).
    estimate: function (options) {
      var settings = aiOptions(options);
      var raw = options && options.images;
      settings.images = typeof raw === "number" ? Math.max(0, Math.min(4, Math.floor(raw))) : settings.images.length;
      return ask("ai.estimate", { options: settings });
    },
    stream: function (options, onChunk) {
      var settings = aiOptions(options);
      delete settings.json;
      return ask("ai.stream", { options: settings }, typeof onChunk === "function" ? onChunk : null);
    },
    // "live" (a call would run and be charged) or "demo" (it would fail with
    // code "demo" — show the demo answer). app-ai-access.
    mode: function () {
      return ask("ai.mode");
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

  // Only `shared: true` means the shared list; anything else is private.
  function isShared(options) {
    return !!(options && options.shared === true);
  }

  var db = Object.freeze({
    save: function (collection, data, options) {
      return dbCall("db.save", {
        collection: checkedCollection(collection),
        shared: isShared(options),
        data: checkedObject(data, "저장할 값"),
      });
    },
    list: function (collection, options) {
      options = options || {};
      var query = { collection: checkedCollection(collection), shared: isShared(options) };
      if (options.where) query.where = checkedObject(options.where, "where");
      if (options.orderBy) query.orderBy = String(options.orderBy);
      if (options.order) query.order = String(options.order);
      if (options.limit) query.limit = Number(options.limit);
      if (options.cursor) query.cursor = String(options.cursor);
      if (options.mine) query.mine = true;
      return dbCall("db.list", query);
    },
    get: function (collection, id, options) {
      return dbCall("db.get", { collection: checkedCollection(collection), shared: isShared(options), item: checkedId(id) });
    },
    update: function (collection, id, changes, options) {
      return dbCall("db.update", {
        collection: checkedCollection(collection),
        shared: isShared(options),
        item: checkedId(id),
        data: checkedObject(changes, "바꿀 값"),
      });
    },
    remove: function (collection, id, options) {
      return dbCall("db.remove", { collection: checkedCollection(collection), shared: isShared(options), item: checkedId(id) });
    },
    count: function (collection, options) {
      options = options || {};
      var query = { collection: checkedCollection(collection), shared: isShared(options) };
      if (options.where) query.where = checkedObject(options.where, "where");
      if (options.mine) query.mine = true;
      return dbCall("db.count", query);
    },
    report: function (collection, id, reason) {
      return dbCall("db.report", {
        collection: checkedCollection(collection),
        shared: true,
        item: checkedId(id),
        reason: typeof reason === "string" ? reason : "",
      });
    },
  });

  var api = Object.freeze({
    version: "6",
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
