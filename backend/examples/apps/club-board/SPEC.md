# SPEC — 동아리 게시판

App 4 — 동아리 게시판 (owner, 2026-10-23: "카톡스럽게", improve the admin's board and keep it with the other showcases)

Context: member apps are static (apps.ctrlai.my: HTML/CSS/JS only) and keep shared data in CTRL+AI's ctrlai.db (posts, comments, reactions — declared in ctrlai.json). Built as one of the faithful STATIC DEMOS showcases: outside CTRL+AI it runs on example posts in memory.

## What it does

- KakaoTalk-style board: 공지 · 자유 · 질문 tabs, posts as chat bubbles (mine on the right), the title and the body's first line, date dividers (오늘 · 어제 · 10월 19일), comment counts, an N mark on posts newer than my last visit.
- New posts are checked every 15 seconds while the list is open → "새 글 N개 ↑".
- Comments in bubbles, a composer stuck to the bottom. Reactions 👍 ❤️ ✅ — only the used ones show, ＋ adds one.
- One small photo per post (the 4KB item limit makes it small; better photos wait for app files, app-platform P5).
- 실제 AI (the visitor's wallet, only when pressed): 「✦ AI 답변 초안」 on 질문 posts fills the comment box to edit; 「✦ AI 3줄 요약」 on posts with 3+ comments.
- Anyone reads; members write, edit their own, delete their own, report others'.
