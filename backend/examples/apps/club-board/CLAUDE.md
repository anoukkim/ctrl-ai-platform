# CLAUDE.md — 동아리 게시판

Claude Code가 이 프로젝트에서 일을 시작할 때 읽는 안내예요. 만든 사람은 코딩을 잘 모르는 초보자예요 — 쉬운 한국어로 설명하고, 바꾸기 전에 무엇을 왜 바꿀지 먼저 짧게 말해 주세요.

## 구조

- `js/app.js` 하나. 데이터는 CTRL+AI 기능 상자의 공유 목록 `posts`(category · title · body · image), `comments`(postId · body), `reactions`(targetId · kind) — `ctrlai.json`에 적혀 있어요. 목록은 `{ shared: true }`로 읽고 써요.
- **목록**(`renderList`): 날짜 구분선(`dayLabel`), 말풍선(제목 + 본문 첫 줄 `preview`), 댓글 수(`commentCounts`), N 표시(`lastSeen`보다 새 글). 반응과 댓글 수는 최근 100개씩 **한 번에** 불러와 나눠요(`loadReactionsForPosts`) — 글마다 따로 묻지 않아요.
- **새 글 확인**(`checkFresh`): 목록을 보고 탭이 보일 때 15초마다 → "새 글 N개 ↑".
- **반응**(`reactionBar`): 누군가 누른 것만 보이고, ＋(`picking`)로 골라요. 다시 누르면 취소.
- **실제 AI**: 스위치는 CTRL+AI 줄의 것 하나(`ctrlai.ai.mode()`, `ctrlai:ai-mode`). 켜져 있을 때만 `aiToolsHtml`이 「✦ AI 답변 초안」(질문 글)·「✦ AI 3줄 요약」(댓글 3개 이상)을 보여 주고, 가격은 `ctrlai.ai.estimate`로 먼저. 누르면 `runAi` → `ctrlai.ai.ask`. 거절 코드 `demo`(데모)·`login_required`는 안내만.
- **지난번에 본 때**는 `ctrlai.storage`(밖에서는 `localStorage`)에 저장해요(`SEEN_KEY`).
- 삭제는 두 번 눌러야 해요(확인창 대신). 사람이 쓴 글은 꼭 `esc()`.

## CTRL+AI 밖에서는

`window.ctrlai`가 없어요 — 메모리 안의 예시 글(`demo`)로 돌아가는 데모이고, 「데모 초기화」는 새로 고침이에요. 진짜로 쓰려면 서버와 데이터베이스(예: FastAPI + PostgreSQL)에 posts·comments·reactions 표를 만들고 `sdk.db.*` 부분을 그 서버 호출로 바꿔요. AI는 서버에서 Claude API로(키는 브라우저에 두지 마세요).

## 확인

- 목록: 날짜 구분선, 본문 첫 줄, 💬 수, 새 글 N
- 다른 창에서 글을 쓰면 15초 안에 "새 글 1개 ↑"
- 반응 ＋ → 고르기 → 다시 누르면 취소
- 질문 글에서 「✦ AI 답변 초안」 → 댓글 칸이 채워짐 (실제 AI 켜졌을 때)
- 폭 390px 화면, 댓글 입력창이 아래에 붙어 있는지
