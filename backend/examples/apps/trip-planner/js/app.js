// 여행 일정 메이커 — 화면. 일정은 이 기기에만 저장돼요(CTRL+AI 안에서는 ctrlai.storage, 밖에서는 localStorage).

(function () {
  const T = window.TRIP;
  const KEY = "trip-planner-v1";
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
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = T.esc;
  const won = T.won;
  const main = $("#main");

  // ---------------------------------------------------------------- 실제 AI (CTRL+AI 기능 상자, app-platform P4b)
  // 실제 AI를 켜고 끄는 스위치는 하나 — 앱 위쪽 CTRL+AI 줄의 스위치예요 (ai-switch-toggle).
  // 앱은 그 스위치(`ctrlai.ai.mode()`, "ctrlai:ai-mode")만 따라가요. 켜져 있으면 Claude가
  // 일정을 짜고 문장을 알아들어요 — 방문자 자신의 지원금에서, 버튼을 눌렀을 때만 (로그인은 그때). 장소는 여전히 이 앱의 목록 안에서만 골라요(밖의 id는 데모 플래너가 채워요).
  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const live = { on: false, prices: {}, busy: false };
  const PLAN_SCHEMA = {
    type: "object",
    required: ["days", "notes"],
    additionalProperties: false,
    properties: {
      days: { type: "array", minItems: 1, maxItems: 7, items: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } } },
      notes: { type: "array", maxItems: 3, items: { type: "string" } },
    },
  };
  const EDIT_SCHEMA = {
    type: "object",
    required: ["intent", "reply"],
    additionalProperties: false,
    properties: { intent: { type: "string", enum: ["rain", "cheap", "relax", "none"] }, reply: { type: "string" } },
  };
  function placesText(city) {
    return T.CITIES[city].places.map((p) => `${p.id} ${p.name} (${p.pref}${p.indoor ? "·실내" : ""}, ${p.minutes}분, 1인 ${p.cost}원)`).join("\n");
  }
  function planOptions(input) {
    return {
      system: "여행 일정을 짜는 도우미예요. 주어진 장소 목록의 id만 써서 날짜별 동선(하루 3~5곳, 맛집은 하루 1~2곳, 가까운 곳끼리)을 JSON으로 만들어요. 같은 장소는 한 번만. notes에는 한국어 한 줄 조언을 최대 3개.",
      prompt: `도시 ${input.city}, ${input.days}일, ${input.people}명, 총예산 ${input.budget}원, 취향 ${input.prefs.join("·")}.\n장소 목록:\n${placesText(input.city)}`,
      json: PLAN_SCHEMA,
      maxTokens: 700,
    };
  }
  function editOptions(trip, text) {
    return {
      system: "여행 일정에 대한 부탁을 분류해요. rain(비 오는 날·실내 위주), cheap(더 저렴하게), relax(더 여유롭게) 중 하나이면 그 intent를, 아니면 none과 함께 한국어로 짧게 답(reply)해요. reply는 한 문장.",
      prompt: `지금 일정: ${trip.input.city} ${trip.input.days}일, ${trip.days.map((d) => d.length + "곳").join("/")}.\n부탁: ${String(text).slice(0, 200)}`,
      json: EDIT_SCHEMA,
      maxTokens: 120,
    };
  }
  // "1회 약 N원 · 최대 M원" — 같은 옵션으로 부르면 최대 금액을 넘지 않아요 (재시도 포함).
  function priceLine(key, options, onDone) {
    const p = live.prices[key];
    if (p === undefined) {
      live.prices[key] = null;
      sdk.ai.estimate(options).then(
        (figures) => {
          live.prices[key] = figures;
          onDone();
        },
        () => {
          live.prices[key] = false;
          onDone();
        },
      );
      return "비용 확인 중…";
    }
    if (!p) return "1회 최대 200원";
    return `1회 약 ${p.typicalKrw}원 · 최대 ${p.maxKrw}원`;
  }
  // 같은 글이면 같은 열쇠 — 길이가 아니라 내용으로 (도시가 바뀌면 장소 목록도 바뀌어요).
  function hashOf(text) {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
    return h.toString(36);
  }
  const priceKey = (prefix, options) => `${prefix}:${hashOf(options.system + "\n" + options.prompt)}`;
  function updatePrice(el, prefix, options) {
    if (!el) return;
    el.textContent = priceLine(priceKey(prefix, options), options, () => updatePrice($(`#${el.id}`), prefix, options));
  }
  function debounce(fn, ms) {
    let timer = null;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }
  // CTRL+AI 안에서는 위쪽 줄이 데모/실제 AI를 보여 줘요 — 앱이 같은 말을 또 하지 않아요.
  // CTRL+AI 밖(파일만 연 경우)에서만 "데모 데이터" 배지를 보여요.
  function modeBadge() {
    const badge = $(".badge.demoAll");
    if (badge) badge.style.display = sdk ? "none" : ""; // the CSS sets display, so not `hidden`
  }
  // Claude의 일정: 목록 안의 id만, 하루에 한 번씩, 6곳까지. 맞지 않는 날은 데모 플래너의 날을 그대로 둬요.
  async function planWithAi(input) {
    const result = await sdk.ai.ask(planOptions(input));
    const trip = T.plan(input);
    const valid = new Set(T.CITIES[input.city].places.map((p) => p.id));
    const used = new Set();
    const replacedDays = new Set();
    const days = Array.isArray(result.json && result.json.days) ? result.json.days : [];
    for (let d = 0; d < input.days; d += 1) {
      const ids = Array.isArray(days[d]) ? days[d].filter((id) => valid.has(id) && !used.has(id)).slice(0, 6) : [];
      if (ids.length >= 2) {
        ids.forEach((id) => used.add(id));
        trip.days[d] = ids;
        replacedDays.add(d);
      }
    }
    // 데모가 채운 날에 AI가 쓴 장소가 겹치면 그 날에서 빼고, 비면 다시 짜요.
    trip.days.forEach((ids, d) => {
      if (replacedDays.has(d)) return;
      const kept = ids.filter((id) => !used.has(id));
      if (kept.length) trip.days[d] = kept;
      else T.regenerateDay(trip, d);
    });
    const notes = Array.isArray(result.json && result.json.notes) ? result.json.notes.map(String).slice(0, 3) : [];
    trip.notes = [...notes, ...trip.notes].slice(0, 5);
    trip.ai = { krw: result.chargedKrw, days: replacedDays.size, total: input.days };
    return trip;
  }
  // ---------------------------------------------------------------- 저장
  function fresh() {
    return { trip: T.plan(T.SAMPLE_INPUT), day: 0, view: "result", form: { ...T.SAMPLE_INPUT, prefs: [...T.SAMPLE_INPUT.prefs] } };
  }
  function save() {
    store.set(KEY, { trip: state.trip, day: state.day, view: state.view, form: state.form }).catch(() => {
      /* 저장소가 막혀 있어도 화면은 계속 써요 */
    });
  }
  // 저장된 일정을 불러오기 전까지는 예시 일정(맨 아래에서 바꿔요).
  let state = fresh();
  let undo = null; // 바로 전 일정 (되돌리기용)
  let message = null; // { text, kind }
  let shareUrl = "";

  // 주소 # 뒤에 공유된 일정이 있으면 보기 전용으로 보여 줘요.
  function sharedTrip() {
    const match = location.hash.match(/^#share=([A-Za-z0-9_-]+)$/);
    return match ? T.decode(match[1]) : null;
  }
  let shared = sharedTrip();

  const say = (text) => {
    $("#status").textContent = "";
    setTimeout(() => ($("#status").textContent = text), 30);
  };

  function change(fn, note) {
    undo = JSON.stringify(state.trip);
    const result = fn();
    save();
    if (note !== undefined) message = note;
    render();
    say(typeof result === "string" ? result : (note && note.text) || "일정을 바꿨어요. 이동 시간과 예산을 다시 계산했어요.");
    return result;
  }

  // ---------------------------------------------------------------- 공통 조각
  const ICON = { 도보: "🚶", "지하철·버스": "🚇", 렌터카: "🚗" };
  const minutesText = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`);

  function miniOutline(city) {
    const pts = city.outline;
    const lats = pts.map((p) => p[0]);
    const lngs = pts.map((p) => p[1]);
    const k = Math.cos((lats[0] * Math.PI) / 180);
    const w = (Math.max(...lngs) - Math.min(...lngs)) * k;
    const h = Math.max(...lats) - Math.min(...lats);
    const s = 80 / Math.max(w, h);
    const d = pts
      .map(([lat, lng], i) => `${i ? "L" : "M"}${((lng - Math.min(...lngs)) * k * s + (80 - w * s) / 2).toFixed(1)},${((Math.max(...lats) - lat) * s + (80 - h * s) / 2).toFixed(1)}`)
      .join("");
    return `<svg viewBox="0 0 80 80" aria-hidden="true" class="mini"><path d="${d}Z"/></svg>`;
  }

  // ---------------------------------------------------------------- 입력 화면
  function formHtml() {
    const f = state.form;
    return `<form id="plan-form" class="card formCard" novalidate>
      <p class="eyebrow">STEP 1 · 조건 고르기</p>
      <h2>어디로 떠날까요?</h2>
      <fieldset class="cities"><legend>목적지</legend>
        ${Object.values(T.CITIES)
          .map(
            (c) => `<label class="cityCard"><input type="radio" name="city" value="${c.name}" ${f.city === c.name ? "checked" : ""}>
              ${miniOutline(c)}<b>${c.name}</b><small>장소 ${c.places.length}곳</small></label>`,
          )
          .join("")}
      </fieldset>
      <div class="formRow">
        <label>기간
          <select name="days">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${f.days === n ? "selected" : ""}>${n === 1 ? "당일치기" : `${n - 1}박 ${n}일`}</option>`).join("")}</select>
        </label>
        <div class="field"><span id="people-label">인원</span>
          <div class="stepper" role="group" aria-labelledby="people-label">
            <button type="button" data-step="-1" aria-label="한 명 줄이기">−</button>
            <output id="people" aria-live="polite">${f.people}명</output>
            <button type="button" data-step="1" aria-label="한 명 늘리기">+</button>
          </div>
        </div>
        <label>총예산 (원)
          <input name="budget" type="number" inputmode="numeric" min="50000" max="10000000" step="10000" value="${f.budget}">
          <small id="budget-text">${won(f.budget)}</small>
        </label>
      </div>
      <fieldset class="prefs"><legend>취향 <small>(여러 개 골라도 돼요)</small></legend>
        ${T.PREFS.map(
          (p) => `<label class="chip"><input type="checkbox" name="prefs" value="${p}" ${f.prefs.includes(p) ? "checked" : ""}><span>${T.PREF_ICONS[p]} ${p}</span></label>`,
        ).join("")}
      </fieldset>
      <p id="form-error" class="error" role="alert"></p>
      <div class="actions">
        <button class="primary" type="submit" id="plan-submit">일정 만들기</button>
        <span class="price" id="plan-price" aria-live="polite"></span>
        ${state.trip ? `<button class="ghost" type="button" id="back-result">지금 일정으로 돌아가기</button>` : ""}
      </div>
      <p class="muted small">${live.on && sdk ? `<span class="demo live">실제 AI</span> Claude가 아래 도시의 장소 목록에서만 골라 일정을 짜요 — 1회 비용은 버튼 옆에.` : `<span class="demo">데모 플래너${sdk ? " · 위쪽 CTRL+AI 줄의 스위치를 켜면 Claude가 생성" : ""}</span> 정해진 규칙이 아래 도시의 장소 목록에서만 골라 일정을 짜요.`}</p>
    </form>`;
  }

  function readForm() {
    const form = $("#plan-form");
    const data = new FormData(form);
    return {
      city: data.get("city") || "서울",
      days: Number(data.get("days")) || 1,
      budget: Math.max(0, Math.round(Number(data.get("budget")) || 0)),
      people: state.form.people,
      prefs: data.getAll("prefs"),
    };
  }

  function bindForm() {
    const form = $("#plan-form");
    form.addEventListener("input", () => {
      state.form = readForm();
      $("#budget-text").textContent = won(state.form.budget);
      save();
    });
    $$("[data-step]", form).forEach((b) =>
      b.addEventListener("click", () => {
        state.form.people = Math.max(1, Math.min(8, state.form.people + Number(b.dataset.step)));
        $("#people").textContent = `${state.form.people}명`;
        save();
      }),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = readForm();
      const error = $("#form-error");
      if (!input.prefs.length) return (error.textContent = "취향을 하나 이상 골라 주세요.");
      if (input.budget < 50000) return (error.textContent = "총예산은 5만 원 이상으로 적어 주세요.");
      if (live.busy) return; // 이미 짜는 중이에요
      undo = state.trip ? JSON.stringify(state.trip) : null;
      state.form = input;
      const finish = (trip, note) => {
        state.trip = trip;
        state.day = 0;
        state.view = "result";
        message = note || null;
        live.busy = false;
        save();
        render();
        main.focus();
        say(`${input.city} ${input.days}일 일정을 만들었어요.`);
      };
      if (live.on && sdk) {
        live.busy = true;
        error.textContent = "";
        $("#plan-submit").disabled = true;
        $("#plan-submit").textContent = "Claude가 일정을 짜는 중…";
        planWithAi(input).then(
          (trip) => finish(trip, trip.ai.days < trip.ai.total ? { text: `AI가 ${trip.ai.days}일을 짰고, 나머지 ${trip.ai.total - trip.ai.days}일은 데모 플래너가 채웠어요.`, kind: "wait" } : null),
          (err) => {
            live.busy = false;
            finish(T.plan(input), { text: `AI가 일정을 짜지 못해 데모 플래너로 만들었어요: ${err && err.message ? err.message : ""}`, kind: "wait" });
          },
        );
        return;
      }
      finish(T.plan(input));
    });
    // 실제 AI: 짜기 버튼 옆에 가격을 먼저 보여 줘요 (입력이 바뀌면 다시).
    if (live.on && sdk) {
      const refreshPrice = () => updatePrice($("#plan-price"), "plan", planOptions(readForm()));
      refreshPrice();
      form.addEventListener("input", debounce(refreshPrice, 400));
    }
    const back = $("#back-result");
    if (back) back.addEventListener("click", () => ((state.view = "result"), save(), render()));
  }

  // ---------------------------------------------------------------- 결과 화면
  function resultHtml(trip, readOnly) {
    const { input } = trip;
    const day = Math.min(state.day, trip.days.length - 1);
    const items = T.schedule(trip, day);
    const budget = T.budget(trip);
    const ratio = input.budget ? budget.total / input.budget : 0;
    const travel = items.reduce((s, it) => s + (it.leg ? it.leg.minutes : 0), 0);
    const dayCost = items.reduce((s, it) => s + it.place.cost * input.people + (it.leg ? it.leg.cost : 0), 0);
    return `
      ${readOnly ? `<div class="sharedBanner" role="note"><b>공유받은 일정이에요 · 보기 전용</b>
        <span>고치려면 내 일정으로 가져오세요.</span><span class="bannerActions"><button type="button" class="ghost" id="leave-shared">내 일정 보기</button>
        <button type="button" class="primary" id="adopt">내 일정으로 가져오기</button></span></div>` : ""}
      <section class="pass" aria-label="여행 요약">
        <div class="passCity">${miniOutline(T.city(trip))}<div><p class="eyebrow">DESTINATION</p><b>${esc(input.city)}</b></div></div>
        <dl class="passFacts">
          <div><dt>기간</dt><dd>${input.days === 1 ? "당일치기" : `${input.days - 1}박 ${input.days}일`}</dd></div>
          <div><dt>인원</dt><dd>${input.people}명</dd></div>
          <div><dt>숙소</dt><dd>${input.days > 1 ? trip.lodging : "없음"}</dd></div>
          <div><dt>취향</dt><dd>${input.prefs.map((p) => T.PREF_ICONS[p] + p).join(" ")}</dd></div>
        </dl>
        <div class="passBudget">
          <p>예상 <b>${won(budget.total)}</b> / 예산 ${won(input.budget)}</p>
          <div class="progress ${ratio > 1 ? "over" : ""}" role="progressbar" aria-label="예산 사용" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio * 100)}">
            <span style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></span></div>
          <small>${ratio > 1 ? `예산보다 ${won(budget.total - input.budget)} 많아요` : `${won(input.budget - budget.total)} 남아요`}</small>
        </div>
      </section>
      <p class="plannerLine">${trip.ai ? `<span class="demo live">실제 AI · ${trip.ai.krw}원 · ${trip.ai.days}/${trip.ai.total}일</span>` : `<span class="demo">데모 플래너${live.on || !sdk ? "" : " · 위쪽 CTRL+AI 줄의 스위치를 켜면 Claude가 생성"}</span>`}
        ${[trip.rain ? "☔ 비 오는 날 버전" : "", trip.cheap ? "💸 알뜰 버전" : "", trip.relaxed ? "🐢 여유 버전" : ""].filter(Boolean).map((t) => `<span class="mode">${t}</span>`).join("")}
        ${trip.notes.map((n) => `<span class="note">${esc(n)}</span>`).join("")}</p>
      <div class="dayTabs" role="tablist" aria-label="날짜">
        ${trip.days.map((_, d) => `<button type="button" role="tab" data-day="${d}" aria-selected="${d === day}">${d + 1}일차</button>`).join("")}
      </div>
      <div class="layout">
        <section class="card timeline" aria-labelledby="day-title">
          <header class="dayHead">
            <h2 id="day-title">${day + 1}일차</h2>
            <p class="muted">${items.length ? `${T.clock(items[0].start)} 출발 · ${items.length}곳 · 이동 ${minutesText(travel)} · ${won(dayCost)}` : "아직 장소가 없어요"}</p>
          </header>
          <ol class="stops" id="stops">${items.map((it, i) => stopHtml(it, i, items.length, readOnly)).join("")}</ol>
          ${readOnly ? "" : dayToolsHtml(trip, day)}
        </section>
        <aside class="sideCol">
          <section class="card mapCard" aria-label="${day + 1}일차 지도">
            ${T.routeMap(trip, day)}
            <p class="muted small">번호 = 방문 순서 · 흐린 점 = 다른 날 장소 · 지도 타일 없이 그린 단순 지도</p>
          </section>
          <section class="card budgetCard" aria-labelledby="budget-title">
            <h3 id="budget-title">예산</h3>
            <div class="budgetWrap">${T.donut(budget.parts, budget.total)}
              <ul class="legend">${Object.entries(budget.parts)
                .map(([n, v]) => `<li><span class="swatch" style="background:${T.BUDGET_COLORS[n]}"></span>${n}<b>${won(v)}</b></li>`)
                .join("")}</ul></div>
            ${readOnly || input.days < 2 ? "" : `<label class="tier">숙소 등급 <select id="tier">${T.LODGING_TIERS.map(
              (t) => `<option ${t === trip.lodging ? "selected" : ""}>${t}</option>`,
            ).join("")}</select></label>`}
            <p class="muted small">식비는 맛집 일정 + 나머지 끼니 1인 ${won(T.MEAL_ALLOWANCE)}로 어림했어요.</p>
          </section>
          ${readOnly ? "" : shareHtml()}
        </aside>
      </div>`;
  }

  function stopHtml(it, i, count, readOnly) {
    const p = it.place;
    const leg = it.leg
      ? `<div class="leg"><span aria-hidden="true">${ICON[it.leg.mode] || "🚌"}</span> ${it.leg.mode} ${minutesText(it.leg.minutes)} · ${it.leg.km.toFixed(1)}km${it.leg.cost ? ` · ${won(it.leg.cost)}` : ""}</div>`
      : "";
    const controls = readOnly
      ? ""
      : `<div class="ctl">
          <button type="button" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="${esc(p.name)} 위로">↑</button>
          <button type="button" data-down="${i}" ${i === count - 1 ? "disabled" : ""} aria-label="${esc(p.name)} 아래로">↓</button>
          <button type="button" data-remove="${i}" aria-label="${esc(p.name)} 빼기">✕</button>
        </div>`;
    return `<li class="stop" data-index="${i}" ${readOnly ? "" : 'draggable="true"'}>
      ${leg}
      <div class="stopCard">
        <span class="num" aria-hidden="true">${i + 1}</span>
        <div class="time"><b>${T.clock(it.start)}</b><small>~${T.clock(it.end)}</small></div>
        <div class="body">
          <p class="name"><b>${esc(p.name)}</b> <span class="pref">${T.PREF_ICONS[p.pref]} ${p.pref}</span>${p.indoor ? `<span class="tag">실내</span>` : ""}</p>
          <p class="note">${esc(p.note)}</p>
          <small>${minutesText(p.minutes)} 머묾 · ${p.cost ? `1인 ${won(p.cost)}` : "무료"}</small>
        </div>
        ${controls}
      </div>
    </li>`;
  }

  function dayToolsHtml(trip, day) {
    const options = T.unused(trip, day);
    return `<div class="dayTools">
        <div class="addRow">
          <label class="visually-hidden" for="add-place">추가할 장소</label>
          <select id="add-place">${options
            .map(({ p, km }) => `<option value="${p.id}">${T.PREF_ICONS[p.pref]} ${esc(p.name)}${trip.days[day].length ? ` · ${km.toFixed(1)}km` : ""}</option>`)
            .join("")}</select>
          <button type="button" class="ghost" id="add" ${options.length ? "" : "disabled"}>장소 추가</button>
          <button type="button" class="ghost" id="regen">하루 다시 만들기</button>
        </div>
        <p class="muted small">카드를 끌어서 순서를 바꾸거나 ↑ ↓ 버튼을 쓰세요. 이동 시간과 예산이 바로 다시 계산돼요.</p>
      </div>
      <form id="nl" class="nl">
        <label for="nl-text"><b>문장으로 고치기</b> ${live.on && sdk ? `<span class="demo live">실제 AI · <span id="edit-price">비용 확인 중…</span></span>` : `<span class="demo">데모 규칙${sdk ? " · 위쪽 CTRL+AI 줄의 스위치를 켜면 Claude가 이해" : ""}</span>`}</label>
        <div class="nlRow"><input id="nl-text" type="text" placeholder="예: 비 오는 날 버전으로" autocomplete="off" maxlength="200">
          <button class="primary" type="submit" id="nl-submit">바꾸기</button></div>
        <div class="suggest">${["비 오는 날 버전으로", "더 저렴하게", "더 여유롭게"]
          .map((t) => `<button type="button" class="chipBtn" data-say="${t}">${t}</button>`)
          .join("")}</div>
        ${message ? `<p class="msg ${message.kind}" role="status">${esc(message.text)}${undo ? ` <button type="button" class="link" id="undo">되돌리기</button>` : ""}</p>` : ""}
      </form>`;
  }

  function shareHtml() {
    return `<section class="card shareCard" aria-labelledby="share-title">
      <h3 id="share-title">공유</h3>
      <p class="muted small">일정이 링크 안에 그대로 들어가요. 서버에 저장하지 않고, 받은 사람은 보기만 할 수 있어요.</p>
      <button type="button" class="ghost" id="make-link">공유 링크 만들기</button>
      ${shareUrl ? `<div class="shareRow"><input id="share-url" readonly value="${esc(shareUrl)}" aria-label="공유 링크">
        <button type="button" class="primary" id="copy">복사</button></div>
        <button type="button" class="link" id="preview-share">받는 사람 화면 미리 보기</button>` : ""}
    </section>`;
  }

  // ---------------------------------------------------------------- 그리기와 연결
  function render() {
    shared = sharedTrip();
    $("#new-trip").hidden = !!shared || state.view === "form";
    $("#reset").hidden = !!shared;
    if (shared) {
      main.innerHTML = resultHtml(shared, true);
      bindResult(shared, true);
    } else if (state.view === "form" || !state.trip) {
      main.innerHTML = formHtml();
      bindForm();
    } else {
      main.innerHTML = resultHtml(state.trip, false);
      bindResult(state.trip, false);
    }
  }

  function bindResult(trip, readOnly) {
    $$("[data-day]").forEach((b) =>
      b.addEventListener("click", () => {
        state.day = Number(b.dataset.day);
        if (!readOnly) save();
        render();
        $(`[data-day="${state.day}"]`).focus();
      }),
    );
    // 탭 사이를 화살표 키로
    const tabs = $(".dayTabs");
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const next = (state.day + (event.key === "ArrowRight" ? 1 : -1) + trip.days.length) % trip.days.length;
      $(`[data-day="${next}"]`).click();
    });
    if (readOnly) {
      $("#leave-shared").addEventListener("click", () => {
        clearHash();
        render();
        main.focus();
      });
      $("#adopt").addEventListener("click", () => {
        state.trip = JSON.parse(JSON.stringify(shared));
        state.form = { ...shared.input, prefs: [...shared.input.prefs] };
        state.view = "result";
        state.day = 0;
        save();
        clearHash();
        render();
        say("공유받은 일정을 내 일정으로 가져왔어요.");
      });
      return;
    }
    const d = state.day;
    $$("[data-up]").forEach((b) => b.addEventListener("click", () => moveStop(d, Number(b.dataset.up), Number(b.dataset.up) - 1)));
    $$("[data-down]").forEach((b) => b.addEventListener("click", () => moveStop(d, Number(b.dataset.down), Number(b.dataset.down) + 1)));
    $$("[data-remove]").forEach((b) =>
      b.addEventListener("click", () => change(() => T.remove(trip, d, Number(b.dataset.remove)), null)),
    );
    bindDrag(d);
    $("#add").addEventListener("click", () => {
      const id = $("#add-place").value;
      if (id) change(() => T.add(trip, d, id), null);
    });
    $("#regen").addEventListener("click", () =>
      change(() => T.regenerateDay(trip, d), { text: `${d + 1}일차를 다른 장소들로 다시 짰어요.`, kind: "ok" }),
    );
    $("#nl").addEventListener("submit", (event) => {
      event.preventDefault();
      edit($("#nl-text").value);
    });
    if (live.on && sdk) {
      // 가격은 가장 긴 부탁(200자) 기준 — 실제 부탁은 그보다 짧으니 최대 금액을 넘지 않아요.
      updatePrice($("#edit-price"), "edit", editOptions(trip, "가".repeat(200)));
    }
    $$("[data-say]").forEach((b) => b.addEventListener("click", () => edit(b.dataset.say)));
    const undoButton = $("#undo");
    if (undoButton)
      undoButton.addEventListener("click", () => {
        state.trip = JSON.parse(undo);
        undo = null;
        message = { text: "바로 전 일정으로 되돌렸어요.", kind: "ok" };
        save();
        render();
        say("되돌렸어요.");
      });
    const tier = $("#tier");
    if (tier) tier.addEventListener("change", () => change(() => (trip.lodging = tier.value), null));
    $("#make-link").addEventListener("click", () => {
      shareUrl = `${location.href.split("#")[0]}#share=${T.encode(trip)}`;
      render();
      $("#share-url").select();
    });
    const copy = $("#copy");
    if (copy) copy.addEventListener("click", copyLink);
    const preview = $("#preview-share");
    if (preview) preview.addEventListener("click", () => (location.hash = shareUrl.split("#")[1]));
  }

  function moveStop(d, from, to) {
    change(() => T.move(state.trip, d, from, to), null);
    const target = $(`[data-index="${to}"] [data-${to < from ? "up" : "down"}]`) || $(`[data-index="${to}"] button`);
    if (target && !target.disabled) target.focus();
  }

  function bindDrag(d) {
    let from = null;
    $$(".stop").forEach((li) => {
      li.addEventListener("dragstart", (event) => {
        from = Number(li.dataset.index);
        li.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        try {
          event.dataTransfer.setData("text/plain", String(from));
        } catch (error) {
          /* 일부 브라우저 */
        }
      });
      li.addEventListener("dragend", () => {
        li.classList.remove("dragging");
        $$(".stop").forEach((x) => x.classList.remove("over"));
      });
      li.addEventListener("dragover", (event) => {
        event.preventDefault();
        li.classList.add("over");
      });
      li.addEventListener("dragleave", () => li.classList.remove("over"));
      li.addEventListener("drop", (event) => {
        event.preventDefault();
        const to = Number(li.dataset.index);
        if (from !== null && from !== to) change(() => T.move(state.trip, d, from, to), null);
        from = null;
      });
    });
  }

  function edit(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    if (live.on && sdk) {
      editWithAi(trimmed);
      return;
    }
    const intent = T.intent(trimmed);
    if (!intent) {
      message = {
        text: `"${trimmed}" 같은 부탁은 ${sdk ? "위쪽 CTRL+AI 줄의 스위치를 켜면" : "데모에서는 못"} 알아들어요. 지금은 '비 오는 날 버전으로', '더 저렴하게', '더 여유롭게'만 알아들어요.`,
        kind: "wait",
      };
      render();
      say(message.text);
      $("#nl-text").focus();
      return;
    }
    const apply = { rain: T.applyRain, cheap: T.applyCheap, relax: T.applyRelax }[intent];
    let text2 = "";
    change(() => (text2 = apply(state.trip)), null);
    message = { text: text2, kind: "ok" };
    render();
    $("#nl-text").focus();
  }

  // 실제 AI: 부탁을 알아듣고 세 규칙 중 하나를 적용하거나, 아니면 한 줄로 답해요.
  async function editWithAi(text) {
    const button = $("#nl-submit");
    if (button) {
      button.disabled = true;
      button.textContent = "듣는 중…";
    }
    try {
      const result = await sdk.ai.ask(editOptions(state.trip, text));
      const out = result.json || {};
      const apply = { rain: T.applyRain, cheap: T.applyCheap, relax: T.applyRelax }[out.intent];
      if (!apply) {
        message = { text: `${String(out.reply || "그 부탁은 아직 못 알아들었어요.")} (실제 AI · ${result.chargedKrw}원)`, kind: "wait" };
      } else {
        let text2 = "";
        change(() => (text2 = apply(state.trip)), null);
        message = { text: `${text2} (실제 AI · ${result.chargedKrw}원)`, kind: "ok" };
      }
    } catch (error) {
      if (error && error.code === "demo") {
        // 데모로 바뀌었어요(0원): 데모 규칙으로 돌아가요.
        live.on = false;
        message = { text: "데모로 보여 줘요 — AI는 부르지 않았어요 (0원). 데모 규칙으로 다시 눌러 보세요.", kind: "wait" };
      } else {
        message = { text: `AI가 답하지 못했어요: ${error && error.message ? error.message : "다시 시도해 주세요"}`, kind: "wait" };
      }
    }
    render();
    say(message.text);
    $("#nl-text").focus();
  }

  // 미리보기 창(sandbox)에서는 클립보드 API가 막혀 있어 옛 방식(execCommand)도 시도해요.
  async function writeClipboard(input) {
    try {
      await navigator.clipboard.writeText(input.value);
      return true;
    } catch (error) {
      input.focus();
      input.select();
      try {
        return document.execCommand("copy");
      } catch (error2) {
        return false;
      }
    }
  }

  async function copyLink() {
    const input = $("#share-url");
    try {
      if (!(await writeClipboard(input))) throw new Error("blocked");
      $("#copy").textContent = "복사됨";
      say("링크를 복사했어요.");
      setTimeout(() => {
        const button = $("#copy");
        if (button) button.textContent = "복사";
      }, 2000);
    } catch (error) {
      input.focus();
      input.select();
      say("이 창에서는 자동 복사가 막혀 있어요. 선택된 링크를 직접 복사하세요 (Ctrl+C).");
      $("#copy").textContent = "직접 복사하세요";
    }
  }

  function clearHash() {
    try {
      history.replaceState(null, "", location.href.split("#")[0]);
    } catch (error) {
      location.hash = "";
    }
  }

  // ---- 상단 버튼
  $("#new-trip").addEventListener("click", () => {
    state.view = "form";
    save();
    render();
    main.focus();
  });

  let armed = null;
  $("#reset").addEventListener("click", (event) => {
    const button = event.currentTarget;
    if (armed) {
      clearTimeout(armed);
      armed = null;
      state = fresh();
      undo = null;
      message = null;
      shareUrl = "";
      save();
      button.textContent = "데모 초기화";
      button.classList.remove("danger");
      render();
      say("처음 예시 일정으로 되돌렸어요.");
      return;
    }
    button.textContent = "정말 지울까요? 한 번 더";
    button.classList.add("danger");
    armed = setTimeout(() => {
      armed = null;
      button.textContent = "데모 초기화";
      button.classList.remove("danger");
    }, 4000);
  });

  window.addEventListener("hashchange", render);
  // 폰 ↔ 넓은 화면을 넘나들면 지도를 알맞은 크기로 다시 그려요.
  let small = window.innerWidth < 560;
  window.addEventListener("resize", () => {
    if ((window.innerWidth < 560) !== small) {
      small = !small;
      render();
    }
  });
  // CTRL+AI 줄의 스위치가 바뀌면 그대로 따라가요 — 켜도, 꺼도.
  window.addEventListener("ctrlai:ai-mode", (event) => {
    const on = Boolean(sdk && event.detail && event.detail.mode === "live");
    if (on !== live.on) {
      live.on = on;
      render();
    }
  });
  Promise.all([
    store.get(KEY),
    sdk && sdk.ai.mode ? sdk.ai.mode().catch(() => "demo") : "demo",
  ])
    .then(([saved, aiMode]) => {
      if (saved && saved.trip && saved.trip.input && T.CITIES[saved.trip.input.city]) state = saved;
      // CTRL+AI 줄의 스위치가 정해요 (만든 사람의 '데모만'이면 늘 데모).
      live.on = Boolean(sdk && aiMode === "live");
      modeBadge();
    })
    .catch(() => {
      /* 저장소를 못 쓰면 예시 일정으로 시작해요 */
    })
    .then(render);
})();
