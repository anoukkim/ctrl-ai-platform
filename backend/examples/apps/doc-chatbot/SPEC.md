# 문서 챗봇 메이커 — 원래 기획 (SPEC)

이 앱은 CTRL+AI 운영자가 2026-10-15에 쓴 아래 기획으로 만든 **정적 데모**예요.
원래 기획은 FastAPI · PostgreSQL · Claude가 필요한 "진짜" 서비스이고, 지금의
앱은 그것을 HTML/CSS/JS만으로 충실히 흉내 낸 것입니다 — AI 결과는 미리 만들어
둔 데이터이고, 화면마다 "데모" 배지로 표시돼요.

이 파일을 자신의 Claude에게 주면, 이 기획대로 서버와 실제 AI가 붙은 버전을
만들어 달라고 할 수 있어요.

## 데모로 만들 때의 공통 조건 (운영자 원문)

H2 — feat-showcase-apps (replace the 3 example apps with 3 richer DEMO apps)
Context: member apps are static (apps.ctrlai.my: HTML/CSS/JS only, CSP connect-src 'self', img-src 'self' data:, no CDN, the existing size caps). The owner wants three showcase apps whose full specs are below; they would normally need FastAPI/Postgres/Claude, so build them as faithful STATIC DEMOS:
- All AI results are pre-generated JSON shipped with the app, clearly badged "데모 · AI 연결 전" wherever an AI result appears, plus a global "데모 데이터" badge. Never pretend a live AI call happened.
- Persistence in localStorage (wrapped in try/catch), with a "데모 초기화" button.
- Charts = hand-written SVG (no Recharts/Chart.js). No external network of any kind. Every file within the caps (check the actual limits in code; split JS into modules if needed). No alert/confirm (use inline confirm).
- Korean UI, dark theme, ₩ with thousands separators ("12,300원"), responsive down to 390px, keyboard accessible. Each app gets its OWN visual identity within dark (different accent, type scale, layout) — they must not look like one template.

## 이 앱의 기획 (운영자 원문)

App 3 — 문서 챗봇 메이커
- Two sample docs (동아리 회칙, 서비스 이용 안내) + 30 sample conversation logs. Upload .txt/.md (PDF → "AI 연결 후 지원"); auto-chunking.
- Bot settings: 이름, 말투(친근/공식), 환영 메시지, 못 찾을 때 문구.
- Q&A: in-browser BM25 over chunks (isolate retrieval behind one function so it can later be swapped), answer = the best-matching passage(s) quoted with source (문서명 · 단락/페이지), streamed character-by-character; below a score threshold → the "문서에서 찾을 수 없어요" text. Badge "데모 · 문서 문장을 그대로 보여 줘요 (AI 연결 후 Claude가 정리)".
- Embed: generate a one-line snippet (pointing at this app's widget page) + live widget preview in an iframe.
- 관리자 tab: log list/detail, topic stats chart (SVG), unanswered questions list, 👍/👎 totals.
