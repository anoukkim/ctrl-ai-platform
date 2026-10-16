// 색 맞추기 랭킹 — 20초 동안 글자의 "색"을 맞혀요. 누구나 할 수 있고,
// 점수는 로그인한 회원만 공유 랭킹(ctrlai.db의 scores 목록)에 올라가요.
(function () {
  "use strict";

  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const SHARED = { shared: true };
  const SECONDS = 20;
  const COLORS = [
    { key: "red", name: "빨강", css: "#ff5c7a" },
    { key: "blue", name: "파랑", css: "#5aa9ff" },
    { key: "green", name: "초록", css: "#5ff28a" },
    { key: "yellow", name: "노랑", css: "#ffd95c" },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let user = null;
  let playing = false;
  let score = 0;
  let timeLeft = SECONDS;
  let answer = null; // 지금 글자의 색 (정답)
  let timer = null;
  let saved = false;

  // CTRL+AI 밖(데모): 기기 안의 예시 랭킹.
  const demoBoard = [
    { data: { score: 18 }, author: { displayName: "예시 회원" }, mine: false },
    { data: { score: 12 }, author: { displayName: "예시 회원 2" }, mine: false },
  ];

  // ---------- 게임
  function pick() {
    const word = COLORS[Math.floor(Math.random() * COLORS.length)];
    let color = COLORS[Math.floor(Math.random() * COLORS.length)];
    // 반쯤은 뜻과 색이 달라야 헷갈려요.
    if (Math.random() < 0.6) while (color === word) color = COLORS[Math.floor(Math.random() * COLORS.length)];
    answer = color.key;
    const el = $("word");
    el.textContent = word.name;
    el.style.color = color.css;
  }

  function start() {
    playing = true;
    score = 0;
    timeLeft = SECONDS;
    saved = false;
    $("score").textContent = "0";
    $("time").textContent = String(SECONDS);
    $("result").hidden = true;
    $("start-area").hidden = true;
    [...$("pads").children].forEach((b) => { b.disabled = false; });
    pick();
    timer = setInterval(() => {
      timeLeft -= 1;
      $("time").textContent = String(timeLeft);
      if (timeLeft <= 0) end();
    }, 1000);
  }

  function end() {
    clearInterval(timer);
    playing = false;
    [...$("pads").children].forEach((b) => { b.disabled = true; });
    $("word").textContent = "끝!";
    $("word").style.color = "";
    $("final-score").textContent = String(score);
    $("result-note").textContent = !sdk
      ? "데모 — CTRL+AI 안에서 열면 회원 랭킹에 올라가요."
      : user
        ? `${user.displayName}님 이름으로 랭킹에 올려요.`
        : "올리려면 CTRL+AI 로그인이 필요해요 (버튼을 누르면 로그인 창이 열려요).";
    $("submit").disabled = false;
    $("submit").textContent = "랭킹에 올리기";
    $("submit-error").hidden = true;
    $("result").hidden = false;
    $("start-area").hidden = false;
  }

  function tap(key) {
    if (!playing) return;
    const button = $("pads").querySelector(`[data-key="${key}"]`);
    if (key === answer) { score += 1; flash(button, "hit"); }
    else { score -= 1; flash(button, "miss"); }
    $("score").textContent = String(score);
    pick();
  }

  function flash(button, cls) {
    button.classList.add(cls);
    setTimeout(() => button.classList.remove(cls), 150);
  }

  // ---------- 랭킹
  async function loadBoard() {
    const list = $("board");
    let rows;
    let best = null;
    if (!sdk) {
      rows = demoBoard.slice().sort((a, b) => b.data.score - a.data.score);
      $("board-badge").textContent = "데모";
    } else {
      rows = (await sdk.db.list("scores", { ...SHARED, orderBy: "score", order: "desc", limit: 10 })).items;
      $("board-badge").textContent = `상위 ${rows.length}`;
      if (user) {
        const mine = await sdk.db.list("scores", { ...SHARED, mine: true, orderBy: "score", order: "desc", limit: 1 });
        best = mine.items[0] ? mine.items[0].data.score : null;
      }
    }
    $("best").textContent = best !== null ? `내 최고 점수: ${best}점` : "";
    list.innerHTML = rows.length
      ? rows
          .map((r, i) => `<li><span class="rank">${i + 1}</span><span class="name${r.mine ? " me" : ""}">${esc(r.author ? r.author.displayName : "?")}${r.mine ? " (나)" : ""}</span><span class="pts">${esc(r.data.score)}점</span></li>`)
          .join("")
      : `<li class="empty">아직 아무도 없어요. 첫 기록을 올려 보세요!</li>`;
  }

  async function submit() {
    if (saved) return;
    const button = $("submit");
    button.disabled = true;
    $("submit-error").hidden = true;
    try {
      if (!sdk) {
        demoBoard.push({ data: { score }, author: { displayName: "나 (데모)" }, mine: true });
      } else {
        // 로그인 전이면 기능 상자가 로그인 창을 먼저 열고, 허용하면 저장돼요.
        await sdk.db.save("scores", { score, seconds: SECONDS }, SHARED);
        user = await sdk.user();
      }
      saved = true;
      button.textContent = "올렸어요 ✓";
      await loadBoard();
      render();
    } catch (error) {
      button.disabled = false;
      $("submit-error").textContent = error && error.code === "login_required" ? "로그인해야 랭킹에 올릴 수 있어요." : `올리지 못했어요: ${error.message}`;
      $("submit-error").hidden = false;
    }
  }

  // ---------- 화면
  function render() {
    if (!sdk) {
      $("notice-text").textContent = "CTRL+AI 안에서 열면 회원 랭킹이 진짜로 모여요. 지금은 데모예요.";
      $("login-button").hidden = true;
      $("notice").hidden = false;
    } else if (!user) {
      $("notice-text").textContent = "게임은 누구나. 점수를 올리려면 CTRL+AI 회원 로그인이 필요해요.";
      $("login-button").hidden = false;
      $("notice").hidden = false;
    } else {
      $("notice").hidden = true;
    }
  }

  // ---------- 이벤트
  $("pads").innerHTML = COLORS.map((c) => `<button type="button" class="c-${c.key}" data-key="${c.key}" disabled>${c.name}</button>`).join("");
  $("pads").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-key]");
    if (button) tap(button.dataset.key);
  });
  // 키보드로도: 1 2 3 4.
  document.addEventListener("keydown", (event) => {
    const index = ["1", "2", "3", "4"].indexOf(event.key);
    if (index >= 0) tap(COLORS[index].key);
  });
  $("start").addEventListener("click", start);
  $("again").addEventListener("click", start);
  $("submit").addEventListener("click", submit);
  $("login-button").addEventListener("click", async () => {
    try { user = await sdk.login(); } catch (error) { return; }
    render();
    loadBoard().catch(() => {});
  });

  // ---------- 시작
  (async () => {
    if (sdk) { try { user = await sdk.user(); } catch (error) { user = null; } }
    render();
    try { await loadBoard(); } catch (error) { $("board").innerHTML = `<li class="empty">랭킹을 불러오지 못했어요: ${esc(error.message)}</li>`; }
  })();
})();
