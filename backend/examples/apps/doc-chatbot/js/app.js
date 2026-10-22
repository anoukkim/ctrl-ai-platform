// 문서 챗봇 메이커 — 만들기 화면. 문서·설정·대화 기록은 이 기기에만 저장돼요(CTRL+AI 안에서는 ctrlai.storage, 밖에서는 localStorage).

(function () {
  const B = window.BOT;
  const KEY = "doc-chatbot-v1";
  // CTRL+AI 안에서는 ctrlai.storage(이 앱 · 이 방문자만의 저장 공간)에,
  // 밖에서(내려받아 연 파일) 열면 이 브라우저의 localStorage에 저장해요.
  const store =
    window.ctrlai && window.ctrlai.connected
      ? window.ctrlai.storage
      : {
          get: (key) => Promise.resolve().then(() => JSON.parse(localStorage.getItem(key) || "null")),
          set: (key, value) => Promise.resolve().then(() => localStorage.setItem(key, JSON.stringify(value))),
        };
  const MAX_FILE = 200 * 1024; // 문서 하나
  const MAX_TOTAL = 800 * 1024; // 문서 전체
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = B.esc;
  const main = $("#main");

  // ---------------------------------------------------------------- 실제 AI (CTRL+AI 기능 상자, app-platform P4b)
  // 실제 AI를 켜고 끄는 스위치는 하나 — 앱 위쪽 CTRL+AI 줄의 스위치예요 (ai-switch-toggle).
  // 앱은 그 스위치(`ctrlai.ai.mode()`, "ctrlai:ai-mode")만 따라가요. 켜져 있으면 Claude가 찾은
  // 단락을 읽고 답을 정리해요 — 방문자 자신의 지원금에서, 질문을 보냈을 때만(근거 단락이 없으면
  // 부르지 않아요; 로그인은 그때). 꺼져 있거나 밖에서 열면 데모예요.
  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const live = { on: false, price: undefined };
  function priceText() {
    if (!live.on || !sdk) return "";
    if (live.price === undefined) {
      live.price = null;
      sdk.ai.estimate(B.priceOptions(state.settings, index)).then(
        (figures) => {
          live.price = figures;
          const el = $("#chat-price");
          if (el) el.textContent = priceText();
        },
        () => {
          live.price = false;
          const el = $("#chat-price");
          if (el) el.textContent = priceText();
        },
      );
      return "비용 확인 중…";
    }
    if (!live.price) return "질문 1회 최대 200원";
    return `질문 1회 약 ${live.price.typicalKrw}원 · 최대 ${live.price.maxKrw}원 · 보냈을 때만`;
  }
  // CTRL+AI 안에서는 위쪽 줄이 데모/실제 AI를 보여 줘요 — 앱이 같은 말을 또 하지 않아요.
  // CTRL+AI 밖(파일만 연 경우)에서만 "데모 데이터" 배지를 보여요.
  function modeBadge() {
    const badge = $(".badge.demoAll");
    if (badge) badge.style.display = sdk ? "none" : ""; // the CSS sets display, so not `hidden`
  }

  // ---------------------------------------------------------------- 저장
  function seedLogs(docs) {
    const index = B.buildIndex(docs.flatMap(B.chunk));
    return B.SAMPLE_LOGS.map(([daysAgo, time, q, topic, rating], i) => {
      const at = new Date();
      at.setDate(at.getDate() - daysAgo);
      const [h, m] = time.split(":").map(Number);
      at.setHours(h, m, 0, 0);
      // 오늘 기록이 아직 오지 않은 시각이면 조금 전으로 당겨요.
      if (at > Date.now()) at.setTime(Date.now() - (B.SAMPLE_LOGS.length - i) * 60000);
      const result = B.answer(q, index);
      return {
        id: `seed-${i + 1}`,
        at: at.toISOString(),
        q,
        found: result.found,
        source: result.found ? { doc: result.best.chunk.doc, label: result.best.chunk.label } : null,
        excerpt: result.found ? result.best.chunk.text.slice(0, 160) : "",
        rating,
        topic,
        sample: true,
      };
    });
  }
  function fresh() {
    const docs = B.SAMPLE_DOCS.map((d) => ({ ...d, sample: true }));
    return { docs, settings: { ...B.DEFAULT_SETTINGS }, logs: seedLogs(docs) };
  }
  /** 저장했으면 true, 저장소가 막혀 있으면 false (화면은 그래도 계속 써요). */
  function save() {
    return store.set(KEY, state).then(
      () => true,
      () => false,
    );
  }
  // 저장된 것을 불러오기 전까지는 샘플(맨 아래 '시작'에서 바꿔요).
  let state = fresh();
  let index = null;
  let chunks = [];
  function reindex() {
    chunks = state.docs.flatMap(B.chunk);
    index = B.buildIndex(chunks);
    if (typeof live !== "undefined") live.price = undefined; // 단락이 바뀌면 가격도 다시 (가장 긴 단락 기준)
  }
  reindex();

  let view = "chat";
  let chat = null;
  let lastHits = null;
  let docNotice = null;
  let openDoc = null;
  let logFilter = "all";
  let openLog = null;
  let snippetCopied = false;

  const summary = () => `문서 ${state.docs.length}개 · 단락 ${chunks.length}개`;
  const say = (text) => {
    $("#status").textContent = "";
    setTimeout(() => ($("#status").textContent = text), 30);
  };
  const when = (iso) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // 두 번 눌러야 하는 버튼 (확인 창 대신)
  function armed(button, text, done) {
    if (button.dataset.armed) {
      clearTimeout(Number(button.dataset.armed));
      delete button.dataset.armed;
      done();
      return;
    }
    const original = button.textContent;
    button.textContent = text;
    button.classList.add("danger");
    button.dataset.armed = String(
      setTimeout(() => {
        delete button.dataset.armed;
        button.textContent = original;
        button.classList.remove("danger");
      }, 4000),
    );
  }

  // ---------------------------------------------------------------- 챗봇
  function chatView() {
    main.innerHTML = `
      <div class="pageHead"><h2>챗봇 미리보기</h2><p class="muted">회원이 보게 될 대화창이에요. 지금 올려 둔 문서로만 답해요.</p></div>
      <div class="chatLayout">
        <section id="maker-chat" class="chatFrame" aria-label="챗봇 미리보기"></section>
        <aside class="explain">
          <section class="panel">
            <h3>어떻게 답하나요?</h3>
            <ol class="steps">
              <li>문서를 제목·빈 줄 기준으로 <b>단락</b>으로 나눠요.</li>
              <li>질문과 낱말이 가장 많이 겹치는 단락을 <b>BM25</b>로 찾아요.</li>
              <li>그 단락을 <b>그대로 인용</b>하고 출처(문서 · 단락)를 붙여요.</li>
              <li>점수가 ${B.THRESHOLD}보다 낮으면 "못 찾을 때 문구"로 답해요.</li>
            </ol>
            <p class="muted small">${live.on
              ? `답은 먼저 문서 문장 그대로예요 (0원). 답 아래 「AI로 정리해서 답하기」를 누르면 Claude가 찾은 단락을 읽고 정리해 줘요 · <span id="chat-price">${priceText()}</span>`
              : "위쪽 CTRL+AI 줄의 스위치를 켜면 답 아래에 Claude가 정리해 주는 버튼이 생겨요."}</p>
          </section>
          <section class="panel" aria-live="polite">
            <h3>마지막 질문의 점수</h3>
            <div id="hits">${hitsHtml()}</div>
          </section>
        </aside>
      </div>`;
    chat = B.mountChat($("#maker-chat"), {
      settings: () => state.settings,
      index: () => index,
      live: () => live.on && Boolean(sdk),
      sdk: () => sdk,
      price: () => (live.price ? `약 ${live.price.typicalKrw}원` : ""),
      summary,
      onLog: addLog,
      onRate: rate,
      onHits: (q, hits) => {
        lastHits = { q, hits };
        $("#hits").innerHTML = hitsHtml();
      },
      suggestions: ["연차는 며칠이에요?", "야근 수당은 얼마나 더 받아요?", "퇴사하면 마지막 월급은 언제 받아요?", "회사 와이파이 비밀번호 알려 주세요"],
    });
  }

  function hitsHtml() {
    if (!lastHits) return `<p class="muted small">질문을 하면 가장 잘 맞은 단락 3개와 점수가 여기에 나와요.</p>`;
    if (!lastHits.hits.length) return `<p class="muted small">"${esc(lastHits.q)}" — 겹치는 낱말이 없어요.</p>`;
    const max = Math.max(lastHits.hits[0].score, B.THRESHOLD * 1.5);
    return `<p class="muted small">"${esc(lastHits.q)}"</p><ul class="hitList">${lastHits.hits
      .map(
        (h) => `<li><span>${esc(h.chunk.doc)} · ${esc(h.chunk.label)}</span>
          <span class="meter"><span style="width:${((h.score / max) * 100).toFixed(0)}%" class="${h.score >= B.THRESHOLD ? "pass" : ""}"></span>
          <i style="left:${((B.THRESHOLD / max) * 100).toFixed(0)}%" title="기준 점수"></i></span><b>${h.score.toFixed(2)}</b></li>`,
      )
      .join("")}</ul>`;
  }

  function addLog(log) {
    state.logs.push(log);
    if (state.logs.length > 500) state.logs.shift();
    save();
  }
  function rate(id, rating) {
    const log = state.logs.find((l) => l.id === id);
    if (log) {
      log.rating = rating;
      save();
    }
  }

  // ---------------------------------------------------------------- 문서
  function docsView() {
    main.innerHTML = `
      <div class="pageHead"><h2>문서</h2><p class="muted">챗봇은 여기 있는 문서로만 답해요. .txt나 .md 파일을 올리면 단락으로 자동으로 나눠요.</p></div>
      <label class="drop" id="drop" tabindex="0">
        <input type="file" id="file" accept=".txt,.md,.pdf,text/plain,text/markdown" multiple class="visually-hidden">
        <span class="dropIcon" aria-hidden="true">⇪</span>
        <b>파일을 끌어다 놓거나 눌러서 고르세요</b>
        <small>.txt · .md (한 파일 200KB까지) · PDF는 아직 지원하지 않아요</small>
      </label>
      <form class="panel wiki" id="wiki-form">
        <div><b>🌐 위키백과에서 가져오기</b>
          <small class="muted">주제를 적으면 한국어 위키백과 문서를 가져와 챗봇 문서로 넣어요 (CC BY-SA — 출처가 함께 들어가요).</small></div>
        <div class="wikiRow">
          <input id="wiki-title" maxlength="60" placeholder="예: 최저임금, 4대 보험, 연말정산" aria-label="위키백과 문서 제목">
          <button class="primary" type="submit" id="wiki-go">가져오기</button>
        </div>
      </form>
      <details class="panel paste">
        <summary>직접 붙여 넣기</summary>
        <form id="paste-form">
          <label>문서 이름 <input id="paste-name" required maxlength="40" placeholder="예: 동아리 FAQ"></label>
          <label>내용 <textarea id="paste-text" rows="6" required placeholder="## 제목&#10;내용…"></textarea></label>
          <button class="primary" type="submit">문서 추가</button>
        </form>
      </details>
      ${docNotice ? `<p class="notice ${docNotice.kind}" role="status">${esc(docNotice.text)}</p>` : ""}
      <ul class="docList">${state.docs
        .map((d) => {
          const own = chunks.filter((c) => c.docId === d.id);
          return `<li class="panel docItem">
            <div class="docHead">
              <span class="docIcon" aria-hidden="true">${d.name.slice(0, 1)}</span>
              <div><b>${esc(d.name)}</b> ${d.sample ? `<span class="demo">샘플 문서</span>` : ""}
                <small class="muted">${d.text.length.toLocaleString("ko-KR")}자 · 단락 ${own.length}개</small></div>
              <div class="docActions">
                <button type="button" class="ghost" data-open="${d.id}" aria-expanded="${openDoc === d.id}">단락 보기</button>
                <button type="button" class="ghost" data-delete="${d.id}">지우기</button>
              </div>
            </div>
            ${openDoc === d.id ? `<ol class="chunkList">${own
              .map((c) => `<li><b>${esc(c.label)}</b><p>${esc(c.text)}</p></li>`)
              .join("")}</ol>` : ""}
          </li>`;
        })
        .join("")}</ul>
      ${state.docs.length ? "" : `<p class="muted">문서가 없어요. 챗봇이 모든 질문에 "찾을 수 없어요"로 답해요.</p>`}`;
    const drop = $("#drop");
    const file = $("#file");
    file.addEventListener("change", () => readFiles(file.files));
    drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        file.click();
      }
    });
    ["dragenter", "dragover"].forEach((t) =>
      drop.addEventListener(t, (event) => {
        event.preventDefault();
        drop.classList.add("over");
      }),
    );
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("over");
      readFiles(event.dataTransfer.files);
    });
    $("#wiki-form").addEventListener("submit", (event) => {
      event.preventDefault();
      fromWikipedia($("#wiki-title").value.trim());
    });
    $("#paste-form").addEventListener("submit", (event) => {
      event.preventDefault();
      addDoc($("#paste-name").value.trim(), $("#paste-text").value);
    });
    $$("[data-open]").forEach((b) =>
      b.addEventListener("click", () => {
        openDoc = openDoc === b.dataset.open ? null : b.dataset.open;
        docsView();
        $(`[data-open="${b.dataset.open}"]`).focus();
      }),
    );
    $$("[data-delete]").forEach((b) =>
      b.addEventListener("click", () =>
        armed(b, "정말 지울까요? 한 번 더", () => {
          const doc = state.docs.find((d) => d.id === b.dataset.delete);
          state.docs = state.docs.filter((d) => d.id !== b.dataset.delete);
          reindex();
          save();
          docNotice = { text: `"${doc.name}"을(를) 지웠어요.`, kind: "ok" };
          docsView();
          say(docNotice.text);
        }),
      ),
    );
  }

  function readFiles(files) {
    for (const f of Array.from(files || [])) {
      const name = f.name.replace(/\.[^.]+$/, "");
      const ext = (f.name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
      if (ext === "pdf") {
        notice(`"${f.name}" — PDF는 아직 지원하지 않아요. .txt나 .md 파일을 올려 주세요.`, "warn");
        continue;
      }
      if (!["txt", "md", "markdown"].includes(ext)) {
        notice(`"${f.name}" — .txt나 .md 파일만 올릴 수 있어요.`, "warn");
        continue;
      }
      if (f.size > MAX_FILE) {
        notice(`"${f.name}" — 파일이 너무 커요 (200KB까지).`, "warn");
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => addDoc(name, String(reader.result));
      reader.onerror = () => notice(`"${f.name}"을(를) 읽지 못했어요.`, "warn");
      reader.readAsText(f, "utf-8");
    }
  }

  // 위키백과에서 가져오기 — 한국어 위키백과 API(무료, 키 없음, origin=*로 앱에서 바로 불러요).
  // 제목이 딱 맞지 않으면 검색해서 가장 비슷한 문서를 가져와요. "== 소제목 =="은 "## 소제목"으로 바꿔
  // 단락 나누기(BOT.chunk)가 소제목마다 묶음을 만들게 해요.
  const WIKI = "https://ko.wikipedia.org/w/api.php";
  async function wikiJson(params) {
    const response = await fetch(`${WIKI}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`);
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }
  async function fromWikipedia(query) {
    if (!query) return notice("가져올 주제를 적어 주세요.", "warn");
    notice(`위키백과에서 "${query}"을(를) 찾는 중…`, "ok");
    try {
      const found = await wikiJson({ action: "query", list: "search", srsearch: query, srlimit: "1" });
      const hit = found.query && found.query.search && found.query.search[0];
      if (!hit) return notice(`위키백과에서 "${query}"을(를) 찾지 못했어요. 다른 낱말로 해 보세요.`, "warn");
      const page = await wikiJson({ action: "query", prop: "extracts", explaintext: "1", exsectionformat: "wiki", redirects: "1", titles: hit.title });
      const text = Object.values(page.query.pages)[0].extract || "";
      if (text.length < 200) return notice(`"${hit.title}" 문서가 너무 짧아요. 다른 주제로 해 보세요.`, "warn");
      const body = text
        .slice(0, MAX_FILE)
        .replace(/^={2,}\s*(.+?)\s*={2,}\s*$/gm, "## $1")
        .replace(/\n{3,}/g, "\n\n");
      const url = `https://ko.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`;
      addDoc(`${hit.title} (위키백과)`, `# ${hit.title}\n\n출처: 위키백과 "${hit.title}" (${url}) · CC BY-SA 4.0\n\n${body}`);
    } catch (error) {
      notice("위키백과에 지금 닿지 못했어요. 조금 뒤에 다시 해 보세요.", "warn");
    }
  }

  function notice(text, kind) {
    docNotice = { text, kind };
    docsView();
    say(text);
  }

  function addDoc(name, text) {
    const clean = text.replace(/\u0000/g, "").trim();
    if (!name || !clean) return notice("문서 이름과 내용을 모두 적어 주세요.", "warn");
    const total = state.docs.reduce((s, d) => s + d.text.length, 0) + clean.length;
    if (total > MAX_TOTAL) return notice("문서가 너무 많아요. 이 데모는 문서 전체 약 80만 자까지 담아요.", "warn");
    const doc = { id: `doc-${Date.now().toString(36)}`, name: name.slice(0, 40), text: clean };
    state.docs.push(doc);
    reindex();
    const count = chunks.filter((c) => c.docId === doc.id).length;
    save().then((ok) =>
      notice(`"${doc.name}"을(를) 단락 ${count}개로 나눠 추가했어요.${ok ? "" : " (이 창에서는 저장이 막혀 있어 새로 고치면 사라져요.)"}`, "ok"),
    );
  }

  // ---------------------------------------------------------------- 설정
  function settingsView() {
    const s = state.settings;
    main.innerHTML = `
      <div class="pageHead"><h2>설정</h2><p class="muted">바꾸면 바로 저장되고, 미리보기와 위젯에 그대로 반영돼요.</p></div>
      <div class="settingsLayout">
        <form id="settings" class="panel settingsForm">
          <label>챗봇 이름 <input name="name" maxlength="20" value="${esc(s.name)}"></label>
          <fieldset><legend>말투</legend>
            <label class="radio"><input type="radio" name="tone" value="친근" ${s.tone === "친근" ? "checked" : ""}> 친근하게 <small>"여기 적혀 있어요!"</small></label>
            <label class="radio"><input type="radio" name="tone" value="공식" ${s.tone === "공식" ? "checked" : ""}> 공식적으로 <small>"관련 내용은 다음과 같습니다."</small></label>
          </fieldset>
          <label>환영 메시지 <textarea name="welcome" rows="3" maxlength="200">${esc(s.welcome)}</textarea></label>
          <label>못 찾을 때 문구 <textarea name="notFound" rows="3" maxlength="200">${esc(s.notFound)}</textarea></label>
          <p class="muted small" id="saved" aria-live="polite"></p>
        </form>
        <section class="panel phone" aria-label="미리보기">
          <div class="miniHead"><span class="avatar">${esc((s.name || "봇").slice(0, 1))}</span><b>${esc(s.name)}</b></div>
          <div class="msg bot"><div class="bubble">${esc(s.welcome)}</div></div>
          <div class="msg me"><div class="bubble">아이패드 앱도 있어요?</div></div>
          <div class="msg bot"><div class="bubble">${esc(s.notFound)}</div></div>
        </section>
      </div>`;
    const form = $("#settings");
    form.addEventListener("input", () => {
      const data = new FormData(form);
      state.settings = {
        name: String(data.get("name") || "").trim() || "문서 챗봇",
        tone: data.get("tone") === "공식" ? "공식" : "친근",
        welcome: String(data.get("welcome") || ""),
        notFound: String(data.get("notFound") || ""),
      };
      live.price = undefined; // 이름·말투가 바뀌면 가격도 다시
      $(".phone").innerHTML = `<div class="miniHead"><span class="avatar">${esc(state.settings.name.slice(0, 1))}</span><b>${esc(state.settings.name)}</b></div>
        <div class="msg bot"><div class="bubble">${esc(state.settings.welcome)}</div></div>
        <div class="msg me"><div class="bubble">아이패드 앱도 있어요?</div></div>
        <div class="msg bot"><div class="bubble">${esc(state.settings.notFound)}</div></div>`;
      save().then((ok) => {
        $("#saved").textContent = ok ? "저장했어요." : "이 창에서는 저장이 막혀 있어요 — 새로 고치면 처음 값으로 돌아가요.";
      });
    });
  }

  // ---------------------------------------------------------------- 퍼가기
  function widgetUrl() {
    return new URL("widget.html", location.href.split("#")[0]).href;
  }
  function snippet() {
    return `<iframe src="${widgetUrl()}" title="${esc(state.settings.name)}" width="380" height="560" style="border:0;border-radius:16px" loading="lazy"></iframe>`;
  }
  // 미리보기는 srcdoc으로 그려요 — 앱 주소는 다른 화면 안에 띄우는 것을 막아 두었기 때문이에요.
  function widgetSrcdoc() {
    const base = new URL(".", location.href.split("#")[0]).href;
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="${esc(base)}">
      <meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="style.css"></head>
      <body class="widgetPage"><div id="widget" class="widgetRoot"></div>
      <script src="js/docs.js"></script><script src="js/search.js"></script><script src="js/chat.js"></script><script src="js/widget.js"></script></body></html>`;
  }

  function embedView() {
    main.innerHTML = `
      <div class="pageHead"><h2>퍼가기</h2><p class="muted">아래 한 줄을 웹페이지에 붙이면 이 챗봇이 작은 창으로 들어가요.</p></div>
      <div class="embedLayout">
        <section class="panel">
          <h3>코드 한 줄</h3>
          <textarea id="snippet" class="code" rows="4" readonly aria-label="퍼가기 코드">${esc(snippet())}</textarea>
          <div class="row"><button type="button" class="primary" id="copy-snippet">${snippetCopied ? "복사됨" : "복사"}</button>
            <span class="muted small" id="copy-msg" aria-live="polite"></span></div>
          <div class="honest">
            <b>지금 알아 둘 것</b>
            <ul>
              <li>CTRL+AI 앱 주소는 보안 설정상 <b>CTRL+AI 화면 안에서만</b> 다른 창에 띄울 수 있어요. 다른 사이트에 붙이는 건 AI 연결 때 함께 열려요.</li>
              <li>위젯 주소를 바로 열면 이 기기에 저장된 문서·설정으로 답해요.</li>
              <li>문서는 이 기기의 브라우저에만 있어요 — 다른 사람의 기기에서는 샘플 문서로 답해요.</li>
            </ul>
          </div>
        </section>
        <section class="panel widgetPreview">
          <h3>위젯 미리보기 <span class="demo">실제 위젯과 같은 코드</span></h3>
          <iframe id="widget-frame" title="위젯 미리보기" sandbox="allow-scripts allow-forms"></iframe>
          <p class="muted small">여기서 나눈 대화도 관리자 탭의 기록에 쌓여요.</p>
        </section>
      </div>`;
    const frame = $("#widget-frame");
    frame.srcdoc = widgetSrcdoc();
    $("#copy-snippet").addEventListener("click", copySnippet);
  }

  async function copySnippet() {
    const area = $("#snippet");
    let ok = false;
    try {
      await navigator.clipboard.writeText(area.value);
      ok = true;
    } catch (error) {
      area.focus();
      area.select();
      try {
        ok = document.execCommand("copy");
      } catch (error2) {
        ok = false;
      }
    }
    if (ok) {
      snippetCopied = true;
      $("#copy-snippet").textContent = "복사됨";
      say("코드를 복사했어요.");
      setTimeout(() => {
        snippetCopied = false;
        const b = $("#copy-snippet");
        if (b) b.textContent = "복사";
      }, 2000);
    } else {
      $("#copy-msg").textContent = "자동 복사가 막혀 있어요. 선택된 코드를 직접 복사하세요 (Ctrl+C).";
    }
  }

  // 위젯이 보낸 메시지 — 우리 미리보기 창에서 온 것만 받아요.
  window.addEventListener("message", (event) => {
    const frame = $("#widget-frame");
    if (!frame || event.source !== frame.contentWindow || !event.data) return;
    const data = event.data;
    if (data.type === "bot-ready") {
      frame.contentWindow.postMessage({ type: "bot-config", settings: state.settings, docs: state.docs }, "*");
    } else if (data.type === "bot-log" && data.log && typeof data.log.q === "string") {
      const log = data.log;
      addLog({
        id: String(log.id).slice(0, 60),
        at: new Date().toISOString(),
        q: log.q.slice(0, 200),
        found: !!log.found,
        source: log.source ? { doc: String(log.source.doc).slice(0, 60), label: String(log.source.label).slice(0, 80) } : null,
        excerpt: String(log.excerpt || "").slice(0, 160),
        rating: 0,
        topic: B.topicOf(log.q),
        widget: true,
      });
    } else if (data.type === "bot-rate") {
      rate(String(data.id), [1, -1, 0].includes(data.rating) ? data.rating : 0);
    }
  });

  // ---------------------------------------------------------------- 관리자
  function adminView() {
    const logs = [...state.logs].sort((a, b) => (a.at < b.at ? 1 : -1));
    const found = logs.filter((l) => l.found).length;
    const up = logs.filter((l) => l.rating === 1).length;
    const down = logs.filter((l) => l.rating === -1).length;
    const missing = logs.filter((l) => !l.found);
    const shown = logs.filter((l) => (logFilter === "missing" ? !l.found : logFilter === "down" ? l.rating === -1 : true));
    const detail = openLog && logs.find((l) => l.id === openLog);
    main.innerHTML = `
      <div class="pageHead"><h2>관리자</h2><p class="muted">회원들이 챗봇에 무엇을 물었는지 봐요. 샘플 기록 30개가 들어 있어요.</p></div>
      <div class="stats">
        <div class="panel stat"><small>대화</small><b>${logs.length}</b></div>
        <div class="panel stat"><small>답한 비율</small><b>${logs.length ? Math.round((found / logs.length) * 100) : 0}%</b></div>
        <div class="panel stat"><small>👍 도움 됐어요</small><b>${up}</b></div>
        <div class="panel stat"><small>👎 아쉬워요</small><b>${down}</b></div>
      </div>
      <div class="adminGrid">
        <section class="panel"><h3>주제별 질문</h3>${topicChart(logs)}</section>
        <section class="panel"><h3>못 찾은 질문 <span class="count">${missing.length}</span></h3>
          ${missing.length ? `<ul class="missing">${missing
            .slice(0, 8)
            .map((l) => `<li><span>${esc(l.q)}</span><small>${when(l.at)}</small></li>`)
            .join("")}</ul>
          <p class="muted small">자주 나오는 질문이면 문서에 답을 적어 올려 두세요.</p>` : `<p class="muted">모두 답했어요.</p>`}
        </section>
      </div>
      <section class="panel logs">
        <div class="logsHead"><h3>대화 기록</h3>
          <div class="filters" role="group" aria-label="기록 거르기">
            ${[["all", "전체"], ["missing", "못 찾음"], ["down", "👎"]]
              .map(([k, label]) => `<button type="button" data-filter="${k}" aria-pressed="${logFilter === k}">${label}</button>`)
              .join("")}
          </div></div>
        <div class="logsBody">
          <ul class="logList">${shown
            .map(
              (l) => `<li><button type="button" class="logRow ${openLog === l.id ? "on" : ""}" data-log="${l.id}" aria-expanded="${openLog === l.id}">
                <small>${when(l.at)}</small><span class="q">${esc(l.q)}</span>
                <span class="state ${l.found ? "ok" : "miss"}">${l.found ? "답함" : "못 찾음"}</span>
                <span class="r">${l.rating === 1 ? "👍" : l.rating === -1 ? "👎" : ""}</span></button></li>`,
            )
            .join("") || `<li class="muted">기록이 없어요.</li>`}</ul>
          <aside class="logDetail" aria-live="polite">${detail ? detailHtml(detail) : `<p class="muted">기록을 누르면 자세히 보여요.</p>`}</aside>
        </div>
      </section>
      <p class="muted small">기록은 이 기기의 브라우저에만 있어요. 다른 방문자의 대화는 모이지 않아요.</p>`;
    $$("[data-filter]").forEach((b) => b.addEventListener("click", () => ((logFilter = b.dataset.filter), adminView())));
    $$("[data-log]").forEach((b) =>
      b.addEventListener("click", () => {
        openLog = openLog === b.dataset.log ? null : b.dataset.log;
        adminView();
        const again = $(`[data-log="${b.dataset.log}"]`);
        if (again) again.focus();
      }),
    );
  }

  function detailHtml(l) {
    return `<p class="muted small">${when(l.at)} · 주제: ${esc(l.topic)}${l.widget ? " · 위젯" : ""}${l.sample ? " · 샘플" : ""}</p>
      <p class="dq">${esc(l.q)}</p>
      ${l.found
        ? `<blockquote class="quote">${esc(l.excerpt)}${l.excerpt.length >= 160 ? "…" : ""}</blockquote><p class="source">📄 <b>${esc(l.source.doc)}</b> · ${esc(l.source.label)}</p>`
        : `<p class="notice warn">문서에서 찾지 못해 "못 찾을 때 문구"로 답했어요.</p>`}
      <p>평가: ${l.rating === 1 ? "👍 도움이 됐어요" : l.rating === -1 ? "👎 도움이 안 됐어요" : "없음"}</p>`;
  }

  // 주제별 가로 막대 — 진한 부분은 답한 것, 옅은 부분은 못 찾은 것.
  function topicChart(logs) {
    const topics = new Map();
    logs.forEach((l) => {
      const t = topics.get(l.topic) || { all: 0, missing: 0 };
      t.all += 1;
      if (!l.found) t.missing += 1;
      topics.set(l.topic, t);
    });
    const rows = [...topics.entries()].sort((a, b) => b[1].all - a[1].all);
    if (!rows.length) return `<p class="muted">아직 질문이 없어요.</p>`;
    const max = Math.max(...rows.map(([, t]) => t.all));
    const rowH = 26;
    const labelW = 86;
    const W = 420;
    const barW = W - labelW - 40;
    const H = rows.length * rowH + 8;
    const bars = rows
      .map(([name, t], i) => {
        const y = 4 + i * rowH;
        const answered = ((t.all - t.missing) / max) * barW;
        const missing = (t.missing / max) * barW;
        return `<g transform="translate(0,${y})">
          <text x="${labelW - 8}" y="15" text-anchor="end" class="axis">${esc(name)}</text>
          <rect x="${labelW}" y="3" width="${Math.max(answered, 0).toFixed(1)}" height="16" rx="4" class="barOk"/>
          ${t.missing ? `<rect x="${(labelW + answered).toFixed(1)}" y="3" width="${missing.toFixed(1)}" height="16" rx="4" class="barMiss"/>` : ""}
          <text x="${(labelW + answered + missing + 6).toFixed(1)}" y="15" class="val">${t.all}</text>
        </g>`;
      })
      .join("");
    return `<svg class="topicChart" viewBox="0 0 ${W} ${H}" role="img" aria-label="주제별 질문 수: ${rows
      .map(([n, t]) => `${n} ${t.all}개${t.missing ? `(못 찾음 ${t.missing})` : ""}`)
      .join(", ")}">${bars}</svg>
      <p class="legendLine"><span class="sw ok"></span>답함 <span class="sw miss"></span>못 찾음</p>`;
  }

  // ---------------------------------------------------------------- 탭
  const VIEWS = { chat: chatView, docs: docsView, settings: settingsView, embed: embedView, admin: adminView };
  function show(name) {
    view = name;
    $$("[data-view]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.view === name)));
    docNotice = name === "docs" ? docNotice : null;
    VIEWS[name]();
  }
  $$("[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      show(b.dataset.view);
      main.focus();
    }),
  );

  $("#reset").addEventListener("click", (event) =>
    armed(event.currentTarget, "정말 처음으로? 한 번 더", () => {
      state = fresh();
      reindex();
      save();
      lastHits = null;
      openDoc = null;
      openLog = null;
      event.currentTarget.textContent = "데모 초기화";
      event.currentTarget.classList.remove("danger");
      show(view);
      say("샘플 문서와 샘플 기록으로 되돌렸어요.");
    }),
  );

  // CTRL+AI 줄의 스위치가 바뀌면 그대로 따라가요 — 켜도, 꺼도.
  window.addEventListener("ctrlai:ai-mode", (event) => {
    const on = Boolean(sdk && event.detail && event.detail.mode === "live");
    if (on !== live.on) {
      live.on = on;
      show(view);
    }
  });
  // 샘플로 바로 그리고, 저장된 문서와 AI 스위치 상태가 오면 다시 그려요 (첫 화면이 늦게 뜨지 않게).
  show("chat");
  Promise.all([store.get(KEY), sdk && sdk.ai.mode ? sdk.ai.mode().catch(() => "demo") : "demo"])
    .then(([saved, aiMode]) => {
      if (saved && Array.isArray(saved.docs) && Array.isArray(saved.logs)) {
        state = { ...saved, settings: { ...B.DEFAULT_SETTINGS, ...saved.settings } };
        reindex();
      }
      // CTRL+AI 줄의 스위치가 정해요 (만든 사람의 '데모만'이면 늘 데모).
      live.on = Boolean(sdk && aiMode === "live");
      modeBadge();
    })
    .catch(() => {
      /* 저장소를 못 쓰면 샘플로 시작해요 */
    })
    .then(() => show("chat"));
})();
