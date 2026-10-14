// 영수증 가계부 — 데모 데이터.
// 모든 상호는 지어낸 것이고, "AI 결과"는 미리 만들어 둔 것입니다.
// AI 연결 후에는 이 자리의 결과를 Claude가 영수증 사진에서 직접 읽어 옵니다.

window.LEDGER = window.LEDGER || {};

LEDGER.CATEGORIES = ["식비", "카페", "교통", "쇼핑", "생활", "의료", "문화", "기타"];

LEDGER.CATEGORY_COLORS = {
  식비: "#ff8a5b",
  카페: "#c49a6c",
  교통: "#4fb3ff",
  쇼핑: "#ff5fa2",
  생활: "#7ddc8a",
  의료: "#ff6b6b",
  문화: "#b18cff",
  기타: "#9aa6b2",
};

// 카테고리별 한 달 예산(원) — 처음 값. 화면에서 바꿀 수 있어요.
LEDGER.DEFAULT_BUDGET = {
  식비: 350000,
  카페: 80000,
  교통: 90000,
  쇼핑: 150000,
  생활: 100000,
  의료: 50000,
  문화: 60000,
  기타: 40000,
};

// 오늘을 기준으로 몇 달 전인지(0 = 이번 달)와 날짜(일)로 "YYYY-MM-DD"를 만듭니다.
LEDGER.dateFor = function (monthOffset, day) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  let d = Math.min(day, last);
  if (monthOffset === 0) d = Math.min(d, now.getDate());
  const pad = (n) => String(n).padStart(2, "0");
  return `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(d)}`;
};

// ---- 샘플 영수증 12장 (미리 만든 "추출 결과"와 1:1로 짝) ----
LEDGER.SAMPLES = [
  { id: "r01", shop: "달빛로스터리", month: 0, day: 3, category: "카페", items: [["아이스 아메리카노", 4500], ["바닐라 라테", 5500], ["크루아상", 4200]] },
  { id: "r02", shop: "모퉁이분식", month: 0, day: 5, category: "식비", items: [["떡볶이", 5000], ["김밥 2줄", 7000], ["어묵", 2000]] },
  { id: "r03", shop: "초록마트 금곡점", month: 0, day: 6, category: "생활", items: [["주방세제", 3900], ["키친타월", 5800], ["물티슈 3팩", 6900], ["대파", 2500]] },
  { id: "r04", shop: "한빛약국", month: 0, day: 8, category: "의료", items: [["종합감기약", 8500], ["밴드", 3000]] },
  { id: "r05", shop: "시네마루 극장", month: 0, day: 9, category: "문화", items: [["영화 관람권 2매", 28000], ["팝콘 세트", 9500]] },
  { id: "r06", shop: "누리택시", month: 0, day: 10, category: "교통", items: [["택시 요금", 13800]] },
  { id: "r07", shop: "옷장편집샵", month: -1, day: 14, category: "쇼핑", items: [["니트 가디건", 59000], ["면 티셔츠", 19000]] },
  { id: "r08", shop: "북스테이서점", month: -1, day: 16, category: "문화", items: [["에세이 「느린 하루」", 15000], ["엽서 세트", 4000]] },
  { id: "r09", shop: "온새미로베이커리", month: -1, day: 18, category: "카페", items: [["소금빵 3개", 9000], ["밀크티", 5000]] },
  { id: "r10", shop: "바른안경원", month: -1, day: 21, category: "쇼핑", items: [["안경테", 89000], ["렌즈 교체", 45000]] },
  { id: "r11", shop: "하늘정류장 주유소", month: -2, day: 11, category: "교통", items: [["휘발유 30L", 51600]] },
  { id: "r12", shop: "살림창고", month: -2, day: 19, category: "생활", items: [["수납함 2개", 12000], ["옷걸이 20개", 6000], ["전구", 4500]] },
];

// 미리 만든 "추출 결과" — 샘플 id로 찾습니다.
LEDGER.extractionFor = function (sampleId) {
  const sample = LEDGER.SAMPLES.find((s) => s.id === sampleId);
  if (!sample) return null;
  return {
    shop: sample.shop,
    date: LEDGER.dateFor(sample.month, sample.day),
    items: sample.items.map(([name, amount]) => ({ name, amount })),
    total: sample.items.reduce((sum, [, amount]) => sum + amount, 0),
    category: sample.category,
    sampleId: sample.id,
  };
};

// ---- 3달 치 예시 내역 (늘 같은 값이 나오도록 고정된 난수) ----
LEDGER.seedTransactions = function () {
  let state = 20261015;
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const SHOPS = {
    식비: ["모퉁이분식", "한솥밥상", "골목국수", "바다회관", "점심한끼"],
    카페: ["달빛로스터리", "온새미로베이커리", "구름카페", "느린오후", "책방카페 쉼"],
    교통: ["누리택시", "하늘정류장 주유소", "교통카드 충전", "시외버스터미널"],
    쇼핑: ["옷장편집샵", "바른안경원", "소품가게 모아", "운동화공방", "온라인몰 하루"],
    생활: ["초록마트 금곡점", "살림창고", "세탁소 깨끗해", "동네철물점"],
    의료: ["한빛약국", "새봄내과", "튼튼치과"],
    문화: ["시네마루 극장", "북스테이서점", "전시관 빛담", "공연장 울림"],
    기타: ["우체국", "선물가게 마음", "사진관 오늘"],
  };
  const RANGE = {
    식비: [6000, 18000], 카페: [3500, 9000], 교통: [1300, 18000], 쇼핑: [12000, 70000],
    생활: [3000, 28000], 의료: [4000, 22000], 문화: [8000, 32000], 기타: [3000, 20000],
  };
  // 한 달에 몇 번씩 쓰는지 — 두 달 전은 카페가 많고, 지난달은 쇼핑이 튑니다.
  const PLAN = {
    "-2": { 식비: 14, 카페: 22, 교통: 6, 쇼핑: 2, 생활: 4, 의료: 1, 문화: 2, 기타: 1 },
    "-1": { 식비: 13, 카페: 9, 교통: 6, 쇼핑: 9, 생활: 4, 의료: 1, 문화: 3, 기타: 1 },
    "0": { 식비: 9, 카페: 7, 교통: 4, 쇼핑: 2, 생활: 3, 의료: 1, 문화: 2, 기타: 1 },
  };
  const out = [];
  let n = 0;
  for (const offset of [-2, -1, 0]) {
    const plan = PLAN[String(offset)];
    for (const category of LEDGER.CATEGORIES) {
      for (let i = 0; i < plan[category]; i += 1) {
        const [lo, hi] = RANGE[category];
        let amount = Math.round((lo + rand() * (hi - lo)) / 100) * 100;
        if (offset === -1 && category === "쇼핑" && i < 3) amount += 60000; // 지난달 쇼핑 급증
        n += 1;
        out.push({
          id: `seed-${n}`,
          shop: pick(SHOPS[category]),
          // 이번 달은 오늘까지의 날짜에만 고루 퍼뜨립니다.
          date: LEDGER.dateFor(offset, 1 + Math.floor(rand() * (offset === 0 ? new Date().getDate() : 28))),
          items: [{ name: category === "카페" ? "음료" : "결제 금액", amount }],
          total: amount,
          category,
          source: "seed",
        });
      }
    }
  }
  // 샘플 영수증 12장도 내역에 들어 있어요.
  for (const sample of LEDGER.SAMPLES) {
    const result = LEDGER.extractionFor(sample.id);
    out.push({ id: `sample-${sample.id}`, ...result, source: "sample" });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
};

// ---- 미리 만든 "이번 달 소비 패턴" (데모 · AI 연결 전) ----
// 숫자는 화면이 실제 내역으로 채우고, 문장은 미리 써 둔 것입니다.
LEDGER.PATTERN_NOTES = {
  "-2": {
    headline: "카페 지출이 예산을 훌쩍 넘은 달이었어요.",
    points: [
      "카페 지출이 {카페}원으로 예산을 넘었어요 — 평일 오후 결제가 대부분이에요.",
      "식비는 비교적 안정적이었어요.",
    ],
    tip: "다음 달엔 주 2회만 카페에 가고, 나머지는 텀블러 커피로 바꿔 보면 한 달 약 4만 원을 아낄 수 있어요.",
  },
  "-1": {
    headline: "지난달보다 쇼핑이 눈에 띄게 늘었어요.",
    points: [
      "쇼핑이 {쇼핑}원 — 큰 결제 몇 건(안경, 옷)이 대부분이에요.",
      "카페는 전월보다 줄었어요. 좋은 변화예요!",
    ],
    tip: "큰 물건은 '장바구니에 담고 3일 기다리기' 규칙을 써 보세요. 충동 구매가 줄어요.",
  },
  "0": {
    headline: "이번 달은 지금까지 균형이 잘 맞고 있어요.",
    points: [
      "가장 많이 쓴 곳은 식비({식비}원)예요.",
      "남은 날 동안 문화비 예산이 여유 있어요.",
    ],
    tip: "월말 외식이 몰리기 쉬워요. 이번 주 장보기 때 간단한 저녁거리를 미리 사 두세요.",
  },
};
