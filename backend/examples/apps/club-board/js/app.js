// 동아리 게시판 — 카카오톡 채팅방처럼 보이는 공지·자유·질문 글과 댓글.
// 새 글은 15초마다 확인해서 알려 주고, 지난번에 본 뒤 올라온 글에는 N 표시가 붙어요.
// 실제 AI(위쪽 CTRL+AI 줄의 스위치)가 켜져 있으면 질문 글에 「✦ AI 답변 초안」, 댓글이 많은 글에 「✦ AI 3줄 요약」이 생겨요.
// 글은 CTRL+AI 기능 상자의 공유 목록(ctrlai.db: posts, comments, reactions — ctrlai.json에 적혀 있어요)에 있어요.
// 누구나 읽고, 로그인한 회원이 쓰고, 쓴 사람이 고치고, 이상한 글은 신고해요.
// 글 하나에 사진은 1장만: 작게 줄인 JPEG 데이터를 글 데이터(image)에 같이 저장해요.
// 글·댓글마다 반응(좋아요 👍, 하트 ❤️, 체크 ✅)을 눌러 남기고, 다시 누르면 취소돼요.
(function () {
  "use strict";

  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const SHARED = { shared: true };
  const CATEGORIES = ["공지", "자유", "질문"];
  const MAX_IMAGE_CHARS = 2400; // 글 한 개가 4KB 이하여야 해서 사진 데이터는 작게
  // 반응 종류: kind는 저장되는 값, emoji는 보이는 모양
  const REACTIONS = [
    { kind: "like", emoji: "👍", label: "좋아요" },
    { kind: "heart", emoji: "❤️", label: "하트" },
    { kind: "check", emoji: "✅", label: "체크" },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const nameOf = (item) => (item && item.author && item.author.displayName) || "알 수 없음";
  // 저장된 사진이 안전한 데이터 주소인지 확인
  const safeImage = (src) => (typeof src === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : "");

  // 프로필 동그라미(이름 첫 글자)
  const AVATAR_COLORS = ["#f6c744", "#8fb8de", "#e7a5a5", "#a8d5a2", "#c3a6e0", "#f1b27a"];
  function avatar(name) {
    let sum = 0;
    for (const ch of String(name)) sum += ch.charCodeAt(0);
    const color = AVATAR_COLORS[sum % AVATAR_COLORS.length];
    const first = String(name).trim().charAt(0) || "?";
    return `<span class="avatar" style="background:${color}" aria-hidden="true">${esc(first)}</span>`;
  }

  // 풍선 바로 아래에 보이는 아이디 (내 글에도 보여요)
  function idLine(name) {
    return `<p class="name">${esc(name)}</p>`;
  }

  let user = null;
  let category = ""; // "" = 전체
  let posts = [];
  let open = null; // 보고 있는 글
  let comments = [];
  let editing = null; // 고치는 중인 글
  let pickedImage = ""; // 글쓰기 창에서 고른 사진(데이터 주소), 없으면 ""
  let reactions = []; // 지금 화면에 보이는 글·댓글의 반응 항목들
  let reactionNote = ""; // 반응 관련 안내 문구 (로그인 필요 등)
  let commentCounts = {}; // 글 id → 댓글 수 (목록에 보여요)
  let picking = null; // 반응 고르기 창이 열린 글·댓글 id
  let lastSeen = ""; // 지난번에 목록을 본 때 — 그 뒤 글에 N 표시
  let fresh = 0; // 목록을 본 뒤 새로 올라온 글 수 (15초마다 확인)

  // 지난번에 본 때는 이 기기에 저장해요 — CTRL+AI 안에서는 ctrlai.storage, 밖에서는 localStorage.
  const store =
    window.ctrlai && window.ctrlai.connected
      ? window.ctrlai.storage
      : {
          get: (key) => Promise.resolve().then(() => JSON.parse(localStorage.getItem(key) || "null")),
          set: (key, value) => Promise.resolve().then(() => localStorage.setItem(key, JSON.stringify(value))),
        };
  const SEEN_KEY = "club-board-last-seen";

  // CTRL+AI 밖(데모): 메모리 안의 예시 글.
  const demo = {
    posts: [
      { id: "p1", data: { category: "공지", title: "이번 주 모임은 목요일 7시 (데모)", body: "동아리방에서 만나요. 노트북 챙겨 오세요!" }, author: { displayName: "예시 운영진" }, mine: false, canDelete: false, createdAt: new Date().toISOString() },
      { id: "p2", data: { category: "질문", title: "Builder에서 색 바꾸는 법? (데모)", body: "\"색 바꿔 줘\"라고 말하면 돼요." }, author: { displayName: "예시 회원" }, mine: false, canDelete: false, createdAt: new Date().toISOString() },
    ],
    comments: { p2: [{ id: "c1", data: { postId: "p2", body: "저도 궁금했어요!" }, author: { displayName: "예시 회원 2" }, mine: false, canDelete: false, createdAt: new Date().toISOString() }] },
    reactions: [
      { id: "r1", data: { targetId: "p1", kind: "like" }, author: { displayName: "예시 회원" }, mine: false, canDelete: false, createdAt: new Date().toISOString() },
      { id: "r2", data: { targetId: "p1", kind: "heart" }, author: { displayName: "예시 회원 2" }, mine: false, canDelete: false, createdAt: new Date().toISOString() },
      { id: "r3", data: { targetId: "c1", kind: "check" }, author: { displayName: "예시 운영진" }, mine: false, canDelete: false, createdAt: new Date().toISOString() },
    ],
  };

  // ---------- 사진 다루기
  // 사진을 캔버스에 그려 작은 JPEG으로 줄여요 (크기 제한 안에 들어올 때까지 점점 더 줄여요).
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let side = 480;
        let quality = 0.6;
        for (let i = 0; i < 12; i++) {
          const scale = Math.min(1, side / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff"; // 투명한 PNG 배경은 흰색으로
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const out = canvas.toDataURL("image/jpeg", quality);
          if (out.length <= MAX_IMAGE_CHARS) return resolve(out);
          side = Math.round(side * 0.8);
          quality = Math.max(0.3, quality - 0.05);
        }
        reject(new Error("too_big"));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad_image")); };
      img.src = url;
    });
  }

  // 글쓰기 창의 사진 칸을 지금 상태(pickedImage)에 맞춰 보여줘요.
  function renderPhotoField() {
    const has = !!pickedImage;
    $("image-preview").hidden = !has;
    if (has) $("image-preview-img").src = pickedImage;
    else $("image-preview-img").removeAttribute("src");
    $("image-choose-text").textContent = has ? "사진 바꾸기" : "사진 고르기";
  }
  function photoError(text) {
    $("image-error").textContent = text || "";
    $("image-error").hidden = !text;
  }

  // ---------- 데이터
  async function loadPosts() {
    if (!sdk) { posts = demo.posts.filter((p) => !category || p.data.category === category); return; }
    const options = { ...SHARED, limit: 50 };
    if (category) options.where = { category };
    posts = (await sdk.db.list("posts", options)).items;
  }
  async function loadComments(post) {
    if (!sdk) { comments = demo.comments[post.id] || []; return; }
    comments = (await sdk.db.list("comments", { ...SHARED, where: { postId: post.id }, orderBy: "createdAt", order: "asc", limit: 100 })).items;
  }
  // 반응 불러오기: 글 하나에 대한 반응은 글·댓글 아이디(targetId)로 모아서 가져와요.
  async function fetchReactionsFor(targetId) {
    if (!sdk) return demo.reactions.filter((r) => r.data.targetId === targetId);
    try {
      return (await sdk.db.list("reactions", { ...SHARED, where: { targetId }, limit: 100 })).items;
    } catch (error) { return []; }
  }
  // 목록 화면: 최근 반응과 댓글을 한 번씩만 불러와 글마다 나눠요 (글마다 따로 묻지 않아요).
  async function loadReactionsForPosts() {
    if (!sdk) {
      reactions = demo.reactions.filter((r) => posts.some((p) => p.id === r.data.targetId));
      commentCounts = Object.fromEntries(Object.entries(demo.comments).map(([id, list]) => [id, list.length]));
      return;
    }
    const ids = new Set(posts.map((p) => p.id));
    const [recentReactions, recentComments] = await Promise.all([
      sdk.db.list("reactions", { ...SHARED, limit: 100 }).catch(() => ({ items: [] })),
      sdk.db.list("comments", { ...SHARED, limit: 100 }).catch(() => ({ items: [] })),
    ]);
    // 최근 100개 안에 다 들어오면 한 번으로 끝, 넘치면(오래된 글이 빠질 수 있으니) 글마다 물어봐요.
    if (recentReactions.items.length < 100) {
      reactions = recentReactions.items.filter((r) => ids.has(r.data.targetId));
    } else {
      reactions = (await Promise.all(posts.map((p) => fetchReactionsFor(p.id)))).flat();
    }
    commentCounts = {};
    if (recentComments.items.length < 100) {
      recentComments.items.forEach((c) => {
        if (ids.has(c.data.postId)) commentCounts[c.data.postId] = (commentCounts[c.data.postId] || 0) + 1;
      });
    } else {
      const counts = await Promise.all(
        posts.map((p) => sdk.db.count("comments", { ...SHARED, where: { postId: p.id } }).catch(() => 0)),
      );
      posts.forEach((p, i) => (commentCounts[p.id] = Number(counts[i]) || 0));
    }
  }
  // 상세 화면: 글과 댓글들의 반응을 불러와요.
  async function loadReactionsForOpen() {
    const ids = [open.id, ...comments.map((c) => c.id)];
    const found = await Promise.all(ids.map((id) => fetchReactionsFor(id)));
    reactions = found.flat();
  }
  async function savePost(data) {
    if (!sdk) {
      if (editing) { Object.assign(editing.data, data); if (!data.image) delete editing.data.image; }
      else demo.posts.unshift({ id: "p" + Date.now(), data, author: { displayName: "나 (데모)" }, mine: true, canDelete: true, createdAt: new Date().toISOString() });
      return;
    }
    if (editing) await sdk.db.update("posts", editing.id, data, SHARED); // image를 빈 값으로 보내면 사진이 지워져요
    else await sdk.db.save("posts", data, SHARED);
    user = await sdk.user();
  }
  // 글·댓글에 달린 내 반응까지 같이 지워요 (지울 수 있는 것만)
  async function removeReactionsOf(targetId) {
    if (!sdk) { demo.reactions = demo.reactions.filter((r) => r.data.targetId !== targetId); return; }
    try {
      const page = await sdk.db.list("reactions", { ...SHARED, where: { targetId }, limit: 100 });
      for (const r of page.items) {
        if (r.mine || r.canDelete) await sdk.db.remove("reactions", r.id, SHARED);
      }
    } catch (error) { /* 못 지워도 글 지우기는 계속해요 */ }
  }
  async function removePost(post) {
    if (!sdk) {
      (demo.comments[post.id] || []).forEach((c) => { demo.reactions = demo.reactions.filter((r) => r.data.targetId !== c.id); });
      demo.reactions = demo.reactions.filter((r) => r.data.targetId !== post.id);
      demo.posts = demo.posts.filter((p) => p !== post);
      delete demo.comments[post.id];
      return;
    }
    // 댓글도 같이 지워요 — 내가 지울 수 있는 것만(내 댓글, 앱 주인이면 전부). 남의 댓글은
    // 그 사람 것이라 남고, 운영진이 Admin › Content에서 정리할 수 있어요.
    const page = await sdk.db.list("comments", { ...SHARED, where: { postId: post.id }, limit: 100 });
    for (const comment of page.items) {
      if (comment.mine || comment.canDelete) {
        await removeReactionsOf(comment.id);
        await sdk.db.remove("comments", comment.id, SHARED);
      }
    }
    await removeReactionsOf(post.id);
    await sdk.db.remove("posts", post.id, SHARED);
  }
  async function saveComment(post, body) {
    if (!sdk) {
      (demo.comments[post.id] = demo.comments[post.id] || []).push({ id: "c" + Date.now(), data: { postId: post.id, body }, author: { displayName: "나 (데모)" }, mine: true, canDelete: true, createdAt: new Date().toISOString() });
      return;
    }
    await sdk.db.save("comments", { postId: post.id, body }, SHARED);
    user = await sdk.user();
  }
  async function removeComment(comment) {
    if (!sdk) {
      await removeReactionsOf(comment.id);
      demo.comments[open.id] = (demo.comments[open.id] || []).filter((c) => c !== comment);
      return;
    }
    await removeReactionsOf(comment.id);
    await sdk.db.remove("comments", comment.id, SHARED);
  }
  async function report(list, id, reason) {
    if (!sdk) return;
    await sdk.db.report(list, id, reason);
  }

  // ---------- 반응 (좋아요·하트·체크)
  // 한 글·댓글에 대한 반응 개수와 "내가 눌렀는지"를 세요.
  function reactionSummary(targetId) {
    const out = {};
    REACTIONS.forEach((r) => { out[r.kind] = { count: 0, mine: null }; });
    reactions.forEach((r) => {
      if (r.data.targetId !== targetId || !out[r.data.kind]) return;
      out[r.data.kind].count += 1;
      if (r.mine) out[r.data.kind].mine = r;
    });
    return out;
  }
  // 반응 줄 HTML: 버튼 3개(이모지 + 숫자). 내가 누른 것은 눌린 모양으로 보여요.
  // 누군가 누른 반응만 보이고, 나머지는 ＋를 눌러 골라요 (카톡처럼).
  function reactionBar(targetId, targetType) {
    const sum = reactionSummary(targetId);
    const shown = REACTIONS.filter((r) => sum[r.kind].count || picking === targetId);
    return `<div class="reactions" role="group" aria-label="반응">${shown
      .map((r) => {
        const s = sum[r.kind];
        const on = !!s.mine;
        return `<button type="button" class="react${on ? " on" : ""}${s.count ? "" : " zero"}" data-react="${r.kind}" data-target="${esc(targetId)}" data-type="${targetType}" aria-pressed="${on}" aria-label="${r.label} ${s.count}개${on ? " (내가 누름)" : ""}"><span class="react-emoji" aria-hidden="true">${r.emoji}</span>${s.count ? `<span class="react-count">${s.count}</span>` : ""}</button>`;
      })
      .join("")}${picking === targetId ? "" : `<button type="button" class="react add" data-pick="${esc(targetId)}" aria-label="반응 남기기">＋</button>`}</div>`;
  }
  // 반응 누르기/취소: 내가 이미 눌렀으면 지우고, 아니면 새로 저장해요.
  async function toggleReaction(targetId, kind) {
    picking = null;
    const sum = reactionSummary(targetId);
    const mineItem = sum[kind] && sum[kind].mine;
    reactionNote = "";
    if (!sdk) {
      // 데모: 메모리 안에서만 바뀌어요
      if (mineItem) demo.reactions = demo.reactions.filter((r) => r.id !== mineItem.id);
      else demo.reactions.push({ id: "r" + Date.now() + kind, data: { targetId, kind }, author: { displayName: "나 (데모)" }, mine: true, canDelete: true, createdAt: new Date().toISOString() });
      reactions = open ? demo.reactions.filter((r) => [open.id, ...comments.map((c) => c.id)].includes(r.data.targetId)) : demo.reactions.filter((r) => posts.some((p) => p.id === r.data.targetId));
      return;
    }
    try {
      // 화면에 없는 내 반응이 서버에 있을 수 있어요 — 누르기 전에 이 글의 반응을 다시 확인해요.
      const current = await fetchReactionsFor(targetId);
      reactions = reactions.filter((r) => r.data.targetId !== targetId).concat(current);
      const mineNow = current.find((r) => r.mine && r.data.kind === kind) || mineItem;
      if (mineNow) {
        await sdk.db.remove("reactions", mineNow.id, SHARED);
        reactions = reactions.filter((r) => r.id !== mineNow.id);
      } else {
        const saved = await sdk.db.save("reactions", { targetId, kind }, SHARED);
        reactions.push(saved);
        user = await sdk.user(); // 저장하면서 로그인했을 수 있어요
      }
    } catch (error) {
      reactionNote = error && error.code === "login_required" ? "로그인해야 반응을 남길 수 있어요." : `반응을 남기지 못했어요: ${error && error.message ? error.message : "알 수 없는 오류"}`;
    }
  }

  // ---------- 실제 AI (CTRL+AI 기능 상자)
  // 스위치는 하나 — 앱 위쪽 CTRL+AI 줄의 스위치예요. 앱은 그것(`ctrlai.ai.mode()`, "ctrlai:ai-mode")만
  // 따라가요. 켜져 있을 때만 AI 버튼이 보이고, 누를 때만 Claude를 불러요(누른 사람의 지원금에서).
  const live = { on: false, prices: {}, busy: "", summary: null };
  const threadText = (post, list) =>
    `분류: ${post.data.category}\n제목: ${post.data.title}\n내용: ${String(post.data.body).slice(0, 1200)}` +
    (list.length ? `\n댓글:\n${list.slice(-30).map((c) => `- ${nameOf(c)}: ${String(c.data.body).slice(0, 200)}`).join("\n")}` : "");
  function draftOptions(post) {
    return {
      system: "동아리 게시판의 질문 글에 달 댓글 초안을 써요. 한국어로 3~5문장, 친절하고 구체적으로. 모르는 건 지어내지 말고 '확인이 필요해요'라고 써요.",
      prompt: threadText(post, []),
      maxTokens: 400,
    };
  }
  function summaryOptions(post, list) {
    return {
      system: "게시판 글과 댓글을 한국어 세 줄로 요약해요. 각 줄은 '- '로 시작하고, 정해진 것·남은 질문이 있으면 꼭 넣어요.",
      prompt: threadText(post, list),
      maxTokens: 300,
    };
  }
  function priceText(key, options) {
    const known = live.prices[key];
    if (known === undefined) {
      live.prices[key] = null;
      sdk.ai.estimate(options).then(
        (figures) => {
          live.prices[key] = figures;
          const el = $(`price-${key}`);
          if (el) el.textContent = priceText(key, options);
        },
        () => (live.prices[key] = false),
      );
      return "…";
    }
    return known ? `약 ${known.typicalKrw}원` : "";
  }
  function aiToolsHtml(post) {
    if (!(live.on && sdk)) return "";
    const buttons = [];
    if (post.data.category === "질문")
      buttons.push(`<button type="button" class="ghost small aiBtn" data-ai="draft" ${live.busy ? "disabled" : ""}>${live.busy === "draft" ? "쓰는 중…" : "✦ AI 답변 초안"} <small id="price-draft">${priceText("draft", draftOptions(post))}</small></button>`);
    if (comments.length >= 3)
      buttons.push(`<button type="button" class="ghost small aiBtn" data-ai="summary" ${live.busy ? "disabled" : ""}>${live.busy === "summary" ? "요약하는 중…" : "✦ AI 3줄 요약"} <small id="price-summary">${priceText("summary", summaryOptions(post, comments))}</small></button>`);
    const summary = live.summary && live.summary.postId === post.id
      ? `<div class="summary"><p class="meta">AI 요약 · 실제 AI · ${live.summary.krw}원</p><p>${esc(live.summary.text)}</p></div>`
      : "";
    return buttons.length || summary ? `<div class="ai-tools">${buttons.join("")}${summary}</div>` : "";
  }
  async function runAi(kind) {
    const post = open;
    live.busy = kind;
    renderDetail();
    let note = "";
    try {
      if (kind === "draft") {
        const result = await sdk.ai.ask(draftOptions(post));
        live.busy = "";
        if (open !== post) return; // 그사이 다른 화면으로 갔어요
        renderDetail();
        $("comment-body").value = result.text.trim();
        $("comment-body").focus();
        note = `AI가 초안을 썼어요 (실제 AI · ${result.chargedKrw}원). 다듬어서 보내세요.`;
      } else {
        const result = await sdk.ai.ask(summaryOptions(post, comments));
        live.summary = { postId: post.id, text: result.text.trim(), krw: result.chargedKrw };
      }
    } catch (error) {
      // 만든 사람이 '데모만'으로 두었거나 스위치가 꺼진 직후면 "demo"로 거절돼요 (0원).
      note = error && error.code === "demo" ? "지금은 데모예요 — AI 없이 써 주세요." : error && error.code === "login_required" ? "로그인해야 AI를 쓸 수 있어요." : "AI가 답하지 못했어요. 잠시 뒤 다시 해 보세요.";
    }
    live.busy = "";
    if (open !== post) return; // 그사이 다른 화면으로 갔어요
    const draft = $("comment-body") ? $("comment-body").value : "";
    renderDetail();
    if (draft) $("comment-body").value = draft;
    if (note) $("post-msg").textContent = note;
  }
  window.addEventListener("ctrlai:ai-mode", (event) => {
    const on = Boolean(sdk && event.detail && event.detail.mode === "live");
    if (on === live.on) return;
    live.on = on;
    if (open) renderDetail();
  });

  // ---------- 화면
  function notice() {
    if (!sdk) {
      $("notice-text").textContent = "CTRL+AI 안에서 열면 회원들의 글이 진짜로 모여요. 지금은 데모예요.";
      $("login-button").hidden = true;
      $("notice").hidden = false;
    } else if (!user) {
      $("notice-text").textContent = "읽기는 누구나. 글·댓글·반응은 CTRL+AI 회원만 남길 수 있어요.";
      $("login-button").hidden = false;
      $("notice").hidden = false;
    } else {
      $("notice").hidden = true;
    }
  }

  // 날짜 구분선 — 오늘 · 어제 · 10월 19일 (금)
  const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
  function dayLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const today = new Date();
    const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (diff === 0) return "오늘";
    if (diff === 1) return "어제";
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`;
  }
  const preview = (text) => {
    const line = String(text || "").replace(/\s+/g, " ").trim();
    return line.length > 60 ? `${line.slice(0, 60)}…` : line;
  };

  // 글 목록: 채팅방처럼 프로필 + 말풍선(제목 · 본문 첫 줄) + 아래에 이름 · 댓글 수 · 반응. 내 글은 오른쪽.
  function renderList() {
    $("detail").hidden = true;
    const list = $("list");
    list.hidden = false;
    const note = reactionNote ? `<p class="error react-note" role="alert">${esc(reactionNote)}</p>` : "";
    const pill = fresh ? `<button type="button" class="fresh" data-refresh>새 글 ${fresh}개 ↑</button>` : "";
    let lastDay = "";
    list.innerHTML = pill + note + (posts.length
      ? posts
          .map((p) => {
            const name = nameOf(p);
            const mineCls = p.mine ? " me" : "";
            const hasImg = !!safeImage(p.data.image);
            const day = dayLabel(p.createdAt);
            const divider = day !== lastDay ? `<p class="day-chip">${esc(day)}</p>` : "";
            lastDay = day;
            const isNew = !p.mine && lastSeen && p.createdAt > lastSeen;
            const count = commentCounts[p.id] || 0;
            return `${divider}<div class="msg${mineCls}">
              ${p.mine ? "" : avatar(name)}
              <div class="msg-main">
                ${p.mine ? "" : idLine(name)}
                <div class="msg-row">
                  <button type="button" class="post bubble${mineCls}" data-open="${esc(p.id)}">
                    <span class="post-head"><span class="cat${p.data.category === "공지" ? " notice" : ""}">${esc(p.data.category)}</span>
                    <span class="post-title">${esc(p.data.title)}</span>${hasImg ? ' <span class="photo-tag" aria-label="사진 있음">🖼</span>' : ""}</span>
                    <span class="post-preview">${esc(preview(p.data.body))}</span>
                  </button>
                  <span class="side">${isNew ? '<span class="new" aria-label="새 글">N</span>' : ""}<span class="time">${when(p.createdAt).split(" ")[1] || ""}</span>${count ? `<span class="count" aria-label="댓글 ${count}개">💬 ${count}</span>` : ""}</span>
                </div>
                ${reactionBar(p.id, "post")}
              </div>
            </div>`;
          })
          .join("")
      : `<p class="empty">아직 글이 없어요. 오른쪽 위 「글쓰기」로 첫 글을 남겨 보세요.</p>`);
  }

  // 15초마다 새 글이 있는지 봐요 (목록을 보고 있고, 탭이 보일 때만).
  async function checkFresh() {
    if (!sdk || open || document.hidden || !$("editor").hidden) return;
    try {
      const options = { ...SHARED, limit: 50 };
      if (category) options.where = { category };
      const latest = (await sdk.db.list("posts", options)).items;
      if (open || !$("editor").hidden) return; // 기다리는 동안 글을 열었으면 그대로 둬요
      const known = new Set(posts.map((p) => p.id));
      const count = latest.filter((p) => !known.has(p.id) && !p.mine).length;
      if (count !== fresh) {
        fresh = count;
        renderList();
      }
    } catch (error) {
      /* 다음에 다시 봐요 */
    }
  }
  setInterval(checkFresh, 15000);
  function markSeen() {
    const newest = posts.reduce((max, p) => (p.createdAt > max ? p.createdAt : max), lastSeen || "");
    store.set(SEEN_KEY, newest).catch(() => {
      /* 저장소가 막혀 있어도 게시판은 써요 */
    });
  }

  function commentHtml(c) {
    const name = nameOf(c);
    const mineCls = c.mine ? " me" : "";
    const tools = [];
    if (c.mine || c.canDelete) tools.push(`<button type="button" class="ghost small danger" data-remove-comment="${esc(c.id)}">삭제</button>`);
    if (!c.mine && sdk) tools.push(`<button type="button" class="ghost small" data-report-comment="${esc(c.id)}">신고</button>`);
    return `<li class="msg${mineCls}" data-comment="${esc(c.id)}">
      ${c.mine ? "" : avatar(name)}
      <div class="msg-main">
        ${c.mine ? "" : idLine(name)}
        <div class="msg-row">
          <p class="bubble body${mineCls}">${esc(c.data.body)}</p>
          <span class="time">${when(c.createdAt)}</span>
        </div>
        ${reactionBar(c.id, "comment")}
        ${tools.length ? `<div class="tools">${tools.join("")}</div>` : ""}
      </div>
    </li>`;
  }

  function renderDetail() {
    const p = open;
    $("list").hidden = true;
    const detail = $("detail");
    detail.hidden = false;
    const name = nameOf(p);
    const mineCls = p.mine ? " me" : "";
    const img = safeImage(p.data.image);
    const actions = [];
    if (p.mine) actions.push(`<button type="button" class="ghost small" data-edit>고치기</button>`);
    if (p.mine || p.canDelete) actions.push(`<button type="button" class="ghost small danger" data-remove-post>삭제</button>`);
    if (!p.mine && sdk) actions.push(`<button type="button" class="ghost small" data-report-post>신고</button>`);
    detail.innerHTML = `
      <button type="button" class="ghost small back" data-back>← 목록</button>
      <p class="day-chip">${esc(when(p.createdAt))}</p>
      <div class="msg${mineCls}">
        ${p.mine ? "" : avatar(name)}
        <div class="msg-main">
          ${p.mine ? "" : idLine(name)}
          <div class="msg-row">
            <div class="bubble post-bubble${mineCls}">
              <p class="meta"><span class="cat${p.data.category === "공지" ? " notice" : ""}">${esc(p.data.category)}</span></p>
              <h2>${esc(p.data.title)}</h2>
              <div class="body">${esc(p.data.body)}</div>
              ${img ? `<img class="post-image" src="${img}" alt="글에 첨부된 사진">` : ""}
            </div>
          </div>
          ${reactionBar(p.id, "post")}
          <div class="actions">${actions.join("")}</div>
        </div>
      </div>
      <div id="post-report" class="report-form" hidden><input type="text" maxlength="200" placeholder="신고 이유"><button type="button" class="small" data-report-send="posts">보내기</button></div>
      <p class="ok" id="post-msg" aria-live="polite"></p>
      ${reactionNote ? `<p class="error react-note" role="alert">${esc(reactionNote)}</p>` : ""}
      ${aiToolsHtml(p)}
      <p class="day-chip">댓글 ${comments.length}</p>
      <ul class="comments">${comments.map(commentHtml).join("")}</ul>
      <form class="comment-form" id="comment-form">
        <label class="visually-hidden" for="comment-body">댓글</label>
        <textarea id="comment-body" rows="1" maxlength="500" required placeholder="${sdk && !user ? "로그인하면 댓글을 쓸 수 있어요" : "댓글을 입력하세요"}"></textarea>
        <button type="submit" class="send" aria-label="댓글 보내기">전송</button>
        <p class="error" id="comment-error" role="alert" hidden></p>
      </form>`;
  }

  async function openPost(post) {
    open = post;
    reactionNote = "";
    picking = null;
    await loadComments(post);
    await loadReactionsForOpen();
    renderDetail();
  }
  async function backToList() {
    open = null;
    reactionNote = "";
    await loadPosts();
    await loadReactionsForPosts();
    fresh = 0;
    picking = null;
    notice(); // 저장하면서 로그인했을 수 있어요
    renderList();
    markSeen();
  }

  function openEditor(post) {
    editing = post || null;
    $("editor-title").textContent = post ? "글 고치기" : "새 글";
    $("category").value = post ? post.data.category : "자유";
    $("title").value = post ? post.data.title : "";
    $("body").value = post ? post.data.body : "";
    $("editor-save").textContent = post ? "저장" : "올리기";
    $("editor-error").hidden = true;
    pickedImage = post ? safeImage(post.data.image) : ""; // 고칠 때는 원래 사진이 먼저 보여요
    $("image-input").value = "";
    photoError("");
    renderPhotoField();
    $("editor").hidden = false;
    $("title").focus();
  }

  // ---------- 이벤트
  $("tabs").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-cat]");
    if (!button) return;
    category = button.dataset.cat;
    [...$("tabs").children].forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    await backToList();
  });
  $("write-toggle").addEventListener("click", () => openEditor(null));
  $("editor-cancel").addEventListener("click", () => { $("editor").hidden = true; editing = null; pickedImage = ""; });

  // 사진 고르기 · 빼기 (한 번에 1장만 — 새로 고르면 교체돼요)
  $("image-choose").addEventListener("click", () => $("image-input").click());
  $("image-input").addEventListener("change", async () => {
    const file = $("image-input").files && $("image-input").files[0];
    $("image-input").value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { photoError("사진 파일만 올릴 수 있어요."); return; }
    photoError("");
    $("image-choose").disabled = true;
    try {
      pickedImage = await shrinkImage(file);
      renderPhotoField();
    } catch (error) {
      photoError(error.message === "too_big" ? "사진이 너무 커서 줄이지 못했어요. 다른 사진을 골라 주세요." : "사진을 읽지 못했어요. 다른 사진을 골라 주세요.");
    }
    $("image-choose").disabled = false;
  });
  $("image-remove").addEventListener("click", () => {
    pickedImage = "";
    photoError("");
    renderPhotoField();
  });

  $("editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = { category: CATEGORIES.includes($("category").value) ? $("category").value : "자유", title: $("title").value.trim(), body: $("body").value.trim(), image: pickedImage || "" };
    if (!data.title || !data.body) return;
    $("editor-save").disabled = true;
    try {
      const wasEditing = editing;
      await savePost(data);
      $("editor").hidden = true;
      editing = null;
      pickedImage = "";
      if (wasEditing && open) { // 보던 글을 고쳤으면 그 글로 돌아가요
        if (sdk) { try { open = await sdk.db.get("posts", open.id, SHARED); } catch (e) { /* 그대로 */ } }
        await loadComments(open);
        await loadReactionsForOpen();
        renderDetail();
      } else {
        await backToList();
      }
    } catch (error) {
      $("editor-error").textContent = error && error.code === "login_required" ? "로그인해야 글을 쓸 수 있어요." : `저장하지 못했어요: ${error.message}`;
      $("editor-error").hidden = false;
    }
    $("editor-save").disabled = false;
  });

  // 목록: 반응 버튼이면 반응, 아니면 글 열기
  $("list").addEventListener("click", async (event) => {
    if (event.target.closest("button[data-refresh]")) return backToList();
    const pick = event.target.closest("button[data-pick]");
    if (pick) {
      picking = pick.dataset.pick;
      renderList();
      return;
    }
    const react = event.target.closest("button[data-react]");
    if (react) {
      await toggleReaction(react.dataset.target, react.dataset.react);
      renderList();
      return;
    }
    const button = event.target.closest("button[data-open]");
    const post = button && posts.find((p) => p.id === button.dataset.open);
    if (post) openPost(post).catch(() => {});
  });

  $("detail").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.ai) return runAi(button.dataset.ai);
    if (button.dataset.pick) {
      const draft = $("comment-body") ? $("comment-body").value : "";
      picking = button.dataset.pick;
      renderDetail();
      if (draft) $("comment-body").value = draft;
      return;
    }
    if (button.dataset.react) {
      // 쓰던 댓글 글자는 그대로 두고 다시 그려요
      const draft = $("comment-body") ? $("comment-body").value : "";
      await toggleReaction(button.dataset.target, button.dataset.react);
      renderDetail();
      if (draft) $("comment-body").value = draft;
      return;
    }
    if (button.hasAttribute("data-back")) return backToList();
    if (button.hasAttribute("data-edit")) return openEditor(open);
    if (button.hasAttribute("data-report-post")) { $("post-report").hidden = !$("post-report").hidden; return; }
    if (button.dataset.reportSend) {
      const input = button.previousElementSibling;
      const reason = input.value.trim();
      if (!reason) return;
      try { await report("posts", open.id, reason); $("post-msg").textContent = "신고했어요. 운영진이 확인해요."; $("post-report").hidden = true; }
      catch (error) { $("post-msg").textContent = `신고하지 못했어요: ${error.message}`; }
      return;
    }
    if (button.dataset.reportComment) {
      const reason = "댓글 신고"; // 댓글은 이유 없이 바로 신고해요.
      try { await report("comments", button.dataset.reportComment, reason); button.textContent = "신고했어요"; button.disabled = true; } catch (error) { button.textContent = "실패"; }
      return;
    }
    // 삭제는 두 번 눌러야 해요 (alert·confirm 대신).
    if (button.hasAttribute("data-remove-post") || button.dataset.removeComment) {
      if (!button.dataset.armed) {
        button.dataset.armed = "1";
        button.textContent = "정말 삭제할까요?";
        setTimeout(() => { delete button.dataset.armed; button.textContent = "삭제"; }, 2500);
        return;
      }
      try {
        if (button.dataset.removeComment) {
          await removeComment(comments.find((c) => c.id === button.dataset.removeComment));
          await loadComments(open);
          await loadReactionsForOpen();
          renderDetail();
        } else {
          await removePost(open);
          await backToList();
        }
      } catch (error) { button.textContent = "삭제 실패"; }
    }
  });
  $("detail").addEventListener("submit", async (event) => {
    if (event.target.id !== "comment-form") return;
    event.preventDefault();
    const body = $("comment-body").value.trim();
    if (!body) return;
    try {
      await saveComment(open, body);
      await loadComments(open);
      await loadReactionsForOpen();
      notice(); // 저장하면서 로그인했을 수 있어요
      renderDetail();
    } catch (error) {
      $("comment-error").textContent = error && error.code === "login_required" ? "로그인해야 댓글을 쓸 수 있어요." : `달지 못했어요: ${error.message}`;
      $("comment-error").hidden = false;
    }
  });
  $("login-button").addEventListener("click", async () => {
    try { user = await sdk.login(); } catch (error) { return; }
    notice();
    if (open) {
      await loadComments(open);
      await loadReactionsForOpen();
      renderDetail();
    } else {
      await loadPosts();
      await loadReactionsForPosts();
      renderList();
    }
  });

  // CTRL+AI 밖(파일만 연 경우)에서만: 데모 배지와 「데모 초기화」(예시 글로 돌아가요).
  if (sdk) {
    document.querySelector(".badge.demoAll").hidden = true;
    $("reset").hidden = true;
  } else {
    $("reset").addEventListener("click", () => location.reload());
  }

  // ---------- 시작
  (async () => {
    if (sdk) { try { user = await sdk.user(); } catch (error) { user = null; } }
    if (sdk && sdk.ai.mode) live.on = (await sdk.ai.mode().catch(() => "demo")) === "live";
    lastSeen = (await store.get(SEEN_KEY).catch(() => "")) || "";
    notice();
    try { await loadPosts(); await loadReactionsForPosts(); renderList(); markSeen(); } catch (error) { $("list").innerHTML = `<p class="empty">불러오지 못했어요. 잠시 뒤 새로 고쳐 주세요.</p>`; }
  })();
})();
