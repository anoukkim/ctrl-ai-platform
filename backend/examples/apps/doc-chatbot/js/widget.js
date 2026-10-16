// 문서 챗봇 메이커 — 퍼가기 위젯.
// 만들기 화면 안의 미리보기라면 부모 화면이 설정과 문서를 보내 줘요(postMessage).
// 혼자 열렸다면 이 기기에 저장된 설정을, 그것도 없으면 샘플 문서를 써요.

(function () {
  const B = window.BOT;
  // 만들기 화면과 같은 저장 이름. 위젯은 혼자 열렸을 때만 읽어요.
  const KEY = "doc-chatbot-v1";
  let settings = { ...B.DEFAULT_SETTINGS };
  let docs = B.SAMPLE_DOCS;
  let index = B.buildIndex(docs.flatMap(B.chunk));
  const framed = window.parent !== window;
  let chat = null;
  // 실제 AI (P4b): 셸 안에서 혼자 열렸고(= 기능 상자가 답하고) 설정이 실제 AI이며 로그인했을 때만.
  // 만들기 화면의 미리보기(srcdoc)에서는 기능 상자에 닿지 못해 늘 데모예요.
  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  let liveOn = false;
  function checkLive() {
    if (!sdk || framedByMaker) return Promise.resolve();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
    return Promise.race([sdk.app(), timeout])
      .then((info) => (info ? sdk.user() : null))
      // app-ai-access: CTRL+AI가 데모라고 하면(만든 사람의 설정이나 방문자의 스위치) 데모예요.
      .then((user) => Promise.all([user, sdk.ai.mode ? sdk.ai.mode().catch(() => "live") : "live"]))
      .then(([user, aiMode]) => {
        liveOn = Boolean(user) && settings.mode !== "demo" && aiMode === "live";
      })
      .catch(() => {
        liveOn = false;
      });
  }
  let framedByMaker = false;
  // CTRL+AI의 데모 스위치가 바뀌면 따라가요 (app-ai-access).
  window.addEventListener("ctrlai:ai-mode", (event) => {
    liveOn = Boolean(event.detail && event.detail.mode === "live") && liveOn;
  });

  function fromStorage() {
    const read =
      window.ctrlai && window.ctrlai.connected
        ? window.ctrlai.storage.get(KEY)
        : Promise.resolve().then(() => JSON.parse(localStorage.getItem(KEY) || "null"));
    return read
      .then((saved) => {
        if (saved && Array.isArray(saved.docs)) {
          settings = { ...B.DEFAULT_SETTINGS, ...saved.settings };
          docs = saved.docs;
        }
      })
      .catch(() => {
        /* 저장소를 못 쓰면 샘플 문서로 */
      });
  }

  function apply() {
    index = B.buildIndex(docs.flatMap(B.chunk));
    if (chat) chat.reset();
  }

  function start() {
    chat = B.mountChat(document.getElementById("widget"), {
      settings: () => settings,
      index: () => index,
      live: () => liveOn,
      sdk: () => sdk,
      summary: () => (liveOn ? "문서로 답하는 챗봇 · 실제 AI" : "문서로 답하는 챗봇 · 데모"),
      onLog: (log) => {
        if (framed) window.parent.postMessage({ type: "bot-log", log }, "*");
      },
      onRate: (id, rating) => {
        if (framed) window.parent.postMessage({ type: "bot-rate", id, rating }, "*");
      },
      suggestions: [],
    });
  }

  // 부모 화면에서 온 메시지만 받아요.
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || event.data.type !== "bot-config") return;
    framedByMaker = true; // 만들기 화면의 미리보기: 데모만
    liveOn = false;
    const data = event.data;
    if (data.settings && typeof data.settings === "object") settings = { ...B.DEFAULT_SETTINGS, ...data.settings };
    if (Array.isArray(data.docs)) docs = data.docs.filter((d) => d && typeof d.text === "string" && typeof d.name === "string");
    apply();
  });

  start();
  if (framed) window.parent.postMessage({ type: "bot-ready" }, "*");
  // 셸 안에서 혼자 열린 위젯은 저장된 문서·설정을 읽고, 로그인했으면 실제 AI로 답해요.
  fromStorage()
    .then(checkLive)
    .then(() => {
      if (!framedByMaker) apply();
    });
})();
