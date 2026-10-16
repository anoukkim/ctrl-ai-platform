// 문서 챗봇 메이커 — 대화창. 만들기 화면의 미리보기와 퍼가기 위젯(widget.html)이 함께 써요.

(function () {
  const B = window.BOT;

  B.esc = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const DEMO_BADGE = "데모 · 문서 문장을 그대로 보여 줘요 (로그인하면 Claude가 정리)";
  // 실제 AI (app-platform P4b): 찾은 단락을 Claude에게 주고 출처가 붙은 답을 받아요.
  // 근거가 없으면(found: false) 설정의 "못 찾을 때 문구"를 그대로 보여 줘요.
  B.ANSWER_SCHEMA = {
    type: "object",
    required: ["found", "answer", "sources"],
    additionalProperties: false,
    properties: {
      found: { type: "boolean" },
      answer: { type: "string" },
      sources: { type: "array", maxItems: 4, items: { type: "integer", minimum: 1, maximum: 4 } },
    },
  };
  B.answerOptions = function (settings, hits, question) {
    const passages = hits.map((h, i) => `[${i + 1}] ${h.chunk.doc} · ${h.chunk.label}\n${h.chunk.text}`).join("\n\n");
    return {
      system: `당신은 "${settings.name || "문서 챗봇"}"이에요. 주어진 문서 단락만 근거로 한국어로 ${settings.tone === "공식" ? "공식적이고 정중하게" : "친근하게"} 2~4문장으로 답해요. 단락에 답이 없으면 found를 false로 하고 answer는 비워요. sources에는 근거로 쓴 단락 번호를 적어요.`,
      prompt: `문서 단락:\n${passages}\n\n질문: ${question}`,
      json: B.ANSWER_SCHEMA,
      maxTokens: 350,
    };
  };
  // 가격은 가장 긴 단락 4개 + 가장 긴 질문(200자) 기준 — 실제 질문은 그보다 짧거나 같아요.
  B.priceOptions = function (settings, index) {
    const longest = index.docs
      .slice()
      .sort((a, b) => b.chunk.text.length - a.chunk.text.length)
      .slice(0, 4)
      .map((d) => ({ chunk: d.chunk }));
    return B.answerOptions(settings, longest, "가".repeat(200));
  };
  const reduced = () => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (error) {
      return false;
    }
  };

  const INTRO = {
    친근: ["문서에서 이 부분을 찾았어요 😊", "여기 적혀 있어요!", "이 내용을 보면 될 것 같아요."],
    공식: ["관련 내용은 다음과 같습니다.", "문서의 해당 부분을 안내해 드립니다.", "다음 조항을 참고해 주십시오."],
  };

  let counter = 0;
  B.newId = () => `log-${Date.now().toString(36)}-${(counter += 1)}`;

  /**
   * root: 대화창을 그릴 요소
   * opts.settings(): 지금 설정, opts.index(): 지금 찾기 색인, opts.summary(): "문서 2개 · 단락 25개"
   * opts.onLog(log), opts.onRate(id, rating), opts.onHits(hits): 마지막 찾기 결과(점수 보기용)
   * opts.suggestions: 처음에 보여 줄 질문 예시
   */
  B.mountChat = function (root, opts) {
    const s = () => opts.settings();
    root.innerHTML = `
      <div class="chat">
        <header class="chatHead">
          <span class="avatar" aria-hidden="true"></span>
          <div><b class="botName"></b><small class="botMeta"></small></div>
        </header>
        <ol class="messages" role="log" aria-live="polite" aria-label="대화"></ol>
        <div class="suggest"></div>
        <form class="composer">
          <label class="visually-hidden" for="${root.id}-input">질문</label>
          <input id="${root.id}-input" type="text" autocomplete="off" placeholder="문서에 대해 물어보세요" maxlength="200">
          <button type="submit" class="send" aria-label="보내기">↑</button>
        </form>
      </div>`;
    const list = root.querySelector(".messages");
    const input = root.querySelector("input");
    const form = root.querySelector("form");
    const suggest = root.querySelector(".suggest");
    let busy = false;

    function refreshHead() {
      root.querySelector(".avatar").textContent = (s().name || "봇").slice(0, 1);
      root.querySelector(".botName").textContent = s().name || "문서 챗봇";
      root.querySelector(".botMeta").textContent = opts.summary();
    }

    function add(html, cls) {
      const li = document.createElement("li");
      li.className = cls;
      li.innerHTML = html;
      list.append(li);
      list.scrollTop = list.scrollHeight;
      return li;
    }

    // 글자를 하나씩 — 실제 AI처럼 흘러나오는 느낌만 흉내 내요.
    function stream(el, text) {
      return new Promise((resolve) => {
        if (reduced()) {
          el.textContent = text;
          return resolve();
        }
        let i = 0;
        const timer = setInterval(() => {
          i = Math.min(text.length, i + 3);
          el.textContent = text.slice(0, i);
          list.scrollTop = list.scrollHeight;
          if (i >= text.length) {
            clearInterval(timer);
            resolve();
          }
        }, 16);
      });
    }

    function reset() {
      list.innerHTML = "";
      refreshHead();
      add(`<div class="bubble">${B.esc(s().welcome || "무엇이든 물어보세요.")}</div>`, "msg bot");
      suggest.innerHTML = (opts.suggestions || [])
        .map((q) => `<button type="button" class="chipQ">${B.esc(q)}</button>`)
        .join("");
      suggest.hidden = !(opts.suggestions || []).length;
    }

    async function ask(question) {
      const q = question.trim();
      if (!q || busy) return;
      busy = true;
      form.querySelector(".send").disabled = true;
      suggest.hidden = true;
      add(`<div class="bubble">${B.esc(q)}</div>`, "msg me");
      if (opts.live && opts.live()) {
        await askAi(q);
        busy = false;
        form.querySelector(".send").disabled = false;
        input.focus();
        return;
      }
      const result = B.answer(q, opts.index());
      if (opts.onHits) opts.onHits(q, B.retrieve(q, opts.index(), 3));
      const log = {
        id: B.newId(),
        at: new Date().toISOString(),
        q,
        found: result.found,
        source: result.found ? { doc: result.best.chunk.doc, label: result.best.chunk.label } : null,
        excerpt: result.found ? result.best.chunk.text.slice(0, 160) : "",
        rating: 0,
        topic: B.topicOf(q),
      };
      const li = add(
        `<div class="bubble">
          <p class="intro"></p>
          ${result.found ? `<blockquote class="quote"></blockquote>
          <p class="source" hidden>📄 <b>${B.esc(result.best.chunk.doc)}</b> · ${B.esc(result.best.chunk.label)}</p>` : ""}
          <div class="after" hidden>
            ${result.related.length ? `<div class="related">관련 단락: ${result.related
              .map((h, i) => `<button type="button" class="link" data-related="${i}">${B.esc(h.chunk.doc)} · ${B.esc(h.chunk.label)}</button>`)
              .join("")}</div>` : ""}
            <span class="demo">${DEMO_BADGE}</span>
            <span class="rate" role="group" aria-label="이 답이 도움이 됐나요?">
              <button type="button" data-rate="1" aria-pressed="false" aria-label="도움이 됐어요">👍</button>
              <button type="button" data-rate="-1" aria-pressed="false" aria-label="도움이 안 됐어요">👎</button>
            </span>
          </div>
        </div>`,
        "msg bot",
      );
      const tone = INTRO[s().tone] ? s().tone : "친근";
      const intro = result.found ? INTRO[tone][q.length % INTRO[tone].length] : s().notFound || "문서에서 찾을 수 없어요.";
      await stream(li.querySelector(".intro"), intro);
      if (result.found) {
        await stream(li.querySelector(".quote"), result.best.chunk.text);
        li.querySelector(".source").hidden = false;
      }
      li.querySelector(".after").hidden = false;
      li.querySelectorAll("[data-related]").forEach((b) =>
        b.addEventListener("click", () => {
          const h = result.related[Number(b.dataset.related)];
          add(
            `<div class="bubble"><blockquote class="quote">${B.esc(h.chunk.text)}</blockquote>
              <p class="source">📄 <b>${B.esc(h.chunk.doc)}</b> · ${B.esc(h.chunk.label)}</p><span class="demo">${DEMO_BADGE}</span></div>`,
            "msg bot",
          );
        }),
      );
      li.querySelectorAll("[data-rate]").forEach((b) =>
        b.addEventListener("click", () => {
          const value = Number(b.dataset.rate);
          log.rating = log.rating === value ? 0 : value;
          li.querySelectorAll("[data-rate]").forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.rate) === log.rating)));
          opts.onRate(log.id, log.rating);
        }),
      );
      list.scrollTop = list.scrollHeight;
      opts.onLog(log);
      busy = false;
      form.querySelector(".send").disabled = false;
      input.focus();
    }

    // 실제 AI: BM25로 찾은 단락이 있을 때만 Claude를 불러요 (없으면 0원, 못 찾음).
    async function askAi(q) {
      const hits = B.retrieve(q, opts.index(), 4);
      if (opts.onHits) opts.onHits(q, hits.slice(0, 3));
      const log = { id: B.newId(), at: new Date().toISOString(), q, found: false, source: null, excerpt: "", rating: 0, topic: B.topicOf(q), ai: true };
      const li = add(`<div class="bubble"><p class="intro"></p><div class="sources"></div><div class="after" hidden>
          <span class="demo live"></span>
          <span class="rate" role="group" aria-label="이 답이 도움이 됐나요?">
            <button type="button" data-rate="1" aria-pressed="false" aria-label="도움이 됐어요">👍</button>
            <button type="button" data-rate="-1" aria-pressed="false" aria-label="도움이 안 됐어요">👎</button>
          </span></div></div>`, "msg bot");
      let text = s().notFound || "문서에서 찾을 수 없어요.";
      let badge = "실제 AI · 0원 (근거 단락 없음)";
      if (hits.length) {
        li.querySelector(".intro").textContent = "생각하는 중…";
        try {
          const result = await opts.sdk().ai.ask(B.answerOptions(s(), hits, q));
          const out = result.json || {};
          const used = (Array.isArray(out.sources) ? out.sources : []).map((n) => hits[n - 1]).filter(Boolean);
          if (out.found && String(out.answer || "").trim()) {
            text = String(out.answer).trim();
            log.found = true;
            log.source = used[0] ? { doc: used[0].chunk.doc, label: used[0].chunk.label } : { doc: hits[0].chunk.doc, label: hits[0].chunk.label };
            log.excerpt = text.slice(0, 160);
            li.querySelector(".sources").innerHTML = (used.length ? used : hits.slice(0, 1))
              .map((h) => `<p class="source">📄 <b>${B.esc(h.chunk.doc)}</b> · ${B.esc(h.chunk.label)}</p>`)
              .join("");
          }
          badge = `실제 AI · ${result.chargedKrw}원 · 내 동아리 지원금에서`;
        } catch (error) {
          text = `AI가 답하지 못했어요: ${error && error.message ? error.message : "다시 시도해 주세요"}`;
          badge = "실제 AI · 오류";
        }
      }
      li.querySelector(".intro").textContent = "";
      await stream(li.querySelector(".intro"), text);
      li.querySelector(".after .demo").textContent = badge;
      li.querySelector(".after").hidden = false;
      li.querySelectorAll("[data-rate]").forEach((b) =>
        b.addEventListener("click", () => {
          const value = Number(b.dataset.rate);
          log.rating = log.rating === value ? 0 : value;
          li.querySelectorAll("[data-rate]").forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.rate) === log.rating)));
          opts.onRate(log.id, log.rating);
        }),
      );
      list.scrollTop = list.scrollHeight;
      opts.onLog(log);
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = input.value;
      input.value = "";
      ask(q);
    });
    suggest.addEventListener("click", (event) => {
      const button = event.target.closest(".chipQ");
      if (button) ask(button.textContent);
    });

    reset();
    return { reset, refreshHead, ask };
  };
})();
