// 오늘의 할 일 + 집중 타이머 — 25분 집중하고 5분 쉬기(뽀모도로).
// 할 일과 끝낸 집중 횟수는 이 기기의 브라우저에 저장됩니다.

const KEY = "focus-todo";
const FOCUS = 25 * 60; // 집중 25분(초)
const REST = 5 * 60; // 쉬기 5분(초)

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? null;
  } catch (error) {
    return null;
  }
}

const saved = load();
let tasks = saved?.tasks ?? [
  { id: 1, text: "발표 자료 첫 장 만들기", done: false, pomos: 0 },
  { id: 2, text: "동아리 회의록 정리", done: false, pomos: 0 },
];
let sessions = saved?.day === new Date().toDateString() ? saved.sessions : 0;
let currentId = tasks[0]?.id ?? null;

let mode = "focus"; // "focus" 또는 "rest"
let left = FOCUS;
let ticking = null;

const ring = document.getElementById("progress");
const RADIUS = 52;
const LENGTH = 2 * Math.PI * RADIUS;
ring.style.strokeDasharray = `${LENGTH}`;

function save() {
  localStorage.setItem(KEY, JSON.stringify({ tasks, sessions, day: new Date().toDateString() }));
}

// 남은 시간을 "24:59" 꼴로
function clock(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function renderTimer() {
  const total = mode === "focus" ? FOCUS : REST;
  document.getElementById("clock").textContent = clock(left);
  document.getElementById("mode").textContent = mode === "focus" ? "집중" : "쉬는 시간";
  document.querySelector(".timer").classList.toggle("resting", mode === "rest");
  ring.style.strokeDashoffset = `${LENGTH * (1 - left / total)}`;
  document.getElementById("start").textContent = ticking ? "멈춤" : "시작";
  document.getElementById("sessions").textContent = sessions;
  const current = tasks.find((task) => task.id === currentId);
  document.getElementById("focus-on").textContent = current
    ? `지금: ${current.text}`
    : "할 일을 골라 집중해 보세요";
  document.title = ticking ? `${clock(left)} · 집중 타이머` : "오늘의 할 일 + 집중 타이머";
}

// 1초마다 줄이고, 0이 되면 집중과 쉬기를 바꿉니다.
function tick() {
  left -= 1;
  if (left <= 0) {
    if (mode === "focus") {
      sessions += 1;
      const current = tasks.find((task) => task.id === currentId);
      if (current) current.pomos += 1;
      save();
      renderTasks();
      mode = "rest";
      left = REST;
    } else {
      mode = "focus";
      left = FOCUS;
    }
  }
  renderTimer();
}

document.getElementById("start").addEventListener("click", () => {
  if (ticking) {
    clearInterval(ticking);
    ticking = null;
  } else {
    ticking = setInterval(tick, 1000);
  }
  renderTimer();
});

document.getElementById("reset").addEventListener("click", () => {
  clearInterval(ticking);
  ticking = null;
  mode = "focus";
  left = FOCUS;
  renderTimer();
});

function renderTasks() {
  const list = document.getElementById("tasks");
  list.innerHTML = "";
  tasks.forEach((task) => {
    const row = document.createElement("li");
    row.className = "task";
    if (task.done) row.classList.add("finished");
    if (task.id === currentId) row.classList.add("current");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = task.done;
    check.setAttribute("aria-label", `${task.text} 끝냄`);
    check.addEventListener("change", () => {
      task.done = check.checked;
      save();
      renderTasks();
    });

    // 할 일을 누르면 타이머가 그 일에 집중합니다.
    const label = document.createElement("button");
    label.type = "button";
    label.className = "label";
    label.textContent = task.text;
    label.addEventListener("click", () => {
      currentId = task.id;
      renderTasks();
      renderTimer();
    });

    const pomos = document.createElement("span");
    pomos.className = "pomos";
    pomos.textContent = task.pomos ? "●".repeat(Math.min(task.pomos, 8)) : "";
    pomos.title = `집중 ${task.pomos}번`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `${task.text} 지우기`);
    remove.addEventListener("click", () => {
      tasks = tasks.filter((item) => item.id !== task.id);
      if (currentId === task.id) currentId = tasks[0]?.id ?? null;
      save();
      renderTasks();
      renderTimer();
    });

    row.append(check, label, pomos, remove);
    list.append(row);
  });
  document.getElementById("empty").hidden = tasks.length > 0;
}

document.getElementById("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("new-task");
  const text = input.value.trim();
  if (!text) return;
  const task = { id: Date.now(), text, done: false, pomos: 0 };
  tasks.push(task);
  if (currentId === null) currentId = task.id;
  input.value = "";
  save();
  renderTasks();
  renderTimer();
});

renderTasks();
renderTimer();
