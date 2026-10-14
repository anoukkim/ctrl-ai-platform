// AI 상식 퀴즈 — 10문제, 문제마다 15초. 빨리 맞힐수록 점수가 높아요.
// 최고 점수는 이 기기의 브라우저에 저장됩니다.

const QUESTIONS = [
  { q: "ChatGPT, Claude 같은 AI를 무엇이라고 부를까요?", a: ["대규모 언어 모델(LLM)", "운영체제", "검색 엔진", "데이터베이스"], ok: 0 },
  { q: "AI에게 하는 질문이나 지시문을 부르는 말은?", a: ["쿠키", "프롬프트", "픽셀", "서버"], ok: 1 },
  { q: "웹 페이지의 뼈대(구조)를 만드는 언어는?", a: ["CSS", "Python", "HTML", "SQL"], ok: 2 },
  { q: "웹 페이지의 색과 모양을 꾸미는 언어는?", a: ["CSS", "HTML", "Java", "C"], ok: 0 },
  { q: "버튼을 눌렀을 때 일어나는 일을 만드는 언어는?", a: ["SQL", "JavaScript", "Markdown", "JSON"], ok: 1 },
  { q: "AI가 사실이 아닌 내용을 그럴듯하게 지어내는 것을 무엇이라 할까요?", a: ["환각(할루시네이션)", "캐싱", "렌더링", "컴파일"], ok: 0 },
  { q: "AI 서비스가 글을 나누어 세는 단위는?", a: ["바이트", "토큰", "프레임", "픽셀"], ok: 1 },
  { q: "만든 앱의 코드를 저장하고 함께 고치는 대표적인 서비스는?", a: ["YouTube", "GitHub", "Figma", "Notion"], ok: 1 },
  { q: "비밀번호를 안전하게 저장하는 방법으로 알맞은 것은?", a: ["그대로 저장", "해시로 바꿔 저장", "이메일로 보내기", "메모장에 적기"], ok: 1 },
  { q: "AI가 만든 결과를 쓸 때 가장 먼저 해야 할 일은?", a: ["바로 공유하기", "사실인지 확인하기", "지우기", "복사하기"], ok: 1 },
];
const SECONDS = 15;
const BEST_KEY = "ai-quiz-best";

let order = [];
let choices = []; // 이번 문제의 보기 (섞은 순서)
let index = 0;
let score = 0;
let left = SECONDS;
let timer = null;

const $ = (id) => document.getElementById(id);

function best() {
  return Number(localStorage.getItem(BEST_KEY) || 0);
}

function show(screen) {
  for (const id of ["intro", "game", "result"]) $(id).hidden = id !== screen;
}

// 문제 순서를 섞습니다.
function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function start() {
  order = shuffle(QUESTIONS);
  index = 0;
  score = 0;
  show("game");
  ask();
}

function ask() {
  const item = order[index];
  $("counter").textContent = `${index + 1} / ${order.length}`;
  $("score").textContent = score;
  $("question").textContent = item.q;
  $("feedback").textContent = "";
  $("next").hidden = true;

  // 보기 순서도 섞어서, 정답이 늘 같은 자리에 있지 않게 합니다.
  choices = shuffle(item.a.map((text, i) => ({ text, right: i === item.ok })));
  const box = $("choices");
  box.innerHTML = "";
  choices.forEach(({ text }, choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.textContent = `${"ABCD"[choice]}. ${text}`;
    button.addEventListener("click", () => answer(choice));
    box.append(button);
  });

  left = SECONDS;
  drawTime();
  clearInterval(timer);
  timer = setInterval(() => {
    left -= 0.25;
    drawTime();
    if (left <= 0) answer(-1);
  }, 250);
}

function drawTime() {
  const bar = $("time");
  bar.style.width = `${Math.max(0, (left / SECONDS) * 100)}%`;
  bar.classList.toggle("hurry", left <= 5);
}

// 답을 고르면(또는 시간이 다 되면) 맞았는지 보여 줍니다.
function answer(choice) {
  clearInterval(timer);
  const buttons = [...document.querySelectorAll(".choice")];
  buttons.forEach((button, i) => {
    button.disabled = true;
    if (choices[i].right) button.classList.add("right");
    else if (i === choice) button.classList.add("wrong");
  });
  if (choice >= 0 && choices[choice].right) {
    const gained = 50 + Math.round(left * 10);
    score += gained;
    $("feedback").textContent = `정답! +${gained}점`;
  } else {
    $("feedback").textContent = choice === -1 ? "시간 초과!" : "아쉬워요!";
  }
  $("score").textContent = score;
  $("next").hidden = false;
  $("next").textContent = index + 1 < order.length ? "다음 문제 →" : "결과 보기 ★";
  $("next").focus();
}

function next() {
  index += 1;
  if (index < order.length) ask();
  else finish();
}

function finish() {
  const old = best();
  const record = score > old;
  if (record) localStorage.setItem(BEST_KEY, String(score));
  $("result-title").textContent = record ? `새 기록! ${score}점` : `${score}점`;
  $("result-detail").textContent = record
    ? "최고 점수를 넘었어요. 친구에게 도전해 보라고 해 보세요!"
    : `최고 점수는 ${old}점이에요. 한 번 더?`;
  $("best").textContent = best();
  show("result");
}

$("play").addEventListener("click", start);
$("again").addEventListener("click", start);
$("next").addEventListener("click", next);
$("best").textContent = best();
