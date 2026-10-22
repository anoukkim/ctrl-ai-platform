# CLAUDE.md — 영수증 가계부

Claude Code가 이 프로젝트에서 일을 시작할 때 읽는 안내예요.

## 이 앱은

영수증 사진을 올리면 상호·날짜·품목별 금액·합계·카테고리를 읽어 가계부에 넣고, 카테고리별 예산(80% 주의 · 100% 경고), 도넛·일별 그래프, 이번 달 소비 패턴 글, 검색·필터·CSV 내보내기를 제공하는 앱이에요. **CTRL+AI 안에서 위쪽 줄의 실제 AI 스위치가 켜져 있으면** 「AI로 사진 읽기」·「분석 쓰기」 버튼으로 Claude가 사진을 읽고(`readWithAi`, `RECEIPT_SCHEMA`) 소비 패턴 글을 써요(`PATTERN_SCHEMA`) — 그 사람의 지원금에서, 그 버튼을 눌렀을 때만, 가격은 `ctrlai.ai.estimate`로 먼저 보여 줘요. 로그인 전이거나 CTRL+AI 밖에서는 **데모**: "AI 결과"는 미리 만들어 둔 데이터예요. 원래 기획은 `SPEC.md`에 있어요.

만든 사람은 코딩을 잘 모르는 초보자예요. 설명은 쉬운 한국어로 해 주고, 파일을 바꾸기 전에 무엇을 왜 바꿀지 먼저 짧게 말해 주세요.

## 파일 구조

```text
index.html
style.css
js/
  data.js
  charts.js
  app.js
SPEC.md
```

- `index.html` — 왼쪽 메뉴(탭 4개: `data-view`가 dashboard · list · add · budget), 데모 초기화 버튼 `#reset`, 화면이 그려지는 `<main id="main">`, 알림 `#toast`.
- `style.css` — 어두운 초록 테마. 860px 아래에서는 탭이 화면 아래 고정 막대로 바뀌어요.
- `js/data.js` — 데모 데이터와 날짜 도우미.
- `js/charts.js` — 손으로 그리는 SVG(샘플 영수증, 도넛, 선 그래프)와 `won` · `esc` 도우미.
- `js/app.js` — 화면 그리기, 이벤트, 저장. 앱의 동작은 거의 다 여기 있어요.
- `SPEC.md` — 원래 기획 (서버 · DB · Claude가 붙은 버전).

## 구조

- **불러오는 순서**: `index.html`이 `js/data.js` → `js/charts.js` → `js/app.js` 순서로 `<script src>`를 불러와요. 앞의 두 파일이 전역 객체 `window.LEDGER`를 채우고, `app.js`가 그것을 `L`로 받아 써요. 순서를 바꾸면 깨져요.
- **`LEDGER`에 있는 것**: `CATEGORIES`(8개: 식비 · 카페 · 교통 · 쇼핑 · 생활 · 의료 · 문화 · 기타), `CATEGORY_COLORS`, `DEFAULT_BUDGET`, `dateFor(monthOffset, day)`, `SAMPLES`(샘플 영수증 r01–r12), `extractionFor(sampleId)`, `seedTransactions()`, `PATTERN_NOTES` (data.js) / `won`, `esc`, `receiptSvg`, `receiptDataUrl`, `donut`, `lineChart` (charts.js).
- **`app.js`**는 즉시 실행 함수(IIFE) 하나라서 안의 함수와 변수는 밖에서 보이지 않아요.
- **저장되는 상태** `state = { transactions: [...], budget: { 식비: 350000, ... } }`. 내역 한 건은 `{ id, shop, date: "YYYY-MM-DD", items: [{ name, amount }], total, category, source, sampleId? }`이고, `source`는 `"seed"`(예시 내역) · `"sample"`(샘플 영수증) · `"user"`(직접 입력) 중 하나예요.
- **화면 상태**(저장 안 됨): `view`(지금 탭), `dashMonth`(대시보드 달), `filters`(`q` · `month` · `category`), `draft`(영수증 추가 중인 내용, `stage`가 `"reading"` → `"review"`).
- **데모 데이터**: 모두 `js/data.js`. 예시 내역은 `seedTransactions()`가 고정 난수로 만들고, 날짜는 `dateFor()`로 **오늘 기준** 두 달 전 · 지난달 · 이번 달에 놓여요(두 달 전은 카페가 많고, 지난달은 쇼핑이 튀어요). 샘플 12장도 내역에 들어가요.
- **그리기 방식**: `render()`가 `view`에 따라 `dashboardHtml()` · `listHtml()` · `addHtml()` · `budgetHtml()`이 만든 HTML 문자열을 `#main`의 `innerHTML`에 넣고, 이어서 `bind()`가 이벤트를 다시 붙여요. 상태를 바꾼 뒤에는 `save()` → `render()`. 사용자 글자는 꼭 `esc()`로 감싸서 넣어요. 탭 이동은 `go(next)`, 짧은 알림은 `toast(text)`.

## 실제 AI (CTRL+AI 기능 상자) 와 밖에서의 AI 연결 자리

CTRL+AI 안에서는 `app.js` 맨 위의 `live` 상태가 앱 위쪽 CTRL+AI 줄의 스위치(`ctrlai.ai.mode()`, `ctrlai:ai-mode` 이벤트)를 그대로 따라가요 — 앱 안에 따로 토글을 두지 않아요. **무료가 기본**이에요: 사진을 올리면 스위치와 상관없이 먼저 `startReading`이 샘플의 미리 만든 결과(아니면 빈 양식)를 열어요(0원). 스위치가 켜져 있으면 확인 화면에 가격이 붙은 「AI로 사진 읽기」(`#read-ai`, `.aiBtn`) → `readWithAi`가, 대시보드에 `#pattern-ai`(소비 패턴 쓰기)가 생기고, 눌렀을 때만 Claude를 불러요. 둘 다 `ctrlai.ai.ask`에 JSON 스키마를 주고, 결과는 아래 데모와 **같은 모양**이라 확인·저장 화면이 그대로예요. **CTRL+AI 밖에서 진짜로 연결할 때** 갈아 끼울 자리는 아래와 같아요.

지금 "AI"처럼 보이는 곳은 세 군데이고, 진짜로 바꿀 때 갈아 끼울 자리는 이래요.

1. **영수증 읽기** — `app.js`의 `startReading(image, sampleId)`. 0.9초 기다린 뒤 `L.extractionFor(sampleId)`(data.js)로 `SAMPLES`에서 미리 만든 결과 `{ shop, date, items, total, category, sampleId }`를 꺼내요. 샘플이 아닌 사진은 결과가 `null`이라 빈 양식이 열려요. 올린 SVG가 샘플인지는 `readFile(file)`이 그림 안의 `data-sample-id`로 알아봐요. → 진짜 버전에서는 `readFile`이 만든 이미지(data URL)를 서버로 보내고, 서버가 Claude API(이미지 입력)로 **같은 모양의 JSON**을 돌려주게 하면 돼요. 확인·수정 화면 `reviewHtml()`과 저장 코드는 그대로 쓸 수 있어요.
2. **자동 분류** — 위 결과의 `category`(지금은 `SAMPLES`의 값). → Claude가 `CATEGORIES` 중 하나를 고르게 해요.
3. **이번 달 소비 패턴** — `patternHtml(month, sums)`가 `L.PATTERN_NOTES[String(offsetOf(month))]`를 읽어요. 열쇠는 `"-2"` · `"-1"` · `"0"`(오늘 기준 몇 달 전)이고, 글 속 `{카페}` 같은 자리는 그 달 실제 합계로 채워요. 그 밖의 달은 안내만 보여요(실제 AI에서는 버튼으로 Claude가 써요). → 서버가 그 달과 전월의 카테고리별 합계를 Claude에 보내 `{ headline, points: [...], tip }`를 받아 오면 같은 화면에 그대로 그려져요.

데모 표시는 `<span class="demo">데모</span>`(결과마다)와 `.badge.demoAll`(메뉴 위, CTRL+AI 밖에서만 — 안에서는 위쪽 줄이 보여 줘요)예요. 진짜로 연결한 부분에서만 빼 주세요. **Claude API 키는 절대 브라우저 코드에 넣지 말고 서버에만 두세요.**

## 저장

- 고정 열쇠 `KEY = "receipt-ledger-v1"`(폴더와 무관)에 `state` 전체를 넣어요.
- **`store` 갈래**(`app.js` 맨 위): `window.ctrlai && window.ctrlai.connected`이면 `window.ctrlai.storage`(CTRL+AI 안 — 앱 · 방문자별, 약 1MB), 아니면 같은 `get/set`(Promise)으로 감싼 `localStorage`(내려받은 파일을 직접 열 때). `ctrlai`는 CTRL+AI가 넣어 주는 SDK라 그 안에만 있어요. **이 갈래가 있어야 안팎 모두에서 돌아가니 지우지 마세요.**
- 비동기라 `load()`는 없어요. `state`는 `freshState()`로 시작하고, 맨 아래에서 `store.get(KEY)`가 끝나면(모양이 맞으면 저장본으로) 첫 `render()`. `save()`는 `store.set(KEY, state)`, 실패는 `.catch`로 삼켜 저장소가 막혀도 화면은 돼요.
- `#reset`(데모 초기화)은 `freshState()`(`seedTransactions()` + `DEFAULT_BUDGET`)로 되돌려요.
- `state` 모양을 바꾸면 `KEY`의 `v1`을 `v2`로 올리거나, `store.get(KEY).then(...)`에서 옛 모양을 고쳐 읽게 해 주세요.
- `FRAMED_NOTE`(내려받기 막힘 안내): 안에서는 `ctrlai.app()`의 `framed`, 밖에서는 `window.top !== window.self`.

## 만들어진 조건 (CTRL+AI 안에서)

- 서버 없이 브라우저에서만 도는 **정적 앱**: HTML · CSS · JavaScript만.
- **바깥 서비스는 https만**: CTRL+AI 안에서도 지도·사진·CDN 라이브러리·키 없는 API는 쓸 수 있어요(2026-10-22부터). 이 앱의 차트는 그 전에 만들어져서 라이브러리 없이 SVG로 직접 그려요. API 키는 코드에 넣지 마세요 — 누구나 볼 수 있어요.
- **크기 제한**: 파일 30개, 파일 하나 200KB, 전체 2MB, 폴더 깊이 3단계, 확장자 .css .html .js .json .md .svg .txt.
- **alert · confirm 금지**: 대신 `armed(button, label, run)`으로 "두 번 눌러야 실행"하게 해요(내역 지우기, 데모 초기화).

**CTRL+AI 밖에서는 이 제한이 더 이상 적용되지 않아요.** 서버, 데이터베이스, npm 패키지, 외부 API를 써도 돼요. 다만 그렇게 바꾸면 CTRL+AI Builder에 다시 붙여 넣어 게시할 수는 없어요 — Builder는 위 조건의 정적 파일만 받아요. 그런 큰 변경 전에는 만든 사람에게 한 번 확인해 주세요.

## 코딩 관례

- 순수 HTML · CSS · JavaScript. 빌드 단계, 프레임워크, npm 패키지 없음.
- 함수와 변수는 camelCase(`dashboardHtml`, `budgetBars`), HTML 문자열을 돌려주는 함수는 이름이 `...Html`로 끝나요. CSS 클래스도 camelCase(`donutWrap`, `rowAmt`), id는 kebab-case(`dash-month`, `review-form`, `r-shop`), 이벤트용 표시는 `data-*`(`data-open`, `data-sample`, `data-budget`).
- `$(sel)`은 `document.querySelector`의 줄임말이에요.
- 금액은 늘 `won(n)` → `"12,300원"`(천 단위 쉼표). 화면의 글, 주석, 알림은 모두 한국어.
- 색은 `style.css`의 `:root` 변수(`--bg`, `--panel`, `--panel2`, `--line`, `--text`, `--muted`, `--accent`, `--warn`, `--caution`)를 쓰고, 카테고리 색은 `CATEGORY_COLORS`. 숫자에는 `font-variant-numeric: tabular-nums`.
- 접근성: 탭은 `role="tab"` + `aria-selected`, `#main`은 `aria-live`, 그래프에는 `aria-label`, 상세 창은 Esc로 닫혀요. 390px 폭에서도 쓸 수 있게 유지해 주세요.
- 파일 안의 큰 구역은 `// ----`로 시작하는 구분 주석(뒤에 "저장", "대시보드" 같은 이름)으로 나눠요.

## 실행과 확인

```
python -m http.server 8000
```

그다음 http://localhost:8000 을 열어요. 자동 테스트는 없어요. 바꾼 뒤 직접 눌러 보세요:

- **대시보드**: 달을 바꾸면 카드 3개, 소비 패턴, 도넛, 일별 그래프, 예산 막대가 함께 바뀌는지.
- **영수증 추가**: 샘플을 누르면 "영수증을 읽는 중…" 뒤에 결과가 채워지는지 · 품목 금액을 고치면 합계가 따라 바뀌는지 · 다른 사진은 빈 양식이 열리는지 · 저장하면 내역으로 가며 "저장했어요"가 뜨는지.
- **내역**: 검색, 달/카테고리 필터, 항목을 눌러 상세 열기(Esc로 닫기), 카테고리 바꾸기, "이 내역 지우기" 두 번 누르기, CSV를 엑셀로 열어 한글이 깨지지 않는지.
- **예산**: 예산 저장 후 80% 이상 "주의", 100% 이상 "경고"가 붙는지.
- **저장**: 새로고침해도 남아 있는지 · 데모 초기화를 두 번 누르면 처음으로 돌아가는지.
- 개발자 도구(F12) 콘솔에 빨간 오류가 없는지, 기기 모드로 좁은 화면도 확인.

## 기록

- `HISTORY.md` — 버전마다 무엇을 요청했는지 (이 앱이 어떻게 바뀌어 왔는지).
- `SPEC.md` — 원래 기획. 서버 · 데이터베이스 · 실제 AI가 붙은 버전의 설계도로 쓰세요.
