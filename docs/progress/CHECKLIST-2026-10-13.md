# 확인 목록 — 내 PC에서 (2026-10-14 아침)

로컬 사이트가 **http://localhost:3100** 에 켜져 있습니다(백엔드 8100,
목업 제공자, 새 개발 시드). 계정: 관리자 `dev` / `devpassword`, 회원
`pw_member` / `memberpassword`, 초대 코드 `DEV-WELCOME`.
라이브 사이트(https://ctrlai.my) 점검은
[`MORNING-2026-10-14.md`](MORNING-2026-10-14.md) (4)에 있습니다 — 아래는
내 PC에서 가볍게 눌러 보는 용도입니다.

## A1 — fix-beta-blockers

- [ ] **Profile**: 다른 사람(yurikim)의 목업 앱이 없고, "내가 만든 앱"은
  빈 상태입니다(앱 게시는 Phase 5).
- [ ] 저장소에 `docs/index.html`(3 MB 옛 시안)이 없습니다. **GitHub
  Pages 끄기**는 저장소 Settings → Pages → Source: None (제가 못
  바꾸는 설정입니다).

## A2 — personal-topup-off

- [ ] **Usage**: 동아리 지원 지갑만 보이고 **개인 잔액 구역이 없습니다**.
- [ ] **Admin** 메뉴에 **Top-ups가 없습니다** (11개 구역).
- [ ] 회원 창에서 충전을 시도하면(예: Usage 어디에도 버튼이 없음 — API로
  보내도) "지금은 개인 충전을 쓸 수 없습니다" 403.

## A3 — token-guard · live-cost-display · chat-plus-tools (전부 목업)

- [ ] **Chat**: 답장이 흐르는 동안 **약 N원**, 끝나면
  **입력/출력/캐시 읽기/합계** 영수증, 사이드바 지갑이 새로고침 없이
  줄어듭니다.
- [ ] **Admin › System › 채팅 한도**에서 1회 한도를 7원으로 낮추면 긴
  답장이 한도에서 멈추고 그렇게 말합니다. 되돌리기: 100원.
- [ ] 대화가 길어지면 입력창 위에 **새 대화 제안**(아끼는 금액 포함)이
  보입니다.
- [ ] **Admin › AI Models**에서 Sonnet의 **웹 검색**을 켜고, 회원 창
  모델 피커 옆 칩으로 켜면(비용 안내 먼저) "…검색해 줘"에 "검색 중…"
  → 출처 링크 → 영수증에 "검색 N회 M원". 목업이라 실제 요금 없음.

## docs-cleanup 브랜치 (승인 대기 — 병합 전)

- [ ] GitHub에서 `docs-cleanup` 브랜치 diff를 봐 주세요(문서만;
  CLAUDE.md 1,784 → 444줄, verify 스킬 재작성, 새 파비콘/마크).
  미리보기가 필요하면 말씀해 주세요 — 별도 포트로 띄워 드립니다.
- [ ] 좋으면 "docs-cleanup 병합해"라고만 하시면 됩니다.

## 그 외

- [ ] 운영 서버 배포 상태는 MORNING (1)의 보드를 봐 주세요.
- [ ] 결정 기다리는 것: 도구 결과 토큰 vs 1회 한도(run log), docs-cleanup
  승인, privacy-and-terms 문안.
