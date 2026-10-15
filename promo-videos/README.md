# CTRL+AI 소개 영상 (샘플 5종)

1분짜리 광고형 키네틱 타이포그래피 영상입니다. 다섯 편 모두 같은 이야기를
같은 순서로 보여 주고, 스타일·화면 비율·음악만 다릅니다.

| 파일 | 스타일 | 화면 | 음악 |
| ---- | ------ | ---- | ---- |
| [`01-neon-house.mp4`](01-neon-house.mp4) | 네온 · 다크, 글리치 · 그리드 | 1920×1080 (가로) | 퓨처 하우스 124 BPM |
| [`02-swiss-garage.mp4`](02-swiss-garage.mp4) | 스위스 타이포 · 빨강/검정, 마스크 슬라이드 | 1920×1080 (가로) | UK 개러지 2-step 132 BPM |
| [`03-y2k-jersey.mp4`](03-y2k-jersey.mp4) | Y2K · 크롬 글씨, 스티커, 테이프 | 1080×1920 (세로 · 릴스/쇼츠) | 저지 클럽 140 BPM |
| [`04-phonk-drift.mp4`](04-phonk-drift.mp4) | 폰크 · 블랙/레드, VHS, 킥에 화면 흔들림 | 1080×1920 (세로 · 릴스/쇼츠) | 드리프트 폰크 128 BPM (카우벨) |
| [`05-pop-pastel.mp4`](05-pop-pastel.mp4) | 파스텔 팝 · 둥근 글씨, 블롭, 반짝이 | 1920×1080 (가로) | K-팝 신스팝 120 BPM |

## 흐름 (60초)

1. **훅** — "코딩? 몰라도 돼. 말만 해." 같은 문구가 비트마다 바뀝니다.
2. **CTRL+AI** 로고 — 함께 만들고 함께 나누는 AI 창작 커뮤니티
3. **STEP 01 로그인** — Google로 계속하기 / 아이디·비밀번호 / 초대 코드로 가입
4. **STEP 02 Chat** — 하고 싶은 걸 적으면 → 답이 오고 → Project Builder 버튼
5. **STEP 03 Project Builder** — 미리보기, "버튼 색을 주황색으로 바꿔 줘", 버전·게시
6. **STEP 04 Video Generator** — 한국어 프롬프트 → 영상 → 다시 생성·YouTube 게시
7. **STEP 05 CtrlAIApps** — 게시된 앱 목록 → 앱 실행
8. **분기마다 80,000원** 동아리 지원금 — 카드 등록 없이, 쓴 만큼 투명하게
9. **마무리** — 말하면, 만들어 준다. · `ctrlai.my` · 초대 코드로 지금 시작하세요

장면 전환은 모두 마디(bar) 경계에 맞춰져 있어서 비트에 맞게 끊깁니다.

## 알아 둘 점

- **음악은 직접 합성한 오리지널**입니다(`source/music.py`, numpy로 킥·스네어·
  베이스·코드를 한 음씩 만듦). 샘플이나 기존 곡을 쓰지 않아 저작권 걱정 없이
  올릴 수 있습니다.
- **화면은 로컬 개발 서버의 실제 화면**입니다(`dev` 계정, 개발용 시드 데이터).
  Claude 답변은 mock 공급자가 낸 것이라 Chat 화면 위쪽에 "테스트 모드 – 실제 AI
  결과가 아닙니다" 표시가 보입니다. 영상 미리보기도 mock 자리표시 영상입니다.
  실제 서비스 화면으로 바꾸려면 아래 방법으로 스크린샷만 새로 찍어 다시 렌더링하면
  됩니다.
- 폰트는 Google Fonts(Black Han Sans, Gasoek One, Bagel Fat One, Jua,
  Noto Sans KR, Unbounded, Archivo Black, Anton, Syne, Space Grotesk — 모두 OFL)를
  씁니다.

## 다시 만들기

`source/`에 영상 엔진이 있습니다. 모든 움직임은 `seek(t)`가 시간 t에서 계산하므로
프레임마다 똑같이 다시 나옵니다.

| 파일 | 하는 일 |
| ---- | ------- |
| `music.py` | 다섯 곡(WAV)과 장면 타임라인(JSON)을 만듭니다 |
| `engine.html` · `engine.css` · `engine.js` | `engine.html?style=<id>` — 영상 한 편 |
| `render.cjs` | 헤드리스 Chrome으로 30fps 프레임을 찍어 ffmpeg로 MP4를 만듭니다 |
| `shots/` | 엔진이 쓰는 사이트 스크린샷 (다크/라이트) |

```bash
# 준비: numpy, scipy, ffmpeg (pip install imageio-ffmpeg 로도 됨), Playwright, Chrome
cd promo-videos/source
python music.py audio                      # audio/<id>.wav + audio/<id>.json
python -m http.server 8765 &               # engine.html, shots/, audio/ 를 띄움
PLAYWRIGHT=../../frontend/node_modules/playwright FFMPEG=ffmpeg \
  node render.cjs http://127.0.0.1:8765 01-neon-house ../01-neon-house.mp4 audio/01-neon-house.wav
# 정지 화면만 확인:  node render.cjs http://127.0.0.1:8765 01-neon-house --stills out 12.5 20
```

렌더링은 한 번에 한 편씩 돌리세요(동시에 돌리면 `http.server`가 이미지 요청을
놓칠 수 있습니다). 한 편에 몇 분 걸립니다.

스크린샷을 새로 찍을 때는 1440×900 창, 배율 1.5(= 2160×1350 PNG), 다크와 라이트
테마 두 벌이 필요합니다. 파일 이름은 `shots/`에 있는 것과 같아야 하고, 화면 배치가
크게 바뀌면 `engine.js`의 `R`(확대할 영역 좌표)도 맞춰 주어야 합니다.
