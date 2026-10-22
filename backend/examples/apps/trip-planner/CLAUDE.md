# CLAUDE.md — 여행 일정 메이커

Claude Code가 이 프로젝트에서 일을 시작할 때 읽는 안내예요.

## 이 앱은

서울·부산·제주 중 한 곳과 기간(당일~4박 5일), 인원(1~8명), 총예산, 취향을 고르면 날짜별 동선을 짜 주는 정적 웹앱이에요. 시간표·이동 시간·동선 지도(진짜 지도, 안 뜨면 SVG)·예산 도넛, 끌어서 순서 바꾸기, 문장으로 고치기 세 가지, 주소에 담는 공유 링크가 있어요. **CTRL+AI 안에서 위쪽 줄의 실제 AI 스위치가 켜져 있으면** 「AI로 일정 짜기」·「AI로 바꾸기」 버튼이 생겨 Claude가 일정을 짜고(`planWithAi`, 장소 id는 목록으로 검증, 맞지 않는 날은 데모 플래너가 채움) 문장도 알아들어요(`editWithAi`) — 그 사람의 지원금에서, 그 버튼을 눌렀을 때만, 가격은 먼저 보여 줘요. 로그인 전이거나 CTRL+AI 밖에서는 정해진 규칙의 **데모 플래너**가 짜요(화면에 "데모 플래너" 배지). 원래 기획은 `SPEC.md`.

만든 사람은 코딩을 잘 모르는 초보자예요. 설명은 쉬운 한국어로 해 주고, 파일을 바꾸기 전에 무엇을 왜 바꿀지 먼저 짧게 말해 주세요.

## 파일 구조

```text
index.html
style.css
js/
  places.js
  planner.js
  map.js
  app.js
SPEC.md
```

- `index.html` — 머리글, `#new-trip`·`#reset` 버튼, 빈 `<main id="main">`, 스크린리더용 `#status`, 스크립트 네 개.
- `style.css` — `:root` 색 변수(남색 + 산호색), 900px·560px 반응형, `prefers-reduced-motion`.
- `js/places.js` — 도시·장소 데이터와 `TRIP.SAMPLE_INPUT`(첫 화면 예시).
- `js/planner.js` — 일정 짜기·시간표·예산·바꾸기 규칙·공유 인코딩. 화면(DOM)은 건드리지 않아요.
- `js/map.js` — `T.esc`, `T.won`, `T.routeMap`(SVG 지도), `T.mountMap`(진짜 지도), `T.donut`(도넛), `T.BUDGET_COLORS`.
- `js/app.js` — 상태, 저장, 화면 그리기, 이벤트 연결.

## 구조

- **불러오는 순서**: `places.js` → `planner.js` → `map.js` → `app.js` (`<script src>`, 모듈·빌드 없음). 모두 전역 객체 하나 `window.TRIP`(파일 안에서는 `T`)에 붙어요. `T.esc`·`T.won`은 `map.js`에 있지만 `planner.js`도 실행 중에 쓰므로, `app.js`가 시작되기 전에 네 파일이 다 있어야 해요.
- **장소 데이터**: `TRIP.CITIES.서울/부산/제주`마다 `move`(이동 수단: 속도 km/h, 대기 분, 1인 요금, 제주는 `perKm` 기름값과 `perDay` 렌터카), `lodging`(알뜰·보통·좋음 1박 값), `outline`·`islands`·`water`(지도용 [위도, 경도] 목록), `places`. 장소 한 줄은 `[id, 이름, 취향, 실내?, 위도, 경도, 머무는 분, 1인 비용, 설명]`이고 `tripRow`가 객체로 바꿔요. id는 `s01`·`b01`·`j01`처럼 도시 머리글자 + 번호.
- **일정(trip) 모양**: `{ input: {city, days, budget, people, prefs}, lodging, rain, cheap, relaxed, days: [[장소 id, ...], ...], notes: [] }` (+ 하루 다시 만들기 횟수 `attempts`). 하루는 장소 id 배열일 뿐이고, 시각·이동·비용은 매번 `T.schedule`·`T.budget`이 다시 계산해요.
- **앱 상태**(`app.js`): `state = { trip, day, view: "form"|"result", form }`. 저장 안 하는 것: `undo`(바로 전 일정 JSON), `message`, `shareUrl`, `shared`(주소로 받은 일정).
- **데모 플래너**(`planner.js`): `T.plan(input)`이 날마다 `buildDay`를 불러요 — 점수(`score`: 취향 일치 3점·아니면 1점, 비 오는 날 실내 ±2, 알뜰 모드면 비용만큼 감점)가 높은 맛집 아닌 곳으로 시작해, "점수 × 10 − 이동 분 ÷ 3"이 가장 큰 곳을 하나씩 덧붙이는 욕심쟁이 방식. 하루 540분·5곳(여유 모드 420분·3곳), 맛집 최대 2곳, 쇼핑 최대 2곳. 그다음 `fitBudget`이 숙소 등급을 낮추고 가장 비싼 곳을 더 싼 곳으로 바꾸며 `notes`에 이유를 남겨요.
- **이동과 예산**: `T.leg`가 `T.haversine` 직선 거리 × 1.3(도로 우회)으로 시간을 5분 단위로 계산 — 1.2km 이하는 도보(4.5km/h), 아니면 도시의 이동 수단. `T.budget`은 숙박(박 수 × 2명당 방 1개) / 식비(맛집 비용 + 나머지 끼니 1인 `T.MEAL_ALLOWANCE` 10,000원) / 교통 / 체험 네 갈래.
- **진짜 지도**(`map.js` `T.mountMap`): `index.html`이 jsDelivr에서 Leaflet 1.9.4를 불러오고, 타일은 CTRL+AI가 대신 받아 주는 OpenStreetMap 타일(`/_ctrlai/tiles/{z}/{x}/{y}.png`, 키 없음, 출처 표시 — 앱 칸은 referrer를 못 보내서 OSM에 직접 요청하면 막혀요; CTRL+AI 밖에서는 타일이 없어 단순 지도). `.mapHolder` 안 SVG 지도 위에 겹쳐 그리고 첫 타일이 오면 보여요. 10초 안에 타일이 안 오거나 타일 오류가 4번이면 지워서 SVG 지도가 남아요. 번호 핀(`.livePin`), 점선 경로, 다른 날 흐린 점. 휠 확대는 끔(페이지 스크롤을 뺏지 않게), +/− 버튼으로. 그릴 때마다 이전 지도를 `remove()`. MapLibre는 sandbox(출처 없는 페이지) 안에서 타일을 못 불러와서 쓰지 않아요.
- **단순 지도**(`map.js` `T.routeMap`): 지도 타일 없이 SVG 문자열로 그려요. `projector`가 그날 장소들이 꽉 차게 위도·경도를 화면 좌표로 바꾸고(가로는 cos(위도)만큼 줄임, 최소 약 5km 범위), 도시 윤곽·한강 선 → 다른 날 장소(흐린 점) → 방문 순서 선 → 번호 표시를 그려요. 이름표는 오른쪽·왼쪽·위·아래 중 겹치지 않는 자리에, 자리가 없으면 번호만. 축척 막대와 북쪽 화살표 포함. 판 크기는 600×440, 폭 560px 미만이면 380×400(넘나들 때 다시 그림).
- **그리기**: `render()`가 `main.innerHTML`을 통째로 바꾸고 `bindForm()`/`bindResult()`가 이벤트를 다시 달아요. 일정을 바꾸는 동작은 모두 `change(fn, note)`를 거쳐요 — 되돌리기용 복사 → 바꾸기 → 저장 → 다시 그리기 → `say()`로 `#status`에 알림.

## 실제 AI (CTRL+AI 기능 상자) 와 밖에서의 AI 연결 자리

CTRL+AI 안에서는 `app.js` 맨 위의 `live` 상태가 앱 위쪽 CTRL+AI 줄의 스위치(`ctrlai.ai.mode()`, `ctrlai:ai-mode` 이벤트)를 그대로 따라가요 — 앱 안에 따로 토글을 두지 않아요. **무료가 기본**이에요: 「일정 만들기」와 「바꾸기」는 스위치와 상관없이 늘 정해진 규칙으로 돌아요(0원). 스위치가 켜져 있으면 그 옆에 가격이 붙은 **AI 버튼**(「AI로 일정 짜기」 → `planWithAi`, 「AI로 바꾸기」 → `editWithAi`, `.aiBtn`)이 생기고, 그걸 눌렀을 때만 Claude를 불러요(`PLAN_SCHEMA` · `EDIT_SCHEMA`, `ctrlai.ai.ask`). "하루 다시 만들기"는 여전히 데모 플래너예요. **CTRL+AI 밖에서 진짜로 연결할 때** 갈아 끼울 자리는 아래와 같아요.

- **일정 짜기**: `T.plan(input)`(처음 일정)과 `T.regenerateDay(trip, d)`(하루 다시 만들기)가 Claude 호출로 바뀔 자리예요. Claude에게 그 도시의 `places` 목록을 주고, 위의 trip 모양 그대로 `days`(장소 id 배열)를 돌려받으면 `T.schedule`·`T.budget`·`T.routeMap`은 그대로 쓸 수 있어요. 장소는 지금처럼 목록 안에서만 고르게 하세요.
- **문장으로 고치기**: `app.js`의 `edit(text)` → `T.intent(text)`가 정규식으로 `"rain"`·`"cheap"`·`"relax"` 중 하나를 찾고 `T.applyRain`(실외 → 가까운 실내 장소로 `swap`)·`T.applyCheap`(숙소 한 등급 내리고 15,000원 이상인 곳을 반값 이하로)·`T.applyRelax`(하루 3곳, 10:30 출발)를 불러요. 못 알아들으면 "규칙으로는 못 알아들어요 — 'AI로 바꾸기'를 눌러 보세요" 메시지(스위치가 꺼져 있으면 스위치를 켜라고 안내). Claude가 붙으면 `T.intent`와 세 규칙 대신 아무 문장이나 이해해 새 `days`를 돌려주게 해요.
- Claude API 키는 브라우저에 두면 안 돼요 — 진짜 호출은 서버를 거쳐야 해요(`SPEC.md`).

## 저장

- 고정 키 `KEY = "trip-planner-v1"`, 값은 `{trip, day, view, form}`.
- **`store` 갈래**: `window.ctrlai.connected`이면 `ctrlai.storage`(CTRL+AI 안, 앱 · 방문자별 약 1MB), 아니면 `get/set`(Promise)으로 감싼 `localStorage`(파일을 직접 열 때). `ctrlai`는 CTRL+AI가 넣는 SDK라 그 안에만 있어요. **안팎 모두에서 돌게 하는 갈래이니 지우지 마세요.**
- 비동기라 `load()`는 없어요. `fresh()`(예시 일정)로 시작해 맨 아래에서 `store.get(KEY)`가 끝나면 첫 `render()` — 도시가 `TRIP.CITIES`에 없으면 저장본을 버려요. `save()` 실패는 `.catch`로 삼켜요.
- 공유 링크: `#share=` + `T.encode(trip)` — `{i: input, l: lodging, r: rain, c: cheap, x: relaxed, d: days}` JSON을 UTF-8 → base64url(`+`→`-`, `/`→`_`, `=` 제거). `T.decode`는 모르는 도시·장소 id를 버리고 최대 7일·하루 8곳, 인원 1~8, 예산 0~1억으로 잘라요. 해시가 있으면 보기 전용, `hashchange`에 다시 그려요.

## 만들어진 조건 (CTRL+AI 안에서)

- 서버 없이 방문자의 브라우저에서만 도는 **정적 앱**: HTML · CSS · JavaScript만.
- **바깥 서비스는 https만**: Leaflet은 jsDelivr에서, 지도 타일은 CTRL+AI(`/_ctrlai/tiles`)에서 와요. 못 받으면 SVG 단순 지도가 남아요(썸네일을 찍는 서버는 jsDelivr를 막아서 단순 지도로 찍혀요). 도넛은 SVG로 직접 그려요. API 키는 코드에 넣지 마세요 — 누구나 볼 수 있어요.
- **크기 제한**: 파일 30개, 파일 하나 200KB, 전체 2MB, 폴더 깊이 3단계, 확장자 .css .html .js .json .md .svg .txt.
- `alert` · `confirm` 금지 — 데모 초기화는 버튼을 "정말 지울까요? 한 번 더"로 바꾸는 화면 안 확인(4초 뒤 원래대로).

**CTRL+AI 밖에서는 이 제한이 더 이상 적용되지 않아요.** 서버, 데이터베이스, npm 패키지, 외부 API, 진짜 지도 라이브러리를 써도 돼요. 다만 그렇게 바꾸면 CTRL+AI Builder에 다시 붙여 넣어 게시할 수는 없어요 — Builder는 위 조건의 정적 파일만 받아요. 그런 큰 변경 전에는 만든 사람에게 한 번 확인해 주세요.

## 코딩 관례 (지금 코드에서 쓰는 방식)

- 빌드·프레임워크·npm 없음. 파일마다 `(function () { const T = window.TRIP; ... })();`로 감싸요(`places.js`만 맨 위에서 데이터 정의).
- 화면은 템플릿 문자열로 HTML을 만들어 넣어요. 사람이 쓴 글이나 장소 이름은 꼭 `T.esc()`로, 금액은 `T.won()`으로("12,300원").
- 2칸 들여쓰기, 큰따옴표, 세미콜론, 여러 줄 인자 끝 쉼표. 주석과 화면 글은 한국어.
- 클래스는 camelCase(`dayTabs`, `stopCard`), id는 kebab-case(`new-trip`, `add-place`), 동작 버튼은 `data-up`·`data-down`·`data-remove`·`data-day`·`data-say`.
- 접근성: 끌기 대신 ↑ ↓ 버튼, 날짜 탭은 ← → 키, 바뀐 결과는 `say()`로 `#status`(aria-live)에 읽어 줘요. 이 방식을 지켜 주세요.

## 실행과 확인

```
python -m http.server 8000
```

그다음 http://localhost:8000 을 열어요. 자동 테스트는 없어요 — 바꾼 뒤 직접 눌러 보세요.

- 첫 화면에 부산 2박 3일 예시 일정, 지도 번호와 도넛이 맞게 나오는지
- 새 일정 만들기 → 제주로 짜면 교통에 렌터카 값이 붙는지, 취향을 다 끄면 오류 문구가 나오는지
- 카드 끌기와 ↑ ↓, ✕, 장소 추가, 하루 다시 만들기 뒤 시각·이동·예산이 다시 계산되는지
- "비 오는 날 버전으로"·"더 저렴하게"·"더 여유롭게"와 되돌리기, 다른 문장엔(데모) "위쪽 CTRL+AI 줄의 스위치를 켜면 알아들어요"
- 숙소 등급 바꾸기, 공유 링크 → 받는 사람 화면 미리 보기 → 내 일정으로 가져오기
- 새로 고침 뒤에도 일정이 남는지, 데모 초기화(두 번 누르기)
- 폭 390px 화면, 키보드만으로 조작

개발자 도구(F12) 콘솔에 빨간 오류가 없는지도 확인하세요.

## 기록

- `HISTORY.md` — 버전마다 무엇을 요청했는지 (이 앱이 어떻게 바뀌어 왔는지).
- `SPEC.md` — 원래 기획. 서버·데이터베이스·실제 AI가 붙은 버전의 설계도로 쓰세요.
