// 출장·여행 준비 도우미 — 화면.
//
// 한 문장(또는 직접 고르기) → 항공권 비교 링크 + 현지 날씨 + 환율 + 준비물.
// · 항공권: 가격을 앱이 가져오지 않아요(실시간 항공권 가격은 유료 데이터예요).
//   날짜·인원을 채운 네이버 항공권 · 구글 항공편 주소를 만들어, 누르면 바로 실시간 가격이 떠요.
// · 날씨: Open-Meteo (무료, 키 없음) — 출발 2주 전부터 예보가 있어요.
// · 환율: Frankfurter (유럽중앙은행 기준환율, 무료, 키 없음).
// · 실제 AI: 「✦ AI로 정리」를 누르면 Claude가 문장을 읽어 칸을 채워요 (방문자의 지원금, 누를 때만).
//   AI 없이도 칸을 직접 고르면 다 돼요 (0원).

(function () {
  const P = window.PREP;
  const KEY = "trip-prep-v1";
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
  const esc = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;

  // ---------------------------------------------------------------- 날짜
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (text, n) => {
    const d = new Date(`${text}T00:00:00`);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  const today = () => iso(new Date());
  const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
  const DAY = ["일", "월", "화", "수", "목", "금", "토"];
  const shortDate = (text) => {
    const d = new Date(`${text}T00:00:00`);
    return `${d.getMonth() + 1}.${d.getDate()}(${DAY[d.getDay()]})`;
  };

  // ---------------------------------------------------------------- 상태
  function fresh() {
    const depart = addDays(today(), 21);
    return {
      form: { text: P.SAMPLE_TEXT, origin: "SEL", dest: "도쿄", depart, ret: addDays(depart, 2), people: 2, purpose: "출장" },
      checks: {},
    };
  }
  let state = fresh();
  let note = null; // { text, kind }
  const save = () =>
    store.set(KEY, state).catch(() => {
      /* 저장소가 막혀 있어도 화면은 계속 써요 */
    });
  const dest = () => P.DESTINATIONS.find((d) => d.name === state.form.dest) || P.DESTINATIONS[0];
  const origin = () => P.ORIGINS.find((o) => o.code === state.form.origin) || P.ORIGINS[0];

  // ---------------------------------------------------------------- 실제 AI (CTRL+AI 기능 상자)
  // 스위치는 하나 — 앱 위쪽 CTRL+AI 줄의 스위치예요. 앱은 그것(`ctrlai.ai.mode()`,
  // "ctrlai:ai-mode")만 따라가요. 켜져 있으면 「✦ AI로 정리」 버튼이 생기고, 누를 때만 Claude를 불러요.
  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const live = { on: false, price: null, busy: false };
  const READ_SCHEMA = {
    type: "object",
    required: ["dest", "origin", "depart", "ret", "people", "purpose"],
    additionalProperties: false,
    properties: {
      dest: { type: "string", enum: P.DESTINATIONS.map((d) => d.name).concat("목록에 없음") },
      origin: { type: "string", enum: P.ORIGINS.map((o) => o.code) },
      depart: { type: "string", description: "YYYY-MM-DD" },
      ret: { type: "string", description: "YYYY-MM-DD, 편도면 빈 문자열" },
      people: { type: "integer" },
      purpose: { type: "string", enum: ["출장", "여행"] },
    },
  };
  function readOptions(text) {
    return {
      system:
        "출장·여행 계획 문장을 읽어 칸을 채워요. 오늘 날짜를 기준으로 '다음 주 금요일' 같은 말을 실제 날짜(YYYY-MM-DD)로 바꿔요. " +
        "목적지는 주어진 목록에서 고르고, 없으면 '목록에 없음'. 출발지를 말하지 않으면 SEL. 인원을 말하지 않으면 1. " +
        "'2박 3일'이면 돌아오는 날은 가는 날 + 2일.",
      prompt: `오늘: ${today()} (${DAY[new Date().getDay()]}요일)\n문장: ${String(text).slice(0, 200)}`,
      json: READ_SCHEMA,
      maxTokens: 200,
    };
  }
  function priceText() {
    if (!live.price) {
      if (live.price === null) {
        live.price = false;
        sdk.ai.estimate(readOptions(state.form.text)).then(
          (figures) => {
            live.price = figures;
            const el = $("#read-price");
            if (el) el.textContent = priceText();
          },
          () => {},
        );
      }
      return "비용 확인 중…";
    }
    return `1회 약 ${live.price.typicalKrw}원`;
  }
  async function readWithAi() {
    const text = $("#trip-text").value.trim();
    if (!text) return setNote("어디로, 언제 가는지 한 문장으로 적어 주세요.", "warn");
    live.busy = true;
    render();
    try {
      const result = await sdk.ai.ask(readOptions(text));
      const j = result.json || {};
      if (j.dest === "목록에 없음") {
        setNote(`아직 목록에 없는 곳이에요. 가까운 도시를 직접 골라 주세요. (실제 AI · ${result.chargedKrw}원)`, "warn");
      } else {
        const f = state.form;
        f.text = text;
        if (P.DESTINATIONS.some((d) => d.name === j.dest)) f.dest = j.dest;
        if (P.ORIGINS.some((o) => o.code === j.origin)) f.origin = j.origin;
        if (/^\d{4}-\d{2}-\d{2}$/.test(j.depart) && j.depart >= today()) f.depart = j.depart;
        f.ret = /^\d{4}-\d{2}-\d{2}$/.test(j.ret) && j.ret >= f.depart ? j.ret : "";
        f.people = Math.max(1, Math.min(9, Number(j.people) || 1));
        f.purpose = j.purpose === "여행" ? "여행" : "출장";
        setNote(`Claude가 문장을 읽고 칸을 채웠어요 — 맞는지 확인해 주세요. (실제 AI · ${result.chargedKrw}원)`, "ok");
      }
    } catch (error) {
      // 만든 사람이 '데모만'으로 두었거나 스위치가 꺼진 직후면 서버가 "demo"로 거절해요 (0원).
      if (error && error.code === "demo") setNote("지금은 데모예요 — AI 없이 칸을 직접 골라 주세요.", "warn");
      else setNote(`AI가 읽지 못했어요. 칸을 직접 골라 주세요. ${error && error.message ? error.message : ""}`, "warn");
    }
    live.busy = false;
    save();
    render();
  }

  // ---------------------------------------------------------------- 바깥 서비스 (결과는 기억해 둬요)
  const cache = {};
  function remember(key, load) {
    if (!cache[key]) cache[key] = load().catch((error) => {
      delete cache[key]; // 다음에 다시 시도
      throw error;
    });
    return cache[key];
  }
  async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }
  // 날씨: 오늘부터 2주까지 예보가 있어요. 출발이 그보다 뒤면 null.
  function weather(d, from, to) {
    if (daysBetween(today(), from) > 14) return Promise.resolve(null);
    const end = to && daysBetween(today(), to) <= 14 ? to : addDays(today(), 14);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${d.lat}&longitude=${d.lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto` +
      `&start_date=${from}&end_date=${end < from ? from : end}`;
    return remember(url, () => getJson(url)).then((data) =>
      data.daily.time.map((day, i) => ({
        day,
        max: Math.round(data.daily.temperature_2m_max[i]),
        min: Math.round(data.daily.temperature_2m_min[i]),
        rain: data.daily.precipitation_probability_max[i],
        code: data.daily.weather_code[i],
      })),
    );
  }
  const SKY = (code) =>
    code === 0 ? "☀️ 맑음" : code <= 3 ? "⛅ 구름" : code <= 48 ? "🌫️ 안개" : code <= 67 ? "🌧️ 비" : code <= 77 ? "🌨️ 눈" : code <= 82 ? "🌦️ 소나기" : "⛈️ 뇌우";
  // 환율: 현지 돈 1단위가 몇 원인지.
  function rate(currency) {
    const url = `https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=KRW`;
    return remember(url, () => getJson(url)).then((data) => ({ krw: data.rates.KRW, date: data.date }));
  }

  // ---------------------------------------------------------------- 항공권 링크
  const compact = (text) => text.replace(/-/g, "");
  function flightLinks() {
    const f = state.form;
    const d = dest();
    const o = origin();
    const domestic = d.currency === "KRW";
    const from = domestic ? o.domestic : o.code;
    const back = f.ret ? `/${d.code}-${from}-${compact(f.ret)}` : "";
    const naver =
      `https://flight.naver.com/flights/${domestic ? "domestic" : "international"}/` +
      `${from}-${d.code}-${compact(f.depart)}${back}?adult=${f.people}&fareType=Y`;
    const words = `Flights from ${o.en} to ${d.en} on ${f.depart}${f.ret ? ` through ${f.ret}` : " one way"} for ${f.people} adult${f.people > 1 ? "s" : ""}`;
    const google = `https://www.google.com/travel/flights?hl=ko&q=${encodeURIComponent(words)}`;
    return [
      { label: "네이버 항공권", url: naver },
      { label: "구글 항공편", url: google },
    ];
  }

  // ---------------------------------------------------------------- 그리기
  const main = $("#main");
  function setNote(text, kind) {
    note = { text, kind };
    const el = $("#note");
    if (el) {
      el.textContent = text;
      el.className = `note ${kind}`;
    }
  }

  function formHtml() {
    const f = state.form;
    const groups = P.DESTINATIONS.reduce((out, d) => {
      const g = d.currency === "KRW" ? "국내" : "해외";
      (out[g] = out[g] || []).push(d);
      return out;
    }, {});
    return `<section class="card formCard" aria-labelledby="form-title">
      <h2 id="form-title">어디로, 언제 가요?</h2>
      <label class="sentence">한 문장으로
        <textarea id="trip-text" rows="2" maxlength="200" placeholder="예: 다음 주 금요일부터 2박 3일 도쿄 출장, 2명">${esc(f.text || "")}</textarea>
      </label>
      <div class="sentenceActions">
        ${
          live.on && sdk
            ? `<button type="button" class="primary aiBtn" id="read-ai" ${live.busy ? "disabled" : ""}>${live.busy ? "Claude가 읽는 중…" : "✦ AI로 정리"}</button>
               <span class="price" id="read-price">${priceText()}</span>`
            : `<span class="demo">${sdk ? "위쪽 CTRL+AI 줄의 스위치를 켜면 Claude가 문장을 읽어 칸을 채워요 (실제 AI)." : "데모 — 아래 칸을 직접 골라 보세요."}</span>`
        }
      </div>
      <div class="fields">
        <label>출발<select id="origin">${P.ORIGINS.map((o) => `<option value="${o.code}" ${o.code === f.origin ? "selected" : ""}>${o.name}</option>`).join("")}</select></label>
        <label>도착<select id="dest">${Object.entries(groups)
          .map(([g, list]) => `<optgroup label="${g}">${list.map((d) => `<option ${d.name === f.dest ? "selected" : ""}>${d.name}</option>`).join("")}</optgroup>`)
          .join("")}</select></label>
        <label>가는 날<input type="date" id="depart" value="${f.depart}" min="${today()}"></label>
        <label>오는 날<input type="date" id="ret" value="${f.ret}" min="${f.depart}"><small>비우면 편도</small></label>
        <label>인원<select id="people">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option value="${n}" ${n === f.people ? "selected" : ""}>${n}명</option>`).join("")}</select></label>
        <label>목적<select id="purpose">${["출장", "여행"].map((p) => `<option ${p === f.purpose ? "selected" : ""}>${p}</option>`).join("")}</select></label>
      </div>
      <p id="note" class="note ${note ? note.kind : ""}" role="status">${note ? esc(note.text) : ""}</p>
    </section>`;
  }

  function resultHtml() {
    const f = state.form;
    const d = dest();
    const nights = f.ret ? daysBetween(f.depart, f.ret) : 0;
    const cur = P.CURRENCIES[d.currency] || { label: d.currency, unit: 1 };
    const list = P.CHECKLIST[f.purpose];
    return `<section class="card ticket" aria-label="여정 요약">
        <div><span class="code">${esc(origin().code)}</span><small>${esc(origin().name)}</small></div>
        <span class="plane" aria-hidden="true">✈</span>
        <div><span class="code">${esc(d.code)}</span><small>${esc(d.name)}</small></div>
        <p>${shortDate(f.depart)}${f.ret ? ` → ${shortDate(f.ret)} · ${nights}박 ${nights + 1}일` : " · 편도"} · ${f.people}명 · ${esc(f.purpose)}</p>
      </section>
      <section class="card" aria-labelledby="fly-title">
        <h3 id="fly-title">항공권 비교</h3>
        <p class="muted">날짜·인원을 채운 검색 화면이 새 창으로 열려요. 실시간 가격은 각 사이트에서 확인해요.</p>
        <div class="links">${flightLinks()
          .map((l) => `<a class="linkBtn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${l.label} ↗</a>`)
          .join("")}</div>
      </section>
      <section class="card" aria-labelledby="sky-title">
        <h3 id="sky-title">${esc(d.name)} 날씨</h3>
        <div id="weather" class="weather"><p class="muted">불러오는 중…</p></div>
      </section>
      <section class="card" aria-labelledby="fx-title">
        <h3 id="fx-title">환율</h3>
        ${
          d.currency === "KRW"
            ? `<p class="muted">국내라 환전이 필요 없어요.</p>`
            : `<div id="fx"><p class="muted">불러오는 중…</p></div>
               <label class="convert">${esc(cur.label)}<input type="number" id="amount" min="0" step="any" value="${cur.unit * 10}"></label>
               <p id="converted" class="big"></p>`
        }
      </section>
      <section class="card" aria-labelledby="check-title">
        <h3 id="check-title">${esc(f.purpose)} 준비물</h3>
        <ul class="checks">${list
          .map((item) => `<li><label><input type="checkbox" data-check="${esc(item)}" ${state.checks[item] ? "checked" : ""}> ${esc(item)}</label></li>`)
          .join("")}</ul>
        <p class="muted small">${list.filter((item) => state.checks[item]).length} / ${list.length} 챙김 · 체크는 이 기기에만 저장돼요</p>
      </section>`;
  }

  function render() {
    main.innerHTML = `<div class="layout"><div>${formHtml()}</div><div class="results">${resultHtml()}</div></div>`;
    bind();
    fillWeather();
    fillRate();
  }

  function fillWeather() {
    const f = state.form;
    const box = $("#weather");
    weather(dest(), f.depart, f.ret).then(
      (days) => {
        if (!days) {
          box.innerHTML = `<p class="muted">예보는 출발 2주 전부터 볼 수 있어요 (${daysBetween(today(), f.depart)}일 남음).</p>`;
          return;
        }
        box.innerHTML = days
          .slice(0, 7)
          .map((w) => `<div class="day"><b>${shortDate(w.day)}</b><span>${SKY(w.code)}</span><span>${w.min}° / ${w.max}°</span><small>비 ${w.rain ?? "-"}%</small></div>`)
          .join("");
      },
      () => (box.innerHTML = `<p class="muted">날씨를 지금 불러오지 못했어요.</p>`),
    );
  }

  function fillRate() {
    const d = dest();
    const box = $("#fx");
    if (!box) return;
    const cur = P.CURRENCIES[d.currency];
    if (cur && cur.rate === false) {
      box.innerHTML = `<p class="muted">${esc(cur.label)}(${d.currency})는 무료 환율 정보에 없어요.</p>`;
      $(".convert").hidden = true;
      return;
    }
    rate(d.currency).then(
      (r) => {
        box.innerHTML = `<p class="big">${cur.unit.toLocaleString("ko-KR")}${esc(cur.label)} = ${won(r.krw * cur.unit)}</p><p class="muted small">유럽중앙은행 기준환율 · ${r.date}</p>`;
        const convert = () => ($("#converted").textContent = `≈ ${won((Number($("#amount").value) || 0) * r.krw)}`);
        $("#amount").addEventListener("input", convert);
        convert();
      },
      () => (box.innerHTML = `<p class="muted">환율을 지금 불러오지 못했어요.</p>`),
    );
  }

  function bind() {
    const f = state.form;
    const change = () => {
      save();
      render();
    };
    $("#trip-text").addEventListener("input", (e) => {
      f.text = e.target.value;
      live.price = live.price || null;
      save();
    });
    const ai = $("#read-ai");
    if (ai) ai.addEventListener("click", readWithAi);
    $("#origin").addEventListener("change", (e) => ((f.origin = e.target.value), change()));
    $("#dest").addEventListener("change", (e) => ((f.dest = e.target.value), change()));
    $("#depart").addEventListener("change", (e) => {
      f.depart = e.target.value || today();
      if (f.ret && f.ret < f.depart) f.ret = f.depart;
      change();
    });
    $("#ret").addEventListener("change", (e) => ((f.ret = e.target.value), change()));
    $("#people").addEventListener("change", (e) => ((f.people = Number(e.target.value)), change()));
    $("#purpose").addEventListener("change", (e) => ((f.purpose = e.target.value), change()));
    main.querySelectorAll("[data-check]").forEach((box) =>
      box.addEventListener("change", () => {
        state.checks[box.dataset.check] = box.checked;
        change();
      }),
    );
  }

  // ---------------------------------------------------------------- 시작
  // 데모 초기화: 두 번 눌러야 지워요 (확인창은 앱 안에서 막혀 있어요).
  const reset = $("#reset");
  let armed = null;
  reset.addEventListener("click", () => {
    if (!armed) {
      reset.textContent = "정말 지울까요? 한 번 더";
      armed = setTimeout(() => ((armed = null), (reset.textContent = "데모 초기화")), 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    reset.textContent = "데모 초기화";
    state = fresh();
    note = null;
    save();
    render();
  });
  // CTRL+AI 밖(파일만 연 경우)에서만 "데모 데이터" 배지를 보여요.
  const badge = $(".badge.demoAll");
  if (badge && sdk) badge.style.display = "none";
  window.addEventListener("ctrlai:ai-mode", (event) => {
    const on = Boolean(sdk && event.detail && event.detail.mode === "live");
    if (on !== live.on) {
      live.on = on;
      render();
    }
  });
  // 예시로 바로 그리고, 저장된 입력과 AI 스위치 상태가 오면 다시 그려요 (첫 화면이 늦게 뜨지 않게).
  render();
  Promise.all([store.get(KEY), sdk && sdk.ai.mode ? sdk.ai.mode().catch(() => "demo") : "demo"])
    .then(([saved, aiMode]) => {
      if (saved && saved.form && P.DESTINATIONS.some((d) => d.name === saved.form.dest)) {
        state = saved;
        if (state.form.depart < today()) Object.assign(state.form, fresh().form, { text: state.form.text });
      }
      live.on = Boolean(sdk && aiMode === "live");
    })
    .catch(() => {
      /* 저장소를 못 쓰면 예시로 시작해요 */
    })
    .then(render);
})();
