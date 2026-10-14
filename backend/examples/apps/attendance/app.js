// 동아리 출석 체크 — 날짜마다 출석 상태를 이 기기의 브라우저에 저장합니다.

// 저장해 두는 열쇠 이름
const MEMBERS_KEY = "attendance-members";
const RECORDS_KEY = "attendance-records";

// 누를 때마다 돌아가는 순서
const ORDER = ["none", "here", "late", "away"];
const LABEL = { none: "미확인", here: "출석", late: "지각", away: "결석" };

// 저장된 값을 읽습니다. 처음이면 예시 이름 몇 개로 시작합니다.
function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (error) {
    return fallback;
  }
}

let members = load(MEMBERS_KEY, ["김하늘", "이도윤", "박서연", "최민준"]);
let records = load(RECORDS_KEY, {});

const dateInput = document.getElementById("date");
const list = document.getElementById("members");
const empty = document.getElementById("empty");

// 오늘 날짜를 "2026-10-14" 꼴로
function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().slice(0, 10);
}

function save() {
  localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  render();
}

// 고른 날짜의 기록
function day() {
  const key = dateInput.value;
  if (!records[key]) records[key] = {};
  return records[key];
}

// 화면을 다시 그립니다.
function render() {
  const record = day();
  list.innerHTML = "";
  const counts = { here: 0, late: 0, away: 0, none: 0 };

  members.forEach((name, index) => {
    const state = record[name] || "none";
    counts[state] += 1;

    const row = document.createElement("li");
    row.className = "member";

    const button = document.createElement("button");
    button.className = "name";
    button.type = "button";
    button.textContent = name;
    button.setAttribute("aria-label", `${name} — 지금 ${LABEL[state]}, 눌러서 바꾸기`);
    button.addEventListener("click", () => {
      const next = ORDER[(ORDER.indexOf(state) + 1) % ORDER.length];
      record[name] = next;
      save();
    });

    const badge = document.createElement("span");
    badge.className = `badge ${state}`;
    badge.textContent = LABEL[state];

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${name} 빼기`);
    // 실수로 지우지 않도록 두 번 눌러야 빠집니다(미리보기 창에서는
    // 확인 대화상자를 쓸 수 없어서 이렇게 합니다).
    remove.addEventListener("click", () => {
      if (remove.dataset.armed !== "1") {
        remove.dataset.armed = "1";
        remove.textContent = "빼기?";
        setTimeout(() => {
          remove.dataset.armed = "";
          remove.textContent = "×";
        }, 3000);
        return;
      }
      members.splice(index, 1);
      save();
    });

    row.append(button, badge, remove);
    list.append(row);
  });

  for (const state of Object.keys(counts)) {
    document.getElementById(`count-${state}`).textContent = counts[state];
  }
  empty.hidden = members.length > 0;
}

// 날짜를 하루씩 옮깁니다.
function shift(days) {
  const date = new Date(dateInput.value + "T00:00:00");
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset() * 60000;
  dateInput.value = new Date(date - offset).toISOString().slice(0, 10);
  render();
}

document.getElementById("prev").addEventListener("click", () => shift(-1));
document.getElementById("next").addEventListener("click", () => shift(1));
dateInput.addEventListener("change", render);

// 동아리원 추가
document.getElementById("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("new-name");
  const name = input.value.trim();
  if (!name || members.includes(name)) return;
  members.push(name);
  input.value = "";
  save();
});

dateInput.value = today();
render();
