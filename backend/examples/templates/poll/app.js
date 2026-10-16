// 투표·설문 — 질문과 보기를 올리면 회원들이 한 표씩. 결과는 모두가 봐요.
// 데이터는 CTRL+AI 기능 상자의 공유 목록(ctrlai.db)에 있어요: polls(투표), votes(표).
// 두 목록은 ctrlai.json에 적혀 있어요.
(function () {
  "use strict";

  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const SHARED = { shared: true };
  const MAX_OPTIONS = 5;
  const PAGE = 100; // 한 번에 받는 표의 수 (limit의 최댓값)

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let user = null;
  let polls = []; // { id, data: { question, options, closed }, author, mine, canDelete }
  let votes = {}; // pollId → { counts: [..], total, myChoice }
  let busy = false;

  // ---------- CTRL+AI 밖(데모): 메모리 안의 예시 투표
  const demo = {
    polls: [
      { id: "demo1", data: { question: "다음 모임 장소는? (데모)", options: ["학교 앞 카페", "동아리방", "온라인"], closed: false }, author: { displayName: "예시 회원" }, mine: false, canDelete: false },
    ],
    votes: { demo1: [["학교 앞 카페", 3], ["동아리방", 5], ["온라인", 1]] },
    myChoice: {},
  };

  // ---------- 데이터
  async function loadPolls() {
    if (!sdk) {
      polls = demo.polls;
      votes = {};
      demo.polls.forEach((p) => {
        const counts = p.data.options.map((o) => (demo.votes[p.id].find((v) => v[0] === o) || [o, 0])[1]);
        votes[p.id] = { counts, total: counts.reduce((a, b) => a + b, 0), myChoice: demo.myChoice[p.id] || null };
      });
      return;
    }
    const page = await sdk.db.list("polls", { ...SHARED, limit: 50 });
    polls = page.items;
    await Promise.all(polls.map(loadVotes));
  }

  // 한 투표의 표를 모두 세요 (100개씩, 최대 500개).
  async function loadVotes(poll) {
    const counts = poll.data.options.map(() => 0);
    let myChoice = null;
    let cursor = null;
    for (let i = 0; i < 5; i += 1) {
      const page = await sdk.db.list("votes", { ...SHARED, where: { pollId: poll.id }, limit: PAGE, cursor });
      page.items.forEach((v) => {
        const index = poll.data.options.indexOf(v.data.choice);
        if (index >= 0) counts[index] += 1;
        if (v.mine) myChoice = v.data.choice;
      });
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    votes[poll.id] = { counts, total: counts.reduce((a, b) => a + b, 0), myChoice };
  }

  async function vote(poll, choice) {
    if (busy) return;
    if (!sdk) {
      demo.myChoice[poll.id] = choice;
      demo.votes[poll.id] = poll.data.options.map((o) => [o, (demo.votes[poll.id].find((v) => v[0] === o) || [o, 0])[1] + (o === choice ? 1 : 0)]);
      await loadPolls();
      render();
      return;
    }
    busy = true;
    try {
      // 저장은 로그인이 필요해요 — 로그인 전이면 기능 상자가 로그인 창을 먼저 열어요.
      await sdk.db.save("votes", { pollId: poll.id, choice }, SHARED);
      user = await sdk.user();
      await loadVotes(poll);
    } catch (error) {
      showNotice(error && error.code === "login_required" ? "로그인해야 투표할 수 있어요." : `투표하지 못했어요: ${error.message}`);
    }
    busy = false;
    render();
  }

  async function createPoll(question, options) {
    if (!sdk) {
      demo.polls.unshift({ id: "demo" + Date.now(), data: { question: question + " (데모)", options, closed: false }, author: { displayName: "나" }, mine: true, canDelete: true });
      demo.votes[demo.polls[0].id] = options.map((o) => [o, 0]);
      await loadPolls();
      return;
    }
    await sdk.db.save("polls", { question, options, closed: false }, SHARED);
    user = await sdk.user();
    await loadPolls();
  }

  async function closePoll(poll) {
    if (!sdk) { poll.data.closed = true; render(); return; }
    try {
      await sdk.db.update("polls", poll.id, { closed: true }, SHARED);
      await loadPolls();
    } catch (error) {
      showNotice(`마감하지 못했어요: ${error.message}`);
    }
    render();
  }

  async function removePoll(poll) {
    if (!sdk) { demo.polls = demo.polls.filter((p) => p !== poll); await loadPolls(); render(); return; }
    try {
      await sdk.db.remove("polls", poll.id, SHARED);
      await loadPolls();
    } catch (error) {
      showNotice(`삭제하지 못했어요: ${error.message}`);
    }
    render();
  }

  // ---------- 화면
  function showNotice(text, withLogin) {
    $("notice-text").textContent = text;
    $("login-button").hidden = !withLogin;
    $("notice").hidden = false;
  }

  function render() {
    if (!sdk) {
      $("who").textContent = "데모 · CTRL+AI 밖에서 열었어요";
      showNotice("CTRL+AI 안에서 열면 회원들의 표가 진짜로 모여요. 지금은 데모예요.", false);
    } else if (!user) {
      $("who").textContent = "둘러보는 중 · 투표하려면 로그인";
      showNotice("CTRL+AI 회원만 투표하고 질문을 올릴 수 있어요.", true);
    } else {
      $("who").textContent = `${user.displayName}님`;
      $("notice").hidden = true;
    }

    const root = $("polls");
    if (!polls.length) {
      root.innerHTML = `<p class="empty">아직 투표가 없어요. 첫 질문을 올려 보세요.</p>`;
      return;
    }
    root.innerHTML = polls
      .map((poll) => {
        const v = votes[poll.id] || { counts: [], total: 0, myChoice: null };
        const max = Math.max(0, ...v.counts);
        const voted = v.myChoice !== null;
        const closed = !!poll.data.closed;
        const options = poll.data.options
          .map((label, i) => {
            const count = v.counts[i] || 0;
            const pct = v.total ? Math.round((count / v.total) * 100) : 0;
            const classes = ["opt", v.myChoice === label ? "mine" : "", max > 0 && count === max && v.total ? "top" : ""].join(" ");
            const disabled = closed || voted || busy ? "disabled" : "";
            return `<button type="button" class="${classes}" data-poll="${esc(poll.id)}" data-choice="${esc(label)}" ${disabled} aria-label="${esc(label)} ${count}표">
              <span class="bar" style="width:${pct}%"></span>
              <span class="label"><span>${esc(label)}</span><span class="count">${count}표 · ${pct}%</span></span>
            </button>`;
          })
          .join("");
        const actions = [];
        // 마감은 고치기라서 올린 사람만(ctrlai.db.update는 쓴 사람만 돼요); 앱 주인은 삭제만.
        if (poll.mine && !closed) actions.push(`<button type="button" class="ghost small" data-close="${esc(poll.id)}">마감</button>`);
        if (poll.mine || poll.canDelete) actions.push(`<button type="button" class="ghost small" data-remove="${esc(poll.id)}">삭제</button>`);
        return `<article class="card poll">
          <h2>${esc(poll.data.question)}${closed ? '<span class="closed">마감</span>' : ""}</h2>
          <p class="meta">${esc(poll.author ? poll.author.displayName : "")} · ${v.total}명 참여${voted ? " · 내 표: " + esc(v.myChoice) : ""}${sdk ? "" : ' · <span class="demo">데모</span>'}</p>
          ${options}
          ${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}
        </article>`;
      })
      .join("");
  }

  // ---------- 이벤트
  $("polls").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const poll = polls.find((p) => p.id === (button.dataset.poll || button.dataset.close || button.dataset.remove));
    if (!poll) return;
    if (button.dataset.choice !== undefined) return vote(poll, button.dataset.choice);
    if (button.dataset.close) return closePoll(poll);
    if (button.dataset.remove) {
      // 두 번 눌러야 지워져요 (alert·confirm 대신).
      if (button.dataset.armed) return removePoll(poll);
      button.dataset.armed = "1";
      button.textContent = "정말 삭제할까요?";
      setTimeout(() => { delete button.dataset.armed; button.textContent = "삭제"; }, 2500);
    }
  });

  $("new-toggle").addEventListener("click", () => {
    const form = $("new-poll");
    form.hidden = !form.hidden;
    $("new-toggle").setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) $("question").focus();
  });
  $("cancel-new").addEventListener("click", () => { $("new-poll").hidden = true; $("new-toggle").setAttribute("aria-expanded", "false"); });
  $("add-option").addEventListener("click", () => {
    const inputs = $("option-inputs");
    if (inputs.children.length >= MAX_OPTIONS) return;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 40;
    input.placeholder = `보기 ${inputs.children.length + 1}`;
    inputs.append(input);
    input.focus();
  });
  $("new-poll").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("new-error");
    error.hidden = true;
    const question = $("question").value.trim();
    const options = [...$("option-inputs").querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
    if (!question || options.length < 2) { error.textContent = "질문과 보기 2개 이상을 적어 주세요."; error.hidden = false; return; }
    if (new Set(options).size !== options.length) { error.textContent = "같은 보기가 두 번 있어요."; error.hidden = false; return; }
    $("create-poll").disabled = true;
    try {
      await createPoll(question, options);
      $("new-poll").reset();
      $("new-poll").hidden = true;
      $("new-toggle").setAttribute("aria-expanded", "false");
    } catch (err) {
      error.textContent = err && err.code === "login_required" ? "로그인해야 투표를 올릴 수 있어요." : `올리지 못했어요: ${err.message}`;
      error.hidden = false;
    }
    $("create-poll").disabled = false;
    render();
  });
  $("login-button").addEventListener("click", async () => {
    try { user = await sdk.login(); await loadPolls(); } catch (error) { showNotice("로그인하지 못했어요. 다시 시도해 주세요.", true); return; }
    render();
  });

  // ---------- 시작
  (async () => {
    if (sdk) { try { user = await sdk.user(); } catch (error) { user = null; } }
    try { await loadPolls(); } catch (error) { showNotice(`불러오지 못했어요: ${error.message}`, false); }
    render();
  })();
})();
