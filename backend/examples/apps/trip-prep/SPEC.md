# SPEC — 출장·여행 준비 도우미

App 1 — 출장·여행 준비 도우미 (owner, 2026-10-22: replaces 영수증 가계부 — "회사원들 상대라서", 항공권 비교 버튼 같은 것)

Context: member apps are static (apps.ctrlai.my: HTML/CSS/JS only) and, since app-open-services, may call keyless https services. Build it as a faithful STATIC DEMOS showcase: no server of its own, honest about what is demo and what is 실제 AI.

## What it does

- One sentence ("다음 주 금요일부터 2박 3일 도쿄 출장, 2명") or the fields directly: 출발 (서울·부산), 도착 (31 cities, 국내 2 + 해외), 가는 날, 오는 날 (empty = 편도), 인원, 목적 (출장·여행).
- **✦ AI로 정리** (실제 AI, visitor's wallet, only when pressed): Claude reads the sentence and fills the fields (JSON schema; today's date in the prompt; destinations only from the list).
- **항공권 비교**: links to 네이버 항공권 and 구글 항공편 with route, dates and travellers filled in. Prices are not fetched — real-time fares are paid data; the sites show them.
- **날씨**: Open-Meteo daily forecast for the trip days (from two weeks before departure).
- **환율**: Frankfurter (ECB reference rates) — "100엔 = …원" and a small converter. TWD and VND are not in the ECB set: said so.
- **준비물**: a checklist by purpose (출장·여행), kept on this device.

## Later (outside CTRL+AI, with a server)

- Real fares from a flight API (Amadeus, Skyscanner partners) — keys stay on the server.
- Calendar export (.ics), sharing a trip with colleagues, expense report from the trip.
