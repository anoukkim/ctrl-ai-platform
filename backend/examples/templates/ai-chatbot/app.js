// AI 챗봇 — 이름과 말투를 정한 나만의 봇. 로그인한 CTRL+AI 회원에게는 Claude가 답하고,
// 로그인 전이거나 CTRL+AI 밖에서 열었으면 데모 답변을 보여 줘요.
(function () {
  "use strict";

  // CTRL+AI 안에서 돌 때만 window.ctrlai가 있어요. 밖에서는 localStorage로 저장해요.
  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const store = sdk
    ? sdk.storage
    : {
        get: async (k) => JSON.parse(localStorage.getItem(k) || "null"),
        set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)),
      };

  const COST = { fast: 10, smart: 30 }; // 1회 약 N원 (짧은 대화 기준)
  const MAX_TURNS = 8; // Claude에게 같이 보내는 최근 대화 수 (비용을 줄여요)
  const DEMO_ANSWERS = [
    "안녕하세요! 저는 데모 모드예요. CTRL+AI 회원으로 로그인하면 Claude가 진짜로 답해 드려요.",
    "좋은 질문이에요. 지금은 데모라서 미리 적어 둔 답만 보여 드릴 수 있어요.",
    "로그인하면 설정에서 정한 말투와 역할대로 답해요. 지금은 맛보기예요!",
  ];

  const $ = (id) => document.getElementById(id);
  const messagesEl = $("messages");
  const promptEl = $("prompt");
  const sendEl = $("send");
  const noticeEl = $("notice");
  const noticeText = $("notice-text");
  const loginButton = $("login-button");
  const costEl = $("cost");

  let settings = { name: "도움 봇", system: "친절하고 짧게, 존댓말로 답하는 도우미예요.", model: "fast" };
  let history = []; // { role: "me" | "bot", text, krw?, demo? }
  let user = null; // 로그인한 회원 { displayName, appUserId } 또는 null
  let busy = false;

  // ---------- 화면 그리기
  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function render() {
    $("bot-name").textContent = settings.name || "도움 봇";
    $("avatar").textContent = (settings.name || "봇").slice(0, 1);
    $("name-input").value = settings.name;
    $("system-input").value = settings.system;
    $("model-select").value = settings.model;
    costEl.textContent = `1회 약 ${COST[settings.model]}원 · 최대 200원 · 로그인한 회원의 동아리 지원금에서`;

    if (!sdk) {
      $("mode").textContent = "데모 · CTRL+AI 밖에서 열었어요";
      noticeText.textContent = "CTRL+AI 안에서 열면 실제 AI가 답해요. 지금은 데모 답변이에요.";
      loginButton.hidden = true;
      noticeEl.hidden = false;
    } else if (!user) {
      $("mode").textContent = "데모 · 로그인하면 실제 AI";
      noticeText.textContent = "CTRL+AI 회원만 실제 AI를 쓸 수 있어요. 지금은 데모 답변이에요.";
      loginButton.hidden = false;
      noticeEl.hidden = false;
    } else {
      $("mode").textContent = `실제 AI · ${user.displayName}님과 대화 중`;
      noticeEl.hidden = true;
    }

    messagesEl.innerHTML = history.length
      ? history
          .map((m) => {
            const meta =
              m.role === "bot"
                ? `<span class="meta${m.demo ? " demo" : ""}">${m.demo ? "데모 답변" : m.krw != null ? `${m.krw}원 · 내 동아리 지원금에서` : ""}</span>`
                : "";
            return `<li class="${m.role}">${esc(m.text)}${meta}</li>`;
          })
          .join("")
      : `<li class="empty">${esc(settings.name)}에게 첫 메시지를 보내 보세요.</li>`;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addError(text) {
    const li = document.createElement("li");
    li.className = "error";
    li.textContent = text;
    messagesEl.append(li);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------- 저장
  async function load() {
    const saved = await store.get("chatbot.settings");
    if (saved && typeof saved === "object") settings = { ...settings, ...saved };
    const past = await store.get("chatbot.history");
    if (Array.isArray(past)) history = past.slice(-60);
  }
  const saveSettings = () => store.set("chatbot.settings", settings);
  const saveHistory = () => store.set("chatbot.history", history.slice(-60));

  // ---------- 보내기
  function demoAnswer() {
    return DEMO_ANSWERS[history.filter((m) => m.role === "bot").length % DEMO_ANSWERS.length];
  }

  // 최근 대화를 글로 묶어 보내요 — ctrlai.ai는 한 번에 한 질문을 받아요.
  function promptWithHistory(text) {
    const recent = history.slice(-MAX_TURNS * 2);
    const lines = recent.map((m) => `${m.role === "me" ? "사용자" : settings.name}: ${m.text}`);
    lines.push(`사용자: ${text}`);
    return lines.join("\n");
  }

  async function send(text) {
    if (busy) return;
    busy = true;
    sendEl.disabled = true;
    history.push({ role: "me", text });
    render();

    if (!sdk || !user) {
      // 데모: 잠깐 뒤에 미리 적어 둔 답.
      await new Promise((r) => setTimeout(r, 400));
      history.push({ role: "bot", text: demoAnswer(), demo: true });
      render();
      await saveHistory();
      busy = false;
      sendEl.disabled = false;
      return;
    }

    // 실제 AI: 글자가 오는 대로 보여 줘요.
    const live = { role: "bot", text: "" };
    history.push(live);
    render();
    const lastLi = messagesEl.lastElementChild;
    try {
      const result = await sdk.ai.stream(
        {
          prompt: promptWithHistory(text),
          system: `당신의 이름은 "${settings.name}"입니다. ${settings.system}\n한국어로, 짧고 정확하게 답하세요. 모르면 모른다고 말하세요.`,
          model: settings.model,
        },
        (chunk) => {
          live.text += chunk;
          if (lastLi) lastLi.textContent = live.text; // 다 오면 render()가 금액까지 다시 그려요
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
      );
      live.text = result.text;
      live.krw = result.chargedKrw;
    } catch (error) {
      history.pop();
      if (error && error.code === "login_required") {
        user = null;
        addError("로그인이 풀렸어요. 다시 로그인해 주세요.");
      } else {
        addError(`답을 받지 못했어요: ${error && error.message ? error.message : "잠시 뒤 다시 시도해 주세요."}`);
      }
    }
    render();
    await saveHistory();
    busy = false;
    sendEl.disabled = false;
  }

  // ---------- 이벤트
  $("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = promptEl.value.trim();
    if (!text) return;
    promptEl.value = "";
    promptEl.style.height = "";
    send(text);
  });
  promptEl.addEventListener("keydown", (event) => {
    // Enter로 보내기, Shift+Enter로 줄 바꾸기. 한글 조합 중인 Enter는 보내지 않아요.
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("composer").requestSubmit();
    }
  });
  promptEl.addEventListener("input", () => {
    promptEl.style.height = "";
    promptEl.style.height = Math.min(promptEl.scrollHeight, 128) + "px";
  });

  $("settings-toggle").addEventListener("click", () => {
    const panel = $("settings");
    panel.hidden = !panel.hidden;
    $("settings-toggle").setAttribute("aria-expanded", String(!panel.hidden));
  });
  $("name-input").addEventListener("change", (e) => { settings.name = e.target.value.trim() || "도움 봇"; saveSettings(); render(); });
  $("system-input").addEventListener("change", (e) => { settings.system = e.target.value.trim(); saveSettings(); });
  $("model-select").addEventListener("change", (e) => { settings.model = e.target.value === "smart" ? "smart" : "fast"; saveSettings(); render(); });

  // 대화 지우기: 두 번 눌러야 지워져요 (alert·confirm 대신).
  let clearArmed = false;
  $("clear-chat").addEventListener("click", (e) => {
    if (!clearArmed) {
      clearArmed = true;
      e.target.textContent = "정말 지울까요?";
      setTimeout(() => { clearArmed = false; e.target.textContent = "대화 지우기"; }, 2500);
      return;
    }
    clearArmed = false;
    e.target.textContent = "대화 지우기";
    history = [];
    saveHistory();
    render();
  });

  loginButton.addEventListener("click", async () => {
    try {
      user = await sdk.login();
    } catch (error) {
      addError("로그인하지 못했어요. 다시 시도해 주세요.");
    }
    render();
  });

  // ---------- 시작
  load()
    .catch(() => {})
    .then(async () => {
      if (sdk) {
        try { user = await sdk.user(); } catch (error) { user = null; }
      }
      render();
    });
})();
