// 문서 챗봇 메이커 — 문서 나누기(청크)와 찾기(BM25).
// 찾기는 BOT.retrieve() 한 함수 뒤에 숨겨 두었어요. 실제 AI도 이 결과를 Claude에 주고, 바꾸려면 이 함수만
// 바꾸면(예: 임베딩 검색 + Claude 정리) 나머지 화면은 그대로 둘 수 있어요.

(function () {
  const B = window.BOT;

  // ---------------------------------------------------------------- 나누기
  // 제목(#)이 나오면 새 묶음, 빈 줄로 단락을 나누고, 짧은 단락은 붙이고 긴 단락은 문장으로 잘라요.
  B.chunk = function (doc) {
    const MIN = 60;
    const MAX = 500;
    const out = [];
    let heading = "";
    let paragraph = 0;
    let underHeading = 0;
    let buffer = [];
    let keywords = ""; // "(쉬운 말 색인: …)" 줄 — 찾기에만 쓰고 화면에는 안 보여요
    const flush = () => {
      const text = buffer.join(" ").trim();
      buffer = [];
      if (!text) return;
      paragraph += 1;
      const pieces = text.length > MAX ? splitSentences(text, MAX) : [text];
      pieces.forEach((piece) => {
        underHeading += 1;
        out.push({
          doc: doc.name,
          docId: doc.id,
          // 제목 아래 두 번째 단락부터는 "· 2단락"을 붙여 구분해요.
          label: heading ? `${heading}${underHeading > 1 ? ` · ${underHeading}단락` : ""}` : `${paragraph}단락`,
          text: piece,
          keywords,
        });
        keywords = ""; // 조문의 첫 단락에만
      });
    };
    const lines = doc.text.replace(/\r\n?/g, "\n").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) {
        flush();
        // 문서 맨 위 제목(#)은 문서 이름과 같으니 단락 이름으로 쓰지 않아요.
        heading = /^#\s/.test(line) ? "" : h[1].trim();
        underHeading = 0;
        keywords = "";
        continue;
      }
      const index = line.match(/^\(쉬운 말 색인:\s*(.*)\)$/);
      if (index) {
        keywords = index[1];
        continue;
      }
      if (!line) {
        if (buffer.join(" ").length >= MIN) flush();
        continue;
      }
      buffer.push(line.replace(/^[-*]\s+/, ""));
    }
    flush();
    return out.map((c, i) => ({ ...c, id: `${doc.id}#${i}` }));
  };

  function splitSentences(text, max) {
    const sentences = text.match(/[^.!?。]+[.!?。]?\s*/g) || [text];
    const pieces = [];
    let current = "";
    for (const s of sentences) {
      if ((current + s).length > max && current) {
        pieces.push(current.trim());
        current = "";
      }
      current += s;
    }
    if (current.trim()) pieces.push(current.trim());
    return pieces;
  }

  // ---------------------------------------------------------------- 낱말
  // 한국어는 조사가 붙어 낱말이 달라지니(회비는/회비를), 낱말 + 두 글자씩(바이그램)을 함께 써요.
  const STOP = new Set([
    "어떻게", "무엇", "뭐", "뭔가요", "뭐예요", "있나요", "있어요", "하나요", "해요", "돼요", "되나요", "알려", "주세요",
    "언제", "어디", "얼마", "얼마나", "수", "좀", "그", "이", "저", "것", "건가요", "인가요", "나요", "요", "제",
    "내", "을", "를", "은", "는", "에", "의", "가", "하는", "하면", "싶어요", "법", "방법", "어디서", "어디로",
  ]);
  const PARTICLES = /(으로|에서|까지|부터|이랑|하고|이에요|예요|인가요|나요|은|는|이|가|을|를|에|의|도|로|와|과|요)$/;

  B.tokens = function (text) {
    const words = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const out = [];
    for (const word of words) {
      if (STOP.has(word)) continue;
      const stem = word.length > 2 ? word.replace(PARTICLES, "") : word;
      if (!STOP.has(stem)) out.push(stem);
      if (/[가-힣]/.test(stem) && stem.length > 2) {
        for (let i = 0; i < stem.length - 1; i += 1) out.push(stem.slice(i, i + 2));
      }
    }
    return out;
  };

  // ---------------------------------------------------------------- BM25
  B.buildIndex = function (chunks) {
    const docs = chunks.map((c) => {
      const terms = B.tokens(`${c.label} ${c.keywords || ""} ${c.text}`);
      const tf = new Map();
      terms.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      return { chunk: c, tf, length: terms.length };
    });
    const df = new Map();
    docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
    const avg = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
    return { docs, df, avg, n: docs.length };
  };

  const K1 = 1.2;
  const BB = 0.75;

  // 질문과 가장 잘 맞는 단락들. score는 질문 낱말 수로 나눈 값이라 질문 길이와 상관없이 비교돼요.
  B.retrieve = function (question, index, limit = 3) {
    const q = [...new Set(B.tokens(question))];
    if (!q.length || !index.n) return [];
    const results = index.docs.map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = index.df.get(t);
        const idf = Math.log(1 + (index.n - n + 0.5) / (n + 0.5));
        score += (idf * f * (K1 + 1)) / (f + K1 * (1 - BB + (BB * d.length) / index.avg));
      }
      return { chunk: d.chunk, score: score / q.length };
    });
    return results
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };

  // 이 점수보다 낮으면 "찾을 수 없어요"로 답해요.
  B.THRESHOLD = 0.88;

  // 답: 가장 잘 맞는 단락을 그대로 인용하고, 기준을 넘는 나머지는 "관련 단락"으로 알려 줘요.
  B.answer = function (question, index) {
    const hits = B.retrieve(question, index, 3);
    if (!hits.length || hits[0].score < B.THRESHOLD) return { found: false, best: null, related: [] };
    return {
      found: true,
      best: hits[0],
      related: hits.slice(1).filter((h) => h.score >= B.THRESHOLD),
    };
  };
})();
