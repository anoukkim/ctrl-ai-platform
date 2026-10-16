// 영수증 가계부 — 화면. 데이터는 이 기기에만 저장돼요(CTRL+AI 안에서는 ctrlai.storage, 밖에서는 localStorage).

(function () {
  const L = window.LEDGER;
  const KEY = "receipt-ledger-v1";
  // CTRL+AI 안에서는 ctrlai.storage(이 앱 · 이 방문자만의 저장 공간)에,
  // 밖에서(내려받아 연 파일) 열면 이 브라우저의 localStorage에 저장해요.
  const store =
    window.ctrlai && window.ctrlai.connected
      ? window.ctrlai.storage
      : {
          get: (key) => Promise.resolve().then(() => JSON.parse(localStorage.getItem(key) || "null")),
          set: (key, value) => Promise.resolve().then(() => localStorage.setItem(key, JSON.stringify(value))),
        };
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = L.esc;
  const won = L.won;

  // ---------------------------------------------------------------- 실제 AI (CTRL+AI 기능 상자, app-platform P4b)
  // CTRL+AI 안에서 로그인한 회원은 Claude가 영수증을 읽고 소비 패턴을 써 줘요 — 방문자 자신의
  // 동아리 지원금에서, 버튼을 눌렀을 때만. 로그인 전이거나 밖에서 열면 데모 데이터예요.
  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const MODE_KEY = "receipt-ledger-mode"; // "live" | "demo" — 이 기기에 기억해요
  const live = { user: null, on: false, prices: {}, busy: false };
  const RECEIPT_SCHEMA = {
    type: "object",
    required: ["shop", "date", "items", "total", "category"],
    additionalProperties: false,
    properties: {
      shop: { type: "string" },
      date: { type: "string" },
      items: { type: "array", maxItems: 30, items: { type: "object", required: ["name", "amount"], additionalProperties: false, properties: { name: { type: "string" }, amount: { type: "integer" } } } },
      total: { type: "integer" },
      category: { type: "string", enum: L.CATEGORIES },
    },
  };
  const PATTERN_SCHEMA = {
    type: "object",
    required: ["headline", "points", "tip"],
    additionalProperties: false,
    properties: { headline: { type: "string" }, points: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } }, tip: { type: "string" } },
  };
  const READ_SYSTEM = `한국 영수증 사진을 읽어 JSON으로 정리하는 도우미예요. 상호, 날짜(YYYY-MM-DD), 품목별 금액(원, 정수), 합계, 카테고리(${L.CATEGORIES.join("·")} 중 하나)를 채워요. 못 읽는 값은 빈 글자나 0으로 두세요.`;
  const readOptions = (image) => ({ system: READ_SYSTEM, prompt: "이 영수증을 읽어 주세요.", images: image ? [image] : 1, json: RECEIPT_SCHEMA, maxTokens: 700 });
  const patternOptions = (month, sums, prevSums) => ({
    system: "가계부의 한 달 지출을 보고 짧은 한국어 분석을 써요. headline 한 문장, points 2~3개(숫자를 넣어 구체적으로), tip 한 문장(실천할 수 있는 절약 팁).",
    prompt: `${monthLabel(month)} 카테고리별 지출(원): ${L.CATEGORIES.map((c) => `${c} ${sums[c] || 0}`).join(", ")}\n전월: ${L.CATEGORIES.map((c) => `${c} ${prevSums[c] || 0}`).join(", ")}`,
    json: PATTERN_SCHEMA,
    maxTokens: 400,
  });
  // "1회 약 N원 · 최대 M원" — 같은 옵션으로 부르면 최대 금액을 넘지 않아요 (재시도 포함).
  function priceLine(key, options) {
    const p = live.prices[key];
    if (p === undefined) {
      live.prices[key] = null; // 받는 중
      sdk.ai.estimate(options).then(
        (figures) => {
          live.prices[key] = figures;
          render();
        },
        () => {
          live.prices[key] = false;
          render();
        },
      );
      return "비용 확인 중…";
    }
    if (!p) return "1회 최대 200원";
    return `1회 약 ${p.typicalKrw}원 · 최대 ${p.maxKrw}원`;
  }
  function modeBadge() {
    const badge = $(".badge.demoAll");
    const toggle = $("#mode-toggle");
    if (!badge) return;
    if (!sdk) {
      badge.textContent = "데모 데이터";
      if (toggle) toggle.hidden = true;
      return;
    }
    badge.textContent = live.on ? "실제 AI · 내 지원금에서" : "데모 데이터";
    badge.classList.toggle("liveAll", live.on);
    if (toggle) {
      toggle.hidden = false;
      toggle.textContent = live.on ? "데모 데이터로 보기" : live.user ? "실제 AI 켜기" : "실제 AI로 써 보기 (로그인)";
    }
  }
  async function setMode(on) {
    if (on && !live.user) {
      try {
        live.user = await sdk.login();
      } catch (error) {
        toast("로그인하지 않았어요. 데모로 계속해요.");
        return;
      }
    }
    // app-ai-access: 만든 사람이 '데모만'으로 두었거나 방문자가 CTRL+AI의 데모
    // 스위치를 켰으면 실제 AI는 켜지지 않아요 (0원).
    if (on && sdk.ai.mode && (await sdk.ai.mode().catch(() => "live")) === "demo") {
      toast("지금은 데모로만 볼 수 있어요. 실제 AI는 앱 맨 위 CTRL+AI 줄에서 켜요.");
      return;
    }
    live.on = on;
    store.set(MODE_KEY, on ? "live" : "demo").catch(() => {});
    modeBadge();
    render();
  }
  // SVG 샘플은 PNG로 바꿔 보내요 (AI는 PNG·JPEG·WebP·GIF만 받아요).
  function toPng(dataUrl) {
    if (!dataUrl.startsWith("data:image/svg")) return Promise.resolve(dataUrl);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 720;
        canvas.height = Math.max(200, Math.round((720 * (img.height || 1000)) / (img.width || 480)));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => reject(new Error("이미지를 읽지 못했어요"));
      img.src = dataUrl;
    });
  }
  // CtrlAIApps 미리보기처럼 다른 화면 안에 들어 있으면 파일 내려받기가 막혀요.
  // CTRL+AI 안에서는 앱이 늘 기능 상자(셸) 안에 있으니, 셸에게 물어봐요.
  let FRAMED_NOTE = "";
  function framedNote(framed) {
    FRAMED_NOTE = framed
      ? `<p class="muted small">이 창은 미리보기라 파일 내려받기가 막혀 있어요. CtrlAIApps의 '앱 실행'으로 새 탭에서 열면 돼요.</p>`
      : "";
  }
  if (!(window.ctrlai && window.ctrlai.connected)) {
    try {
      framedNote(window.top !== window.self);
    } catch (e) {
      framedNote(true);
    }
  }

  // ---------------------------------------------------------------- 저장
  function freshState() {
    return { transactions: L.seedTransactions(), budget: { ...L.DEFAULT_BUDGET } };
  }
  function save() {
    store.set(KEY, state).catch(() => {
      /* 저장소가 막혀 있어도 화면은 계속 씁니다 */
    });
  }
  // 저장된 것을 불러오기 전까지는 데모 데이터(맨 아래 '시작'에서 바꿔요).
  let state = freshState();

  // ---------------------------------------------------------------- 도움
  const monthOf = (date) => date.slice(0, 7);
  const currentMonth = () => L.dateFor(0, 1).slice(0, 7);
  const offsetOf = (month) => {
    const [y, m] = month.split("-").map(Number);
    const now = new Date();
    return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
  };
  const monthLabel = (month) => `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
  const prevMonth = (month) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const byCategory = (rows) => {
    const sums = Object.fromEntries(L.CATEGORIES.map((c) => [c, 0]));
    for (const row of rows) sums[row.category] = (sums[row.category] || 0) + row.total;
    return sums;
  };
  const inMonth = (month) => state.transactions.filter((t) => monthOf(t.date) === month);
  const months = () => {
    const set = new Set(state.transactions.map((t) => monthOf(t.date)));
    set.add(currentMonth());
    return [...set].sort().reverse();
  };

  let view = "dashboard";
  let dashMonth = currentMonth();
  let filters = { q: "", month: "all", category: "all" };
  let draft = null; // 영수증 추가 중인 내용

  // 두 번 눌러야 실행되는 버튼(확인 대화상자 대신).
  function armed(button, label, run) {
    if (button.dataset.armed === "1") {
      run();
      return;
    }
    const original = button.textContent;
    button.dataset.armed = "1";
    button.textContent = label;
    button.classList.add("danger");
    setTimeout(() => {
      button.dataset.armed = "";
      button.textContent = original;
      button.classList.remove("danger");
    }, 3000);
  }

  // ---------------------------------------------------------------- 탭
  function go(next) {
    view = next;
    for (const tab of document.querySelectorAll("[data-view]")) {
      tab.setAttribute("aria-selected", String(tab.dataset.view === view));
    }
    render();
    $("#main").focus();
  }

  function render() {
    const main = $("#main");
    if (view === "dashboard") main.innerHTML = dashboardHtml();
    else if (view === "list") main.innerHTML = listHtml();
    else if (view === "add") main.innerHTML = addHtml();
    else main.innerHTML = budgetHtml();
    bind();
  }

  // ---------------------------------------------------------------- 대시보드
  function dashboardHtml() {
    const rows = inMonth(dashMonth);
    const prevRows = inMonth(prevMonth(dashMonth));
    const sums = byCategory(rows);
    const prevSums = byCategory(prevRows);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const prevTotal = prevRows.reduce((s, r) => s + r.total, 0);
    const [y, m] = dashMonth.split("-").map(Number);
    const days = new Date(y, m, 0).getDate();
    const daily = Array.from({ length: days }, () => 0);
    for (const r of rows) daily[Number(r.date.slice(8, 10)) - 1] += r.total;

    const parts = L.CATEGORIES.map((c) => ({ label: c, value: sums[c], color: L.CATEGORY_COLORS[c] }));
    const legend = parts
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((p) => `<li><span class="swatch" style="background:${p.color}"></span>${p.label}<b>${won(p.value)}</b></li>`)
      .join("");
    const diff = (now, before) => {
      if (!before) return `<span class="flat">비교할 전월 내역 없음</span>`;
      const pct = Math.round(((now - before) / before) * 100);
      const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
      return `<span class="${cls}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "–"} ${Math.abs(pct)}%</span>`;
    };
    const topChange = L.CATEGORIES.map((c) => ({ c, d: sums[c] - prevSums[c] })).sort((a, b) => b.d - a.d)[0];

    return `
      <div class="toolbar">
        <label class="month">달 <select id="dash-month">${months()
          .map((mo) => `<option value="${mo}" ${mo === dashMonth ? "selected" : ""}>${monthLabel(mo)}</option>`)
          .join("")}</select></label>
      </div>
      <section class="cards">
        <article class="card stat"><h3>이번 달 지출</h3><p class="big">${won(total)}</p><p>전월 대비 ${diff(total, prevTotal)}</p></article>
        <article class="card stat"><h3>가장 많이 늘어난 곳</h3><p class="big">${topChange && topChange.d > 0 ? topChange.c : "없음"}</p><p>${topChange && topChange.d > 0 ? `+${won(topChange.d)}` : "전월보다 늘어난 카테고리가 없어요"}</p></article>
        <article class="card stat"><h3>기록한 영수증</h3><p class="big">${rows.length}건</p><p>하루 평균 ${won(total / Math.max(1, offsetOf(dashMonth) === 0 ? new Date().getDate() : days))}</p></article>
      </section>
      ${patternHtml(dashMonth, sums)}
      <section class="grid2">
        <article class="card"><h3>카테고리별</h3><div class="donutWrap">${L.donut(parts, won(total), `${rows.length}건`)}<ul class="legend">${legend || "<li>아직 내역이 없어요</li>"}</ul></div></article>
        <article class="card"><h3>일별 지출</h3>${L.lineChart(daily, `${monthLabel(dashMonth)} 일별 지출 그래프`, dashMonth === currentMonth() ? new Date().getDate() : days)}</article>
      </section>
      <section class="card"><h3>예산 사용</h3>${budgetBars(sums)}</section>`;
  }

  function patternHtml(month, sums) {
    if (live.on && sdk) {
      const made = (state.patterns || {})[month];
      if (made) {
        return `<section class="card pattern">
          <h3>이번 달 소비 패턴 <span class="demo live">실제 AI · ${made.krw}원</span></h3>
          <p class="headline">${esc(made.headline)}</p>
          <ul>${made.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
          <p class="tip">💡 ${esc(made.tip)}</p>
          <button type="button" class="ghost" id="pattern-ai" data-month="${month}">다시 쓰기 · ${priceLine("pattern", patternOptions(month, sums, byCategory(inMonth(prevMonth(month)))))}</button>
        </section>`;
      }
      return `<section class="card pattern">
        <h3>이번 달 소비 패턴 <span class="demo live">실제 AI</span></h3>
        <p class="muted">Claude가 이 달 내역을 보고 분석을 써 줘요. 버튼을 눌렀을 때만 내 지원금에서 나가요.</p>
        <button type="button" class="primary" id="pattern-ai" data-month="${month}" ${live.busy ? "disabled" : ""}>${live.busy ? "쓰는 중…" : `분석 쓰기 · ${priceLine("pattern", patternOptions(month, sums, byCategory(inMonth(prevMonth(month)))))}`}</button>
      </section>`;
    }
    const note = L.PATTERN_NOTES[String(offsetOf(month))];
    if (!note) {
      return `<section class="card pattern"><h3>이번 달 소비 패턴 <span class="demo">데모</span></h3><p class="muted">이 달의 예시 분석은 없어요. ${sdk ? "실제 AI를 켜면 Claude가 실제 내역으로 써 줘요." : "CTRL+AI 안에서 로그인하면 Claude가 써 줘요."}</p></section>`;
    }
    const fill = (text) => text.replace(/\{(.+?)\}/g, (_, c) => (sums[c] || 0).toLocaleString("ko-KR"));
    return `<section class="card pattern">
      <h3>이번 달 소비 패턴 <span class="demo">데모</span></h3>
      <p class="headline">${esc(note.headline)}</p>
      <ul>${note.points.map((p) => `<li>${esc(fill(p))}</li>`).join("")}</ul>
      <p class="tip">💡 ${esc(note.tip)}</p>
      <p class="muted small">미리 써 둔 예시 분석이에요. ${sdk ? "실제 AI를 켜면" : "CTRL+AI 안에서 로그인하면"} Claude가 실제 내역을 보고 써 줘요.</p>
    </section>`;
  }

  function budgetBars(sums) {
    return `<ul class="bars">${L.CATEGORIES.map((c) => {
      const budget = state.budget[c] || 0;
      const used = sums[c] || 0;
      const pct = budget ? Math.round((used / budget) * 100) : 0;
      const badge = pct >= 100 ? `<span class="badge warn">경고</span>` : pct >= 80 ? `<span class="badge caution">주의</span>` : "";
      return `<li><span class="barLabel">${c} ${badge}</span><span class="bar" role="progressbar" aria-label="${c} 예산 사용" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100, pct)}%;background:${L.CATEGORY_COLORS[c]}"></span></span><span class="barNum">${won(used)} / ${won(budget)} <b>${pct}%</b></span></li>`;
    }).join("")}</ul>`;
  }

  // ---------------------------------------------------------------- 내역
  function filtered() {
    const q = filters.q.trim().toLowerCase();
    return state.transactions.filter(
      (t) =>
        (filters.month === "all" || monthOf(t.date) === filters.month) &&
        (filters.category === "all" || t.category === filters.category) &&
        (!q || t.shop.toLowerCase().includes(q) || t.items.some((i) => i.name.toLowerCase().includes(q))),
    );
  }

  function listHtml() {
    const rows = filtered();
    const sum = rows.reduce((s, r) => s + r.total, 0);
    return `
      <div class="toolbar wrap">
        <input id="q" type="search" placeholder="상호나 품목으로 찾기" value="${esc(filters.q)}" aria-label="내역 검색">
        <select id="f-month" aria-label="달"><option value="all">모든 달</option>${months()
          .map((mo) => `<option value="${mo}" ${filters.month === mo ? "selected" : ""}>${monthLabel(mo)}</option>`)
          .join("")}</select>
        <select id="f-cat" aria-label="카테고리"><option value="all">모든 카테고리</option>${L.CATEGORIES.map(
          (c) => `<option ${filters.category === c ? "selected" : ""}>${c}</option>`,
        ).join("")}</select>
        <button id="csv" class="ghost" type="button">CSV 내려받기</button>
      </div>
      ${FRAMED_NOTE}
      <p class="muted">${rows.length}건 · 합계 ${won(sum)}</p>
      <ul class="rows">${rows
        .map(
          (t) => `<li><button type="button" class="row" data-open="${t.id}">
            <span class="dotc" style="background:${L.CATEGORY_COLORS[t.category]}"></span>
            <span class="rowMain"><b>${esc(t.shop)}</b><small>${t.date} · ${t.category}</small></span>
            <span class="rowAmt">${won(t.total)}</span></button></li>`,
        )
        .join("") || `<li class="muted">조건에 맞는 내역이 없어요.</li>`}</ul>
      <div id="detail"></div>`;
  }

  function detailHtml(t) {
    const image = t.sampleId ? `<img class="receiptImg" src="${L.receiptDataUrl(t.sampleId)}" alt="${esc(t.shop)} 샘플 영수증">` : "";
    return `<div class="scrim" data-close-detail></div><section class="card detail" role="dialog" aria-modal="true" aria-label="내역 자세히">
      <div class="detailHead"><h3>${esc(t.shop)}</h3><button type="button" class="ghost" id="close-detail">닫기</button></div>
      <div class="detailBody">${image}<div>
        <p class="muted">${t.date}${t.source === "sample" ? ` · <span class="demo">데모</span> 미리 만든 추출 결과` : ""}</p>
        <table class="items"><tbody>${t.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${won(i.amount)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><th>합계</th><th>${won(t.total)}</th></tr></tfoot></table>
        <label>카테고리 <select id="detail-cat">${L.CATEGORIES.map((c) => `<option ${c === t.category ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <button type="button" class="ghost" id="delete-tx">이 내역 지우기</button>
      </div></div></section>`;
  }

  function exportCsv() {
    const rows = filtered();
    const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["날짜", "상호", "카테고리", "품목", "합계"].map(quote).join(",")];
    for (const t of rows) {
      lines.push([t.date, t.shop, t.category, t.items.map((i) => `${i.name} ${i.amount}`).join(" / "), t.total].map(quote).join(","));
    }
    // 엑셀이 한글을 바로 읽도록 맨 앞에 BOM을 붙입니다.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `가계부-${filters.month === "all" ? "전체" : filters.month}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ---------------------------------------------------------------- 영수증 추가
  function addHtml() {
    if (draft && draft.stage === "review") return reviewHtml();
    if (draft && draft.stage === "reading") {
      return `<section class="card center"><img class="receiptImg" src="${draft.image}" alt="올린 영수증"><p class="reading" role="status">영수증을 읽는 중…</p></section>`;
    }
    return `
      <section class="card">
        <h3>영수증 올리기</h3>
        <label class="drop" id="drop" tabindex="0">
          <input id="file" type="file" accept="image/*" hidden>
          <span class="dropIcon" aria-hidden="true">🧾</span>
          <b>영수증 사진을 여기에 끌어다 놓거나 눌러서 고르세요</b>
          <small>${live.on
            ? `실제 AI(Claude)가 읽어요 · 사진 읽기 ${priceLine("read", readOptions(null))} · 버튼을 눌렀을 때만 내 지원금에서 나가요.`
            : "데모에서는 아래 샘플 영수증을 쓰면 미리 만든 추출 결과가 나와요. 다른 사진은 직접 입력하는 빈 양식이 열려요."}</small>
        </label>
      </section>
      <section class="card">
        <h3>샘플 영수증 12장 <span class="demo">${live.on ? "실제 AI가 읽어요" : "데모 데이터"}</span></h3>
        <ul class="samples">${L.SAMPLES.map(
          (s) => `<li><button type="button" class="sample" data-sample="${s.id}"><img src="${L.receiptDataUrl(s.id)}" alt="${esc(s.shop)} 샘플 영수증"><span>${esc(s.shop)}</span></button>
            <a class="dl" href="${L.receiptDataUrl(s.id)}" download="sample-${s.id}.svg">내려받기</a></li>`,
        ).join("")}</ul>
        ${FRAMED_NOTE}
      </section>`;
  }

  function startReading(image, sampleId) {
    draft = { stage: "reading", image };
    render();
    if (live.on && sdk) {
      readWithAi(image, sampleId);
      return;
    }
    setTimeout(() => {
      const result = sampleId ? L.extractionFor(sampleId) : null;
      draft = {
        stage: "review",
        image,
        fromSample: Boolean(result),
        sampleId: result ? result.sampleId : null,
        shop: result ? result.shop : "",
        date: result ? result.date : L.dateFor(0, new Date().getDate()),
        items: result ? result.items.map((i) => ({ ...i })) : [{ name: "", amount: 0 }],
        total: result ? result.total : 0,
        category: result ? result.category : "기타",
      };
      render();
    }, 900);
  }

  // 실제 AI: 사진을 Claude에게 보내 같은 모양의 JSON을 받아요. 실패하면 데모 경로로.
  async function readWithAi(image, sampleId) {
    const started = draft;
    try {
      const png = await toPng(image);
      const result = await sdk.ai.ask(readOptions(png));
      if (draft !== started) return; // 그사이 취소했어요
      const out = result.json || {};
      const items = (Array.isArray(out.items) ? out.items : []).map((i) => ({ name: String(i.name || ""), amount: Math.max(0, Math.round(Number(i.amount) || 0)) }));
      const total = Number(out.total) || items.reduce((s, i) => s + i.amount, 0);
      draft = {
        stage: "review",
        image,
        fromSample: false,
        fromAi: true,
        krw: result.chargedKrw,
        sampleId: null,
        shop: String(out.shop || ""),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(out.date)) ? String(out.date) : L.dateFor(0, new Date().getDate()),
        items: items.length ? items : [{ name: "", amount: 0 }],
        total,
        category: L.CATEGORIES.includes(out.category) ? out.category : "기타",
      };
      render();
    } catch (error) {
      if (draft !== started) return;
      if (error && error.code === "demo") {
        // 데모로 바뀌었어요(0원): 데모 데이터로 보여 줘요.
        live.on = false;
        modeBadge();
        toast("데모로 보여 줘요 — AI는 부르지 않았어요 (0원).");
      } else {
        // 실제 AI는 그대로 둬요(로그인 취소, 지원금 부족, 너무 잦음 모두 여기로). 양식을 직접 채우게 열어요.
        toast(`AI가 읽지 못했어요: ${error && error.message ? error.message : "다시 시도해 주세요"}`);
      }
      const result = sampleId ? L.extractionFor(sampleId) : null;
      draft = {
        stage: "review",
        image,
        fromSample: Boolean(result),
        aiFailed: true,
        sampleId: result ? result.sampleId : null,
        shop: result ? result.shop : "",
        date: result ? result.date : L.dateFor(0, new Date().getDate()),
        items: result ? result.items.map((i) => ({ ...i })) : [{ name: "", amount: 0 }],
        total: result ? result.total : 0,
        category: result ? result.category : "기타",
      };
      render();
    }
  }

  function reviewHtml() {
    const d = draft;
    const note = d.fromAi
      ? `<p class="notice"><span class="demo live">실제 AI · ${d.krw}원 · 내 동아리 지원금에서</span> Claude가 읽은 결과예요. 틀린 곳이 있으면 고쳐서 저장하세요.</p>`
      : d.fromSample
      ? `<p class="notice"><span class="demo">데모</span> 미리 만든 추출 결과예요. 틀린 곳이 있으면 고쳐서 저장하세요.</p>`
      : d.aiFailed
      ? `<p class="notice">AI가 읽지 못해 빈 양식을 열었어요. 직접 입력하거나 다시 시도해 주세요.</p>`
      : `<p class="notice">${sdk ? "실제 AI를 켜면 사진에서 자동으로 읽어요." : "데모에서는 샘플 영수증만 읽어요."} 지금은 직접 입력해 주세요.</p>`;
    return `<section class="card review">
      <div class="reviewGrid">
        <img class="receiptImg" src="${d.image}" alt="올린 영수증">
        <form id="review-form">
          ${note}
          <label>상호 <input id="r-shop" required value="${esc(d.shop)}"></label>
          <label>날짜 <input id="r-date" type="date" required value="${d.date}"></label>
          <fieldset><legend>품목별 금액</legend>
            <ul class="itemRows">${d.items
              .map(
                (i, idx) => `<li><input aria-label="품목 ${idx + 1} 이름" data-item-name="${idx}" value="${esc(i.name)}" placeholder="품목">
                <input aria-label="품목 ${idx + 1} 금액" data-item-amount="${idx}" type="number" min="0" step="100" value="${i.amount}">
                <button type="button" class="ghost" data-remove-item="${idx}" aria-label="품목 ${idx + 1} 빼기">✕</button></li>`,
              )
              .join("")}</ul>
            <button type="button" class="ghost" id="add-item">+ 품목 추가</button>
          </fieldset>
          <label>합계 <input id="r-total" type="number" min="0" step="10" value="${d.total}"></label>
          <label>카테고리 ${d.fromSample ? `<span class="demo">데모 · 자동 분류</span>` : ""} <select id="r-cat">${L.CATEGORIES.map(
            (c) => `<option ${c === d.category ? "selected" : ""}>${c}</option>`,
          ).join("")}</select></label>
          <div class="actions"><button type="submit" class="primary">저장</button><button type="button" class="ghost" id="cancel-add">취소</button></div>
        </form>
      </div></section>`;
  }

  function readDraftFromForm() {
    draft.shop = $("#r-shop").value;
    draft.date = $("#r-date").value;
    draft.category = $("#r-cat").value;
    draft.total = Number($("#r-total").value) || 0;
    draft.items = [...document.querySelectorAll("[data-item-name]")].map((input) => ({
      name: input.value,
      amount: Number($(`[data-item-amount="${input.dataset.itemName}"]`).value) || 0,
    }));
  }

  // ---------------------------------------------------------------- 예산
  function budgetHtml() {
    const sums = byCategory(inMonth(currentMonth()));
    return `<section class="card">
      <h3>카테고리별 한 달 예산</h3>
      <p class="muted">80%를 넘으면 <span class="badge caution">주의</span>, 100%를 넘으면 <span class="badge warn">경고</span>가 붙어요.</p>
      <form id="budget-form" class="budgetForm">${L.CATEGORIES.map(
        (c) => `<label><span>${c}</span><input type="number" min="0" step="1000" data-budget="${c}" value="${state.budget[c] || 0}"><small>이번 달 ${won(sums[c] || 0)}</small></label>`,
      ).join("")}
      <div class="actions"><button type="submit" class="primary">예산 저장</button></div></form>
    </section>
    <section class="card"><h3>이번 달 예산 사용</h3>${budgetBars(sums)}</section>`;
  }

  // ---------------------------------------------------------------- 이벤트
  function bind() {
    const on = (sel, ev, fn) => {
      const el = $(sel);
      if (el) el.addEventListener(ev, fn);
    };
    on("#dash-month", "change", (e) => {
      dashMonth = e.target.value;
      render();
    });
    on("#pattern-ai", "click", async (e) => {
      const month = e.target.dataset.month;
      live.busy = true;
      render();
      try {
        const sums = byCategory(inMonth(month));
        const result = await sdk.ai.ask(patternOptions(month, sums, byCategory(inMonth(prevMonth(month)))));
        const out = result.json || {};
        state.patterns = state.patterns || {};
        state.patterns[month] = {
          headline: String(out.headline || ""),
          points: (Array.isArray(out.points) ? out.points : []).map(String).slice(0, 4),
          tip: String(out.tip || ""),
          krw: result.chargedKrw,
        };
        save();
      } catch (error) {
        if (error && error.code === "demo") {
          live.on = false;
          modeBadge();
          toast("데모로 보여 줘요 — AI는 부르지 않았어요 (0원).");
        } else {
          toast(`분석을 받지 못했어요: ${error && error.message ? error.message : "다시 시도해 주세요"}`);
        }
      }
      live.busy = false;
      render();
    });
    // 내역
    on("#q", "input", (e) => {
      filters.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const q = $("#q");
      q.focus();
      q.setSelectionRange(pos, pos);
    });
    on("#f-month", "change", (e) => {
      filters.month = e.target.value;
      render();
    });
    on("#f-cat", "change", (e) => {
      filters.category = e.target.value;
      render();
    });
    on("#csv", "click", exportCsv);
    for (const button of document.querySelectorAll("[data-open]")) {
      button.addEventListener("click", () => {
        const t = state.transactions.find((x) => x.id === button.dataset.open);
        $("#detail").innerHTML = detailHtml(t);
        const close = () => {
          $("#detail").innerHTML = "";
          button.focus();
        };
        $("#close-detail").focus();
        on("#close-detail", "click", close);
        on("[data-close-detail]", "click", close);
        $("#detail").addEventListener("keydown", (e) => e.key === "Escape" && close(), { once: true });
        on("#detail-cat", "change", (e) => {
          t.category = e.target.value;
          save();
          render();
        });
        on("#delete-tx", "click", (e) =>
          armed(e.target, "정말 지울까요? 한 번 더 누르세요", () => {
            state.transactions = state.transactions.filter((x) => x.id !== t.id);
            save();
            render();
          }),
        );
      });
    }
    // 영수증 추가
    const drop = $("#drop");
    if (drop) {
      const file = $("#file");
      drop.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          file.click();
        }
      });
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        drop.classList.add("over");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("over");
        if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
      });
      file.addEventListener("change", () => file.files[0] && readFile(file.files[0]));
    }
    for (const button of document.querySelectorAll("[data-sample]")) {
      button.addEventListener("click", () => startReading(L.receiptDataUrl(button.dataset.sample), button.dataset.sample));
    }
    const form = $("#review-form");
    if (form) {
      form.addEventListener("input", (e) => {
        if (e.target.matches("[data-item-amount]")) {
          readDraftFromForm();
          draft.total = draft.items.reduce((s, i) => s + i.amount, 0);
          $("#r-total").value = draft.total;
        }
      });
      on("#add-item", "click", () => {
        readDraftFromForm();
        draft.items.push({ name: "", amount: 0 });
        render();
      });
      for (const b of document.querySelectorAll("[data-remove-item]")) {
        b.addEventListener("click", () => {
          readDraftFromForm();
          draft.items.splice(Number(b.dataset.removeItem), 1);
          if (!draft.items.length) draft.items.push({ name: "", amount: 0 });
          draft.total = draft.items.reduce((s, i) => s + i.amount, 0);
          render();
        });
      }
      on("#cancel-add", "click", () => {
        draft = null;
        render();
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        readDraftFromForm();
        state.transactions.unshift({
          id: `user-${Date.now()}`,
          shop: draft.shop.trim() || "상호 없음",
          date: draft.date,
          items: draft.items.filter((i) => i.name || i.amount),
          total: draft.total,
          category: draft.category,
          source: draft.fromSample ? "sample" : "user",
          sampleId: draft.sampleId,
        });
        save();
        draft = null;
        filters = { q: "", month: "all", category: "all" };
        toast("저장했어요");
        go("list");
      });
    }
    // 예산
    const budgetForm = $("#budget-form");
    if (budgetForm) {
      budgetForm.addEventListener("submit", (e) => {
        e.preventDefault();
        for (const input of document.querySelectorAll("[data-budget]")) state.budget[input.dataset.budget] = Number(input.value) || 0;
        save();
        toast("예산을 저장했어요");
        render();
      });
    }
  }

  function readFile(file) {
    if (!file.type.startsWith("image/")) {
      toast("이미지 파일만 올릴 수 있어요");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      // 내려받은 샘플 SVG를 다시 올리면 어떤 샘플인지 알아봅니다.
      let sampleId = null;
      if (file.type === "image/svg+xml") {
        const text = new TextDecoder().decode(Uint8Array.from(atob(url.split(",")[1] || ""), (c) => c.charCodeAt(0)));
        const match = text.match(/data-sample-id="(r\d\d)"/);
        sampleId = match ? match[1] : null;
      }
      startReading(url, sampleId);
    };
    reader.readAsDataURL(file);
  }

  function toast(text) {
    const box = $("#toast");
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => box.classList.remove("show"), 2200);
  }

  // ---------------------------------------------------------------- 시작
  for (const tab of document.querySelectorAll("[data-view]")) {
    tab.addEventListener("click", () => go(tab.dataset.view));
  }
  $("#reset").addEventListener("click", (e) =>
    armed(e.target, "다시 누르면 처음으로", () => {
      state = freshState();
      save();
      draft = null;
      dashMonth = currentMonth();
      toast("데모 데이터로 되돌렸어요");
      go("dashboard");
    }),
  );
  const modeToggle = $("#mode-toggle");
  if (modeToggle) modeToggle.addEventListener("click", () => setMode(!live.on));
  // CTRL+AI의 데모 스위치가 바뀌면 따라가요 (app-ai-access).
  window.addEventListener("ctrlai:ai-mode", (event) => {
    if (event.detail && event.detail.mode === "demo" && live.on) {
      live.on = false;
      modeBadge();
      render();
    }
  });
  Promise.all([
    store.get(KEY),
    window.ctrlai && window.ctrlai.connected
      ? window.ctrlai.app().then((info) => framedNote(Boolean(info && info.framed)), () => framedNote(true))
      : null,
    sdk ? sdk.user().catch(() => null) : null,
    sdk ? store.get(MODE_KEY).catch(() => null) : null,
    sdk && sdk.ai.mode ? sdk.ai.mode().catch(() => "live") : "live",
  ])
    .then(([saved, , user, mode, aiMode]) => {
      if (saved && Array.isArray(saved.transactions) && saved.budget) state = saved;
      // 로그인한 회원은 실제 AI가 기본 — 데모로 돌려 두었다면 그대로 데모예요.
      // CTRL+AI가 데모라고 하면(만든 사람의 설정이나 방문자의 스위치) 데모예요.
      live.user = user || null;
      live.on = Boolean(sdk && user && mode !== "demo" && aiMode === "live");
      modeBadge();
    })
    .catch(() => {
      /* 저장소를 못 쓰면 데모 데이터로 시작합니다 */
    })
    .then(render);
})();
