# 여행 일정 메이커 — 원래 기획 (SPEC)

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

App 2 — 여행 일정 메이커
- Input form: 목적지 (서울/부산/제주), 기간, 총예산, 인원, 취향 multi-select (맛집/자연/문화/쇼핑/휴식) → result screen.
- Seed: verified-looking place lists for 서울·부산·제주 (name, lat/lng, category, typical duration, cost); itineraries are built ONLY from these places by a deterministic local planner (scored by 취향, fits budget/time) — label "데모 플래너 · AI 연결 후 Claude가 생성".
- Day timeline (time, place, 이동 시간 from haversine + mode speed, cost); drag to reorder → travel times and budget recompute; add/remove place cards; 하루 다시 만들기.
- Natural-language edits: support "비 오는 날 버전으로", "더 저렴하게", "더 여유롭게" via local rules (indoor swap, cheaper picks, fewer stops); other text → "AI 연결 후 가능해요".
- Map: an SVG route map per day from lat/lng (simplified coastline/outline per city is fine) with numbered markers — no tiles.
- Budget donut (숙박/식비/교통/체험) + progress vs total. Share: read-only view via URL hash (no server). One sample itinerary preloaded.
