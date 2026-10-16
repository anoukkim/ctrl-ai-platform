// 동아리 게시판 — 공지·자유·질문 글과 댓글. 글은 CTRL+AI 기능 상자의 공유 목록
// (ctrlai.db: posts, comments — ctrlai.json에 적혀 있어요)에 있어요.
// 누구나 읽고, 로그인한 회원이 쓰고, 쓴 사람이 고치고, 이상한 글은 신고해요.
(function () {
  "use strict";

  const sdk = window.ctrlai && window.ctrlai.connected ? window.ctrlai : null;
  const SHARED = { shared: true };
  const CATEGORIES = ["공지", "자유", "질문"];

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  let user = null;
  let category = ""; // "" = 전체
  let posts = [];
  let open = null; // 보고 있는 글
  let comments = [];
  let editing = null; // 고치는 중인 글

  // CTRL+AI 밖(데모): 메모리 안의 예시 글.
  const demo = {
    posts: [
      { id: "p1", data: { category: "공지", title: "이번 주 모임은 목요일 7시 (데모)", body: "동아리방에서 만나요. 노트북 챙겨 오세요!" }, author: { displayName: "예시 운영진" }, mine: false, canDelete: false, createdAt: new Date().toISOString() },
      { id: "p2", data: { category: "질문", title: "Builder에서 색 바꾸는 법? (데모)", body: "\"색 바꿔 줘\"라고 말하면 돼요." }, author: { displayName: "예시 회원" }, mine: false, canDelete: false, createdAt: new Date().toISOString() },
    ],
    comments: { p2: [{ id: "c1", data: { postId: "p2", body: "저도 궁금했어요!" }, author: { displayName: "예시 회원 2" }, mine: false, canDelete: false, createdAt: new Date().toISOString() }] },
  };

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
  async function savePost(data) {
    if (!sdk) {
      if (editing) Object.assign(editing.data, data);
      else demo.posts.unshift({ id: "p" + Date.now(), data, author: { displayName: "나 (데모)" }, mine: true, canDelete: true, createdAt: new Date().toISOString() });
      return;
    }
    if (editing) await sdk.db.update("posts", editing.id, data, SHARED);
    else await sdk.db.save("posts", data, SHARED);
    user = await sdk.user();
  }
  async function removePost(post) {
    if (!sdk) { demo.posts = demo.posts.filter((p) => p !== post); delete demo.comments[post.id]; return; }
    // 댓글도 같이 지워요 — 내가 지울 수 있는 것만(내 댓글, 앱 주인이면 전부). 남의 댓글은
    // 그 사람 것이라 남고, 운영진이 Admin › Content에서 정리할 수 있어요.
    const page = await sdk.db.list("comments", { ...SHARED, where: { postId: post.id }, limit: 100 });
    for (const comment of page.items) {
      if (comment.mine || comment.canDelete) await sdk.db.remove("comments", comment.id, SHARED);
    }
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
    if (!sdk) { demo.comments[open.id] = (demo.comments[open.id] || []).filter((c) => c !== comment); return; }
    await sdk.db.remove("comments", comment.id, SHARED);
  }
  async function report(list, id, reason) {
    if (!sdk) return;
    await sdk.db.report(list, id, reason);
  }

  // ---------- 화면
  function notice() {
    if (!sdk) {
      $("notice-text").textContent = "CTRL+AI 안에서 열면 회원들의 글이 진짜로 모여요. 지금은 데모예요.";
      $("login-button").hidden = true;
      $("notice").hidden = false;
    } else if (!user) {
      $("notice-text").textContent = "읽기는 누구나. 글과 댓글은 CTRL+AI 회원만 쓸 수 있어요.";
      $("login-button").hidden = false;
      $("notice").hidden = false;
    } else {
      $("notice").hidden = true;
    }
  }

  function renderList() {
    $("detail").hidden = true;
    const list = $("list");
    list.hidden = false;
    list.innerHTML = posts.length
      ? posts
          .map(
            (p) => `<button type="button" class="post" data-open="${esc(p.id)}">
              <p class="post-title"><span class="cat${p.data.category === "공지" ? " notice" : ""}">${esc(p.data.category)}</span>${esc(p.data.title)}</p>
              <p class="meta">${esc(p.author ? p.author.displayName : "")} · ${when(p.createdAt)}${sdk ? "" : ' · <span class="demo-tag">데모</span>'}</p>
            </button>`,
          )
          .join("")
      : `<p class="empty">아직 글이 없어요. 첫 글을 써 보세요.</p>`;
  }

  function renderDetail() {
    const p = open;
    $("list").hidden = true;
    const detail = $("detail");
    detail.hidden = false;
    const actions = [];
    if (p.mine) actions.push(`<button type="button" class="ghost small" data-edit>고치기</button>`);
    if (p.mine || p.canDelete) actions.push(`<button type="button" class="ghost small danger" data-remove-post>삭제</button>`);
    if (!p.mine && sdk) actions.push(`<button type="button" class="ghost small" data-report-post>신고</button>`);
    detail.innerHTML = `
      <button type="button" class="ghost small back" data-back>← 목록</button>
      <p class="meta"><span class="cat">${esc(p.data.category)}</span></p>
      <h2>${esc(p.data.title)}</h2>
      <p class="meta">${esc(p.author ? p.author.displayName : "")} · ${when(p.createdAt)}</p>
      <div class="body">${esc(p.data.body)}</div>
      <div class="actions">${actions.join("")}</div>
      <div id="post-report" class="report-form" hidden><input type="text" maxlength="200" placeholder="신고 이유"><button type="button" class="small" data-report-send="posts">보내기</button></div>
      <p class="ok" id="post-msg" aria-live="polite"></p>
      <h3>댓글 ${comments.length}</h3>
      <ul class="comments">${comments
        .map(
          (c) => `<li data-comment="${esc(c.id)}">
            <p class="body">${esc(c.data.body)}</p>
            <p class="meta">${esc(c.author ? c.author.displayName : "")} · ${when(c.createdAt)}
              ${c.mine || c.canDelete ? `<button type="button" class="ghost small danger" data-remove-comment="${esc(c.id)}">삭제</button>` : ""}
              ${!c.mine && sdk ? `<button type="button" class="ghost small" data-report-comment="${esc(c.id)}">신고</button>` : ""}
            </p>
          </li>`,
        )
        .join("")}</ul>
      <form class="comment-form" id="comment-form">
        <label class="meta" for="comment-body">댓글 쓰기</label>
        <textarea id="comment-body" rows="2" maxlength="500" required placeholder="${sdk && !user ? "로그인하면 댓글을 쓸 수 있어요" : "댓글"}"></textarea>
        <div class="row"><button type="submit" class="small">댓글 달기</button></div>
        <p class="error" id="comment-error" role="alert" hidden></p>
      </form>`;
  }

  async function openPost(post) {
    open = post;
    await loadComments(post);
    renderDetail();
  }
  async function backToList() {
    open = null;
    await loadPosts();
    notice(); // 저장하면서 로그인했을 수 있어요
    renderList();
  }

  function openEditor(post) {
    editing = post || null;
    $("editor-title").textContent = post ? "글 고치기" : "새 글";
    $("category").value = post ? post.data.category : "자유";
    $("title").value = post ? post.data.title : "";
    $("body").value = post ? post.data.body : "";
    $("editor-save").textContent = post ? "저장" : "올리기";
    $("editor-error").hidden = true;
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
  $("editor-cancel").addEventListener("click", () => { $("editor").hidden = true; editing = null; });
  $("editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = { category: CATEGORIES.includes($("category").value) ? $("category").value : "자유", title: $("title").value.trim(), body: $("body").value.trim() };
    if (!data.title || !data.body) return;
    $("editor-save").disabled = true;
    try {
      await savePost(data);
      $("editor").hidden = true;
      editing = null;
      await backToList();
    } catch (error) {
      $("editor-error").textContent = error && error.code === "login_required" ? "로그인해야 글을 쓸 수 있어요." : `저장하지 못했어요: ${error.message}`;
      $("editor-error").hidden = false;
    }
    $("editor-save").disabled = false;
  });

  $("list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-open]");
    const post = button && posts.find((p) => p.id === button.dataset.open);
    if (post) openPost(post).catch(() => {});
  });

  $("detail").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
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
      const reason = "댓글 신고"; // 댓글은 이유 없이 바로 신고해요. 필요하면 글처럼 입력칸을 두세요.
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
    if (open) renderDetail();
  });

  // ---------- 시작
  (async () => {
    if (sdk) { try { user = await sdk.user(); } catch (error) { user = null; } }
    notice();
    try { await loadPosts(); renderList(); } catch (error) { $("list").innerHTML = `<p class="empty">불러오지 못했어요: ${esc(error.message)}</p>`; }
  })();
})();
