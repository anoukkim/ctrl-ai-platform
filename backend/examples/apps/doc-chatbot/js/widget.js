// 문서 챗봇 메이커 — 퍼가기 위젯.
// 만들기 화면 안의 미리보기라면 부모 화면이 설정과 문서를 보내 줘요(postMessage).
// 혼자 열렸다면 이 기기에 저장된 설정을, 그것도 없으면 샘플 문서를 써요.

(function () {
  const B = window.BOT;
  // 앱 주소(폴더)마다 따로 저장해요 — 같은 주소(apps.ctrlai.my)의 다른 앱과 섞이지 않게.
  const KEY = `doc-chatbot-v1:${location.pathname.replace(/[^/]*$/, "")}`;
  let settings = { ...B.DEFAULT_SETTINGS };
  let docs = B.SAMPLE_DOCS;
  let index = B.buildIndex(docs.flatMap(B.chunk));
  const framed = window.parent !== window;
  let chat = null;

  function fromStorage() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && Array.isArray(saved.docs)) {
        settings = { ...B.DEFAULT_SETTINGS, ...saved.settings };
        docs = saved.docs;
      }
    } catch (error) {
      /* 저장소를 못 쓰면 샘플 문서로 */
    }
  }

  function apply() {
    index = B.buildIndex(docs.flatMap(B.chunk));
    if (chat) chat.reset();
  }

  function start() {
    chat = B.mountChat(document.getElementById("widget"), {
      settings: () => settings,
      index: () => index,
      summary: () => "문서로 답하는 챗봇 · 데모",
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
    const data = event.data;
    if (data.settings && typeof data.settings === "object") settings = { ...B.DEFAULT_SETTINGS, ...data.settings };
    if (Array.isArray(data.docs)) docs = data.docs.filter((d) => d && typeof d.text === "string" && typeof d.name === "string");
    apply();
  });

  if (!framed) fromStorage();
  index = B.buildIndex(docs.flatMap(B.chunk));
  start();
  if (framed) window.parent.postMessage({ type: "bot-ready" }, "*");
})();
