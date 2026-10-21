# CLAUDE.md — 문서 챗봇 메이커

Claude Code가 이 프로젝트에서 일을 시작할 때 읽는 안내예요.

## 이 앱은

올린 문서(.txt · .md)로만 답하는 챗봇을 만드는 앱이에요. 질문과 가장 잘 맞는 단락을 BM25로 찾고, **CTRL+AI 안에서 위쪽 줄의 실제 AI 스위치가 켜져 있으면** 그 단락들을 Claude(`ctrlai.ai.ask`, JSON 스키마)에 주어 출처가 붙은 답을 받아요 — 질문한 사람의 지원금에서, 보냈을 때만, 단락이 없으면 부르지 않고. 로그인 전이거나 CTRL+AI 밖에서는 **데모**: 단락을 그대로 인용하고 "데모 · 문서 문장을 그대로 보여 줘요" 배지가 붙어요. 퍼가기 위젯과 관리자 통계(주제별 차트, 못 찾은 질문, 👍/👎)도 있어요.

만든 사람은 코딩을 잘 모르는 초보자예요. 쉬운 한국어로 설명하고, 파일을 바꾸기 전에 무엇을 왜 바꿀지 먼저 짧게 말해 주세요.

## 파일 구조

```text
index.html      만들기 화면 (탭 5개)
widget.html     퍼가기 위젯 단독 화면
style.css       두 화면이 함께 쓰는 스타일
js/
  docs.js       샘플 문서 · 처음 설정 · 샘플 기록 30개 · 주제 규칙
  search.js     단락 나누기 + BM25 찾기
  chat.js       대화창 (만들기 화면과 위젯이 공유)
  app.js        만들기 화면: 탭, 문서, 설정, 퍼가기, 관리자, 저장
  widget.js     위젯 동작
SPEC.md         원래 기획
```

## 구조

- **불러오는 순서**: `docs.js → search.js → chat.js → app.js`(index.html), 위젯은 마지막만 `widget.js`. 순서가 중요해요 — `docs.js`가 `window.BOT`을 만들고, 뒤 파일들이 IIFE 안에서 `const B = window.BOT`로 받아 함수를 붙여요.
- **공용 객체 `BOT`**: `SAMPLE_DOCS`, `DEFAULT_SETTINGS`(name · tone · welcome · notFound), `SAMPLE_LOGS`, `TOPIC_RULES`/`topicOf()`, `chunk()`, `tokens()`, `buildIndex()`, `retrieve()`, `THRESHOLD`, `answer()`, `esc()`, `newId()`, `mountChat()`. `app.js` 안의 나머지는 바깥에 안 보여요.
- **단락 나누기** `BOT.chunk(doc)`: `#` 제목마다 새 묶음(맨 위 `#`은 문서 이름이라 라벨에서 뺌), 빈 줄로 단락 구분, 60자 미만은 다음 단락과 합치고 500자 넘으면 문장 단위로 잘라요. 라벨은 "제5조 (회비)", "제5조 (회비) · 2단락", 제목이 없으면 "3단락".
- **찾기**: `BOT.tokens()`가 불용어를 빼고 조사를 떼고 한글 두 글자 조각(바이그램)을 더해요. `BOT.retrieve(question, index, limit = 3)`가 BM25(k1 1.2, b 0.75) 점수를 질문 낱말 수로 나눠 `[{ chunk, score }]`를 돌려줘요. **찾기는 이 한 함수 뒤에 있어요.**
- **답 기준**: `BOT.answer()` — 1등 점수가 `BOT.THRESHOLD`(0.88)보다 낮으면 `found: false` → 설정의 "못 찾을 때 문구". 넘으면 1등은 인용, 기준을 넘는 나머지는 "관련 단락" 버튼.
- **흘려 보여 주기**: `chat.js`의 `stream()`이 16ms마다 3글자씩 써요(가짜 스트리밍). `prefers-reduced-motion`이면 한 번에. 말투별 첫 문장은 `INTRO.친근` / `INTRO.공식`.
- **위젯**: 퍼가기 탭의 코드 한 줄은 `widget.html`을 가리키는 `<iframe>`이에요. 미리보기는 `srcdoc` + `<base href>`로 같은 파일을 그리고 `sandbox="allow-scripts allow-forms"`라 저장소를 못 써요. 그래서 `postMessage`로 주고받아요: 위젯 `bot-ready` → 만들기 화면 `bot-config`(settings, docs) → 위젯은 `bot-log` · `bot-rate`를 보내고, 만들기 화면이 기록에 `widget: true`로 쌓아요. 양쪽 모두 보낸 창(`event.source`)을 확인해요. 위젯을 바로 열면 저장된 문서 · 설정을 읽기만 해요.

## 실제 AI (CTRL+AI 기능 상자) 와 밖에서의 AI 연결 자리

CTRL+AI 안에서는 `app.js`의 `live` 상태가 앱 위쪽 CTRL+AI 줄의 스위치(`ctrlai.ai.mode()`, `ctrlai:ai-mode` 이벤트)를 그대로 따라가요 — 앱 안에 따로 토글을 두지 않아요. 켜지면 `chat.js`의 `askAi()`가 `B.retrieve()`로 찾은 단락 4개를 `B.answerOptions()`로 묶어 `ctrlai.ai.ask`에 보내고 `{ found, answer, sources }`를 받아요. 가격은 `B.priceOptions()`(가장 긴 단락 4개 + 200자 질문)로 `ctrlai.ai.estimate`에 미리 물어 "질문 1회 약 N원 · 최대 M원"으로 보여 줘요. 위젯은 셸 안에서 혼자 열렸을 때만 실제 AI예요. **CTRL+AI 밖에서 진짜로 연결할 때** 갈아 끼울 자리는 아래와 같아요.

- `BOT.retrieve()`는 그대로 둬요(나중에 임베딩 검색으로 바꿔도 반환 모양 `[{ chunk, score }]`만 지키면 돼요).
- 바뀌는 곳은 **답 만들기**예요: `chat.js`의 `ask()`에서 `B.answer()` 결과로 `INTRO` 문장 + `result.best.chunk.text`를 `stream()`하는 부분을, "질문 + 찾은 단락들을 내 서버로 보내고 → 서버가 Claude API로 답을 만들어 → 흘려 돌려주는" 호출로 바꿔요. 출처 표시(`chunk.doc` · `chunk.label`), 👍/👎, `onLog`는 그대로 써요.
- Claude API 키는 브라우저에 두지 말고 서버(예: FastAPI)에서만 써요.
- PDF는 `app.js`의 `readFiles()`에서 `ext === "pdf"`일 때 안내만 띄우는 자리예요.
- 대화 기록은 지금 `addLog()`가 브라우저에 저장해요 → 서버(데이터베이스)로 보내는 자리.

## 저장

- 고정 키 하나 `KEY = "doc-chatbot-v1"`(폴더와 상관없어요). 값은 `{ docs, settings, logs }`. 기록은 500개까지(오래된 것부터 지움).
- **`store` 갈래**(`app.js` 맨 위): `window.ctrlai && window.ctrlai.connected`이면 `window.ctrlai.storage`(CTRL+AI 안 — 이 앱 · 이 방문자만의 공간, 약 1MB), 아니면 같은 `get/set`(Promise)으로 감싼 `localStorage`(내려받은 파일을 직접 열 때). `ctrlai`는 CTRL+AI가 앱을 내보낼 때 SDK 스크립트를 넣어 줘서 그 안에서만 있어요. **이 갈래가 있어야 CTRL+AI 안과 밖 양쪽에서 돌아가니 지우지 마세요.** `widget.js`의 `fromStorage()`도 같은 갈래로 같은 `KEY`를 읽기만 해요.
- 비동기라 `load()`는 없어요. `state`는 `fresh()`(샘플)로 시작하고, 맨 아래에서 `store.get(KEY)`가 끝나면(형식이 맞을 때만 저장본으로 바꾸고 `reindex()`) 첫 `show("chat")`을 해요. 읽기 실패 · 형식 불일치면 샘플 그대로예요.
- `save()`는 `Promise<boolean>`을 돌려줘요: 저장했으면 `true`, 실패(저장소가 막힘, 1MB 초과)면 `false` → 화면에 "저장이 막혀 있어요"를 보여요. 결과가 필요한 곳은 `save().then((ok) => ...)`로 써요.
- `state` 모양을 바꾸면 예전 저장본과 안 맞을 수 있어요. 그럴 땐 `KEY`의 `v1`을 `v2`로 올리거나(위젯의 `KEY`도 같이), `store.get(KEY).then(...)`에서 옛 모양을 고쳐 읽게 해 주세요.
- 업로드 제한: 파일 하나 200KB(`MAX_FILE`), 문서 전체 80만 자(`MAX_TOTAL`).

## 만들어진 조건 (CTRL+AI 안에서)

- 서버 없이 브라우저에서만 도는 **정적 앱**: HTML · CSS · JavaScript만.
- **네트워크 없음**: CSP가 `connect-src 'self'`라 다른 곳에 요청할 수 없고, CDN 스크립트도 안 돼요.
- **크기 제한**: 파일 30개, 파일 하나 200KB, 전체 2MB, 폴더 깊이 3단계, 확장자 .css .html .js .json .md .svg .txt.
- `alert` · `confirm` 금지 — 화면 안에서 확인받아요.

**CTRL+AI 밖에서는 이 제한이 더 이상 적용되지 않아요.** 서버, 데이터베이스, npm 패키지, 외부 API, PDF 읽기 라이브러리를 써도 돼요. 다만 그렇게 바꾸면 CTRL+AI Builder에 다시 붙여 넣을 수 없어요. 큰 변경 전에는 만든 사람에게 먼저 물어봐 주세요.

## 코딩 관례

- 빌드 단계 · 프레임워크 · npm 없음. 파일마다 `(function () { ... })();`, 공유할 것만 `BOT`에 붙여요.
- 화면은 탭마다 `xxxView()` 함수가 `main.innerHTML`을 통째로 다시 그려요(`VIEWS` + `show(name)`). 다시 그린 뒤 누른 버튼에 포커스를 돌려줘요.
- 사람이 쓴 글을 HTML에 넣을 때는 반드시 `esc()`.
- 지우기 · 초기화는 `armed(button, text, done)` — 4초 안에 두 번 눌러야 해요.
- 화면 읽기 프로그램용 알림은 `say(text)`(`#status` 영역).
- 화면 글과 주석은 한국어. 2칸 들여쓰기, 큰따옴표, 세미콜론.
- 색은 `style.css`의 `:root` 변수(`--violet` 등)로. 390px 폭에서도 깨지지 않게.

## 실행과 확인

```
python -m http.server 8000
```

http://localhost:8000 을 열어요(파일을 더블클릭해 열면 위젯 미리보기가 비어요). 자동 테스트는 없어요. 바꾼 뒤 직접 확인하세요:

1. 챗봇 탭 "회비는 얼마예요?" → 동아리 회칙 · 제5조 (회비) 인용 + 오른쪽 점수 막대.
2. "주차 가능한가요?" → 못 찾을 때 문구.
3. 문서 탭에 글을 붙여 넣기 → "단락 N개로 나눠" 알림, 그 내용으로 질문. PDF는 안내만.
4. 설정에서 말투를 공식으로 → 첫 문장이 바뀜.
5. 퍼가기 미리보기에서 질문 → 관리자 탭 기록에 "위젯"으로 쌓임.
6. 관리자 탭: 기록 30개, 거르기(못 찾음 · 👎), 주제 차트.
7. 새로 고침 후에도 남는지, 데모 초기화(두 번)로 돌아가는지.

개발자 도구(F12) 콘솔에 빨간 오류가 없어야 해요.

## 기록

- `HISTORY.md` — 버전마다 무엇을 요청했는지.
- `SPEC.md` — 원래 기획. 서버 · 데이터베이스 · 실제 AI 버전의 설계도.
