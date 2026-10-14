// 영수증 가계부 — 손으로 그리는 SVG: 샘플 영수증 그림, 도넛, 일별 선 그래프.
// 외부 차트 라이브러리를 쓰지 않습니다(앱은 인터넷에 닿지 않아요).

window.LEDGER = window.LEDGER || {};

LEDGER.won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;

LEDGER.esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// 샘플 영수증 한 장을 SVG 문자열로. data-sample-id가 들어 있어서, 내려받은
// 그림을 다시 올리면 어떤 샘플인지 알아봅니다.
LEDGER.receiptSvg = function (sampleId) {
  const r = LEDGER.extractionFor(sampleId);
  if (!r) return "";
  const esc = LEDGER.esc;
  const lines = r.items
    .map(
      (item, i) =>
        `<text x="22" y="${150 + i * 26}" font-size="15">${esc(item.name)}</text>` +
        `<text x="278" y="${150 + i * 26}" font-size="15" text-anchor="end">${item.amount.toLocaleString("ko-KR")}</text>`,
    )
    .join("");
  const height = 230 + r.items.length * 26;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-sample-id="${r.sampleId}" width="300" height="${height}" viewBox="0 0 300 ${height}" font-family="monospace" fill="#222">` +
    `<rect width="300" height="${height}" fill="#fdfcf7"/>` +
    `<path d="M0 ${height} ${Array.from({ length: 15 }, (_, i) => `L${i * 20 + 10} ${height - 8} L${i * 20 + 20} ${height}`).join(" ")}" fill="#e9e4d4"/>` +
    `<text x="150" y="44" font-size="20" text-anchor="middle" font-weight="bold">${esc(r.shop)}</text>` +
    `<text x="150" y="68" font-size="12" text-anchor="middle" fill="#666">사업자 000-00-00000 · 데모</text>` +
    `<text x="22" y="100" font-size="13" fill="#555">${r.date} 14:${String(10 + Number(sampleId.slice(1))).padStart(2, "0")}</text>` +
    `<line x1="20" y1="118" x2="280" y2="118" stroke="#999" stroke-dasharray="4 3"/>` +
    lines +
    `<line x1="20" y1="${150 + r.items.length * 26 - 8}" x2="280" y2="${150 + r.items.length * 26 - 8}" stroke="#999" stroke-dasharray="4 3"/>` +
    `<text x="22" y="${178 + r.items.length * 26}" font-size="17" font-weight="bold">합계</text>` +
    `<text x="278" y="${178 + r.items.length * 26}" font-size="17" font-weight="bold" text-anchor="end">${r.total.toLocaleString("ko-KR")}</text>` +
    `<text x="150" y="${height / 2 + 20}" font-size="54" text-anchor="middle" fill="#d33" opacity="0.13" transform="rotate(-20 150 ${height / 2})">샘플</text>` +
    `</svg>`
  );
};

LEDGER.receiptDataUrl = (sampleId) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LEDGER.receiptSvg(sampleId))}`;

// 도넛: [{label, value, color}] → SVG
LEDGER.donut = function (parts, centerTop, centerBottom) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const rings = total
    ? parts
        .filter((p) => p.value > 0)
        .map((p) => {
          const length = (p.value / total) * C;
          const ring = `<circle r="${R}" cx="100" cy="100" fill="none" stroke="${p.color}" stroke-width="26" stroke-dasharray="${length} ${C - length}" stroke-dashoffset="${-offset}"><title>${LEDGER.esc(p.label)} ${LEDGER.won(p.value)}</title></circle>`;
          offset += length;
          return ring;
        })
        .join("")
    : `<circle r="${R}" cx="100" cy="100" fill="none" stroke="var(--line)" stroke-width="26"/>`;
  return (
    `<svg viewBox="0 0 200 200" class="donut" role="img" aria-label="카테고리별 지출 도넛 그래프">` +
    `<g transform="rotate(-90 100 100)">${rings}</g>` +
    `<text x="100" y="96" text-anchor="middle" class="donutTop">${LEDGER.esc(centerTop)}</text>` +
    `<text x="100" y="118" text-anchor="middle" class="donutBottom">${LEDGER.esc(centerBottom)}</text>` +
    `</svg>`
  );
};

// 일별 지출 선 그래프: values[i] = i+1일의 합계
// upto: 이번 달처럼 아직 오지 않은 날이 있으면, 선은 그날까지만 그려요.
LEDGER.lineChart = function (values, label, upto = values.length) {
  const W = 560;
  const H = 180;
  const pad = { l: 46, r: 10, t: 12, b: 26 };
  const max = Math.max(10000, ...values);
  const x = (i) => pad.l + (i / Math.max(1, values.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const drawn = values.slice(0, Math.max(1, upto));
  const path = drawn.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${path} L${x(drawn.length - 1).toFixed(1)} ${H - pad.b} L${pad.l} ${H - pad.b} Z`;
  const grid = [0, 0.5, 1]
    .map((f) => {
      const v = max * f;
      return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${Math.round(v / 1000)}천</text>`;
    })
    .join("");
  const ticks = values
    .map((_, i) => (i % 5 === 0 || i === values.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${i + 1}일</text>` : ""))
    .join("");
  const dots = values
    .map((v, i) => (v > 0 ? `<circle cx="${x(i)}" cy="${y(v)}" r="3" class="dot"><title>${i + 1}일 ${LEDGER.won(v)}</title></circle>` : ""))
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="line" role="img" aria-label="${LEDGER.esc(label)}">${grid}<path d="${area}" class="area"/><path d="${path}" class="stroke"/>${dots}${ticks}</svg>`;
};
