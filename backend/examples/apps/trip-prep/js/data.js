// 출장·여행 준비 도우미 — 목적지 목록.
// 한 줄: [이름, 영어 이름(구글 항공편 검색용), 도시 공항 코드, 위도, 경도, 통화]
// 위치는 Open-Meteo 지오코딩으로 확인한 도시 중심이에요 (날씨용).

window.PREP = window.PREP || {};

PREP.DESTINATIONS = [
  ["도쿄", "Tokyo", "TYO", 35.69, 139.692, "JPY"],
  ["오사카", "Osaka", "OSA", 34.694, 135.501, "JPY"],
  ["후쿠오카", "Fukuoka", "FUK", 33.6, 130.417, "JPY"],
  ["삿포로", "Sapporo", "SPK", 43.067, 141.35, "JPY"],
  ["오키나와", "Okinawa", "OKA", 26.213, 127.679, "JPY"],
  ["상하이", "Shanghai", "SHA", 31.222, 121.458, "CNY"],
  ["베이징", "Beijing", "BJS", 39.907, 116.397, "CNY"],
  ["홍콩", "Hong Kong", "HKG", 22.25, 114.167, "HKD"],
  ["타이베이", "Taipei", "TPE", 25.053, 121.526, "TWD"],
  ["방콕", "Bangkok", "BKK", 13.754, 100.501, "THB"],
  ["다낭", "Da Nang", "DAD", 16.068, 108.221, "VND"],
  ["하노이", "Hanoi", "HAN", 21.024, 105.841, "VND"],
  ["호찌민", "Ho Chi Minh City", "SGN", 10.823, 106.63, "VND"],
  ["싱가포르", "Singapore", "SIN", 1.367, 103.8, "SGD"],
  ["쿠알라룸푸르", "Kuala Lumpur", "KUL", 3.141, 101.687, "MYR"],
  ["마닐라", "Manila", "MNL", 14.604, 120.982, "PHP"],
  ["세부", "Cebu", "CEB", 10.317, 123.891, "PHP"],
  ["발리", "Bali", "DPS", -8.65, 115.217, "IDR"],
  ["시드니", "Sydney", "SYD", -33.868, 151.207, "AUD"],
  ["파리", "Paris", "PAR", 48.853, 2.349, "EUR"],
  ["런던", "London", "LON", 51.509, -0.126, "GBP"],
  ["로마", "Rome", "ROM", 41.892, 12.511, "EUR"],
  ["바르셀로나", "Barcelona", "BCN", 41.389, 2.159, "EUR"],
  ["프랑크푸르트", "Frankfurt", "FRA", 50.116, 8.684, "EUR"],
  ["뉴욕", "New York", "NYC", 40.714, -74.006, "USD"],
  ["로스앤젤레스", "Los Angeles", "LAX", 34.052, -118.244, "USD"],
  ["샌프란시스코", "San Francisco", "SFO", 37.775, -122.419, "USD"],
  ["호놀룰루", "Honolulu", "HNL", 21.307, -157.858, "USD"],
  ["괌", "Guam", "GUM", 13.466, 144.748, "USD"],
  ["제주", "Jeju", "CJU", 33.51, 126.522, "KRW"],
  ["부산", "Busan", "PUS", 35.102, 129.03, "KRW"],
].map(([name, en, code, lat, lng, currency]) => ({ name, en, code, lat, lng, currency }));

// 출발지 — 서울은 인천·김포 모두(SEL), 국내선은 김포(GMP)로 찾아요.
PREP.ORIGINS = [
  { name: "서울", en: "Seoul", code: "SEL", domestic: "GMP" },
  { name: "부산", en: "Busan", code: "PUS", domestic: "PUS" },
];

// 통화 — 몇 단위로 보여 줄지(100엔처럼), 한국어 이름. 무료 환율(ECB)에 없는 통화는 rate: false.
PREP.CURRENCIES = {
  JPY: { label: "엔", unit: 100 },
  CNY: { label: "위안", unit: 1 },
  HKD: { label: "홍콩달러", unit: 1 },
  TWD: { label: "대만달러", unit: 1, rate: false },
  THB: { label: "바트", unit: 1 },
  VND: { label: "동", unit: 1000, rate: false },
  SGD: { label: "싱가포르달러", unit: 1 },
  MYR: { label: "링깃", unit: 1 },
  PHP: { label: "페소", unit: 1 },
  IDR: { label: "루피아", unit: 1000 },
  AUD: { label: "호주달러", unit: 1 },
  EUR: { label: "유로", unit: 1 },
  GBP: { label: "파운드", unit: 1 },
  USD: { label: "달러", unit: 1 },
  KRW: { label: "원", unit: 1 },
};

// 준비물 — 목적에 따라 (체크는 이 기기에 저장돼요).
PREP.CHECKLIST = {
  출장: ["여권 (남은 기간 6개월 이상)", "명함", "노트북·충전기", "멀티 어댑터", "출장 신청·법인카드", "발표 자료 백업 (USB·클라우드)", "현지 연락처·주소", "여행자 보험"],
  여행: ["여권 (남은 기간 6개월 이상)", "숙소 예약 확인", "멀티 어댑터", "현지 유심·eSIM", "환전·해외 결제 카드", "상비약", "여행자 보험", "보조배터리"],
};

// 처음 열면 보이는 예시 — 다음 달 도쿄 출장.
PREP.SAMPLE_TEXT = "다음 달 셋째 주 수요일부터 2박 3일 도쿄 출장, 2명";
