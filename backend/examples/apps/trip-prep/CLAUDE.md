# CLAUDE.md — 출장·여행 준비 도우미

Claude Code가 이 프로젝트에서 일을 시작할 때 읽는 안내예요. 만든 사람은 코딩을 잘 모르는 초보자예요 — 쉬운 한국어로 설명하고, 바꾸기 전에 무엇을 왜 바꿀지 먼저 짧게 말해 주세요.

## 구조

- `js/data.js` → `js/app.js` 순서로 불러요. 전역 객체는 `window.PREP` 하나.
- **상태**: `{ form: { text, origin, dest, depart, ret, people, purpose }, checks: { 준비물: true } }` — `trip-prep-v1` 키로 저장. CTRL+AI 안에서는 `ctrlai.storage`, 밖에서는 `localStorage` (지우지 마세요 — 안팎 모두에서 돌게 하는 갈래예요).
- **그리기**: `render()`가 `main`을 통째로 다시 그리고 `bind()`가 이벤트를 달아요. 날씨·환율은 `fillWeather()`·`fillRate()`가 그린 뒤에 채워요(결과는 `remember()`로 기억해 같은 걸 다시 묻지 않아요).
- **항공권 링크**(`flightLinks`): 네이버 `flight.naver.com/flights/international/SEL-TYO-20261120/TYO-SEL-20261123?adult=2&fareType=Y`(국내선은 `domestic`, 서울 출발은 김포 GMP), 구글 `google.com/travel/flights?q=Flights from Seoul to Tokyo on … through … for 2 adults`. 스카이스캐너는 자동 접속을 로봇으로 막아 확인이 어려워 넣지 않았어요.
- **실제 AI**: `readWithAi()` — `ctrlai.ai.ask`에 `READ_SCHEMA`(목적지는 목록 안에서만). 가격은 `ctrlai.ai.estimate`로 먼저 보여 줘요. 스위치는 CTRL+AI 줄의 것 하나(`ctrlai.ai.mode()`, `ctrlai:ai-mode`).

## 바깥 서비스

- 날씨 `api.open-meteo.com/v1/forecast` (2주까지), 환율 `api.frankfurter.dev/v1/latest` (TWD·VND 없음). 둘 다 키 없음.
- API 키는 코드에 넣지 마세요 — 누구나 볼 수 있어요. 실시간 항공권 가격처럼 키가 필요한 서비스는 서버가 생긴 뒤에.

## CTRL+AI 밖에서는

`window.ctrlai`가 없어요 — 저장은 `localStorage`로, AI 버튼은 사라지고 칸을 직접 골라요. 날씨·환율·항공권 링크는 인터넷만 되면 그대로 돼요. 이제는 서버를 두고 키가 필요한 API(항공권 가격 등)를 붙여도 돼요 — 다만 그렇게 바꾸면 CTRL+AI Builder에 다시 붙여 넣어 게시할 수는 없어요.

## 확인

- 도착을 바꾸면 날씨·환율·링크가 바뀌는지, 오는 날을 비우면 편도 링크가 되는지
- 출발이 2주보다 뒤면 "예보는 2주 전부터" 안내가 나오는지
- 준비물 체크가 새로 고침 뒤에도 남는지, 데모 초기화(두 번 누르기)
- 폭 390px 화면
