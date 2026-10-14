# 영수증 가계부 — 원래 기획 (SPEC)

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

App 1 — 영수증 가계부
- 12 fake receipt images (generated SVG, fictional shop names, "샘플" watermark) + 3 months of seed data: one month heavy on 카페, one with a 쇼핑 spike.
- Upload: drag-and-drop or pick; in the demo, an uploaded image is shown and the "extraction" uses a pre-generated result (the 12 samples map to exact results; any other image → an editable empty form with a note "AI 연결 후 자동 추출돼요"). Step: review/edit 상호·날짜·품목별 금액·합계·카테고리 → 저장.
- Categories 식비/카페/교통/쇼핑/생활/의료/문화/기타, auto (pre-generated) + manual change.
- Monthly budget per category; 80% → 주의 badge, 100%+ → 경고 badge.
- "이번 달 소비 패턴" comment: pre-generated per seeded month (전월 대비 증감, 눈에 띄는 카테고리, 절약 제안).
- Dashboard: category donut, daily line, 전월 대비 cards, budget bars. List: search, month/category filters, detail view, CSV export (UTF-8 BOM).
