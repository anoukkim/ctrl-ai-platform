// 여행 일정 메이커 — 손으로 그린 SVG 지도와 예산 도넛.
// 지도 타일을 받아 오지 않아요: 도시 윤곽은 아주 단순하게 그린 것이에요.

(function () {
  const T = window.TRIP;

  T.esc = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  T.won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;

  // 지도 크기 — 좁은 화면에서는 더 작은 판에 그려 글씨가 덜 작아지게 해요.
  let W = 600;
  let H = 440;

  // 위도·경도를 화면 좌표로 — 하루 동선이 꽉 차게 맞추고, 위도에 따라 가로를 줄여요.
  function projector(points) {
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs);
    let maxLng = Math.max(...lngs);
    const midLat = (minLat + maxLat) / 2;
    const k = Math.cos((midLat * Math.PI) / 180);
    // 최소 범위(약 5km)와 여백
    const span = Math.max(maxLat - minLat, (maxLng - minLng) * k, 0.045) * 1.35;
    const cLat = (minLat + maxLat) / 2;
    const cLng = (minLng + maxLng) / 2;
    const scale = Math.min(W, H) / span;
    return {
      x: (lng) => W / 2 + (lng - cLng) * k * scale,
      y: (lat) => H / 2 - (lat - cLat) * scale,
      kmPerPx: (111 / scale),
    };
  }

  const path = (pts, pr, close) =>
    pts.map(([lat, lng], i) => `${i ? "L" : "M"}${pr.x(lng).toFixed(1)},${pr.y(lat).toFixed(1)}`).join("") + (close ? "Z" : "");

  T.routeMap = function (trip, dayIndex) {
    const small = window.innerWidth < 560;
    W = small ? 380 : 600;
    H = small ? 400 : 440;
    const city = T.city(trip);
    const items = T.schedule(trip, dayIndex);
    const stops = items.map((it) => it.place);
    const others = trip.days.flatMap((ids, d) => (d === dayIndex ? [] : ids.map((id) => T.place(trip, id))));
    const focus = stops.length ? stops : city.places;
    const pr = projector(focus);
    const land = [city.outline, ...(city.islands || [])]
      .map((poly) => `<path class="land" d="${path(poly, pr, true)}"/>`)
      .join("");
    const water = (city.water || []).map((line) => `<path class="river" d="${path(line, pr, false)}"/>`).join("");
    const route = stops.length > 1 ? `<path class="route" d="${path(stops.map((p) => [p.lat, p.lng]), pr, false)}"/>` : "";
    const ghost = others
      .map((p) => `<circle class="ghost" cx="${pr.x(p.lng).toFixed(1)}" cy="${pr.y(p.lat).toFixed(1)}" r="4"><title>${T.esc(p.name)} (다른 날)</title></circle>`)
      .join("");
    // 이름표가 겹치지 않게: 오른쪽 → 왼쪽 → 위 → 아래 순서로 빈자리를 찾아요.
    const boxes = stops.map((p) => ({ x: pr.x(p.lng) - 14, y: pr.y(p.lat) - 14, w: 28, h: 28 }));
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const markers = stops
      .map((p, i) => {
        const x = pr.x(p.lng);
        const y = pr.y(p.lat);
        const w = p.name.length * 13 + 6;
        const spots = [
          { dx: 18, dy: 4, anchor: "start", box: { x: x + 16, y: y - 10, w, h: 20 } },
          { dx: -18, dy: 4, anchor: "end", box: { x: x - 16 - w, y: y - 10, w, h: 20 } },
          { dx: 0, dy: -20, anchor: "middle", box: { x: x - w / 2, y: y - 34, w, h: 20 } },
          { dx: 0, dy: 30, anchor: "middle", box: { x: x - w / 2, y: y + 16, w, h: 20 } },
        ];
        const inside = (b) => b.x >= 4 && b.x + b.w <= W - 4 && b.y >= 4 && b.y + b.h <= H - 4;
        // 빈자리가 없으면 이름은 빼고 번호만 — 이름은 왼쪽 일정에 있어요.
        const spot = spots.find((s) => inside(s.box) && !boxes.some((b, k) => k !== i && hit(s.box, b)));
        if (spot) boxes.push(spot.box);
        return `<g class="marker" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <title>${i + 1}. ${T.esc(p.name)}</title><circle r="13"/><text class="num" y="4.5">${i + 1}</text>
          ${spot ? `<text class="label" x="${spot.dx}" y="${spot.dy}" text-anchor="${spot.anchor}">${T.esc(p.name)}</text>` : ""}
        </g>`;
      })
      .join("");
    // 축척 막대: 1·2·5·10km 중 화면에 알맞은 길이
    const kmOptions = [0.5, 1, 2, 5, 10, 20];
    const km = kmOptions.find((v) => v / pr.kmPerPx >= 70) || 20;
    const barPx = km / pr.kmPerPx;
    const label = stops.map((p, i) => `${i + 1}. ${p.name}`).join(", ");
    return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${dayIndex + 1}일차 동선 지도: ${T.esc(label || "장소 없음")}">
      <rect class="sea" width="${W}" height="${H}"/>
      <g class="gridlines">${Array.from({ length: Math.floor(W / 100) }, (_, i) => `<line x1="${(i + 1) * 100}" y1="0" x2="${(i + 1) * 100}" y2="${H}"/>`).join("")}${Array.from(
        { length: Math.floor(H / 100) },
        (_, i) => `<line x1="0" y1="${(i + 1) * 100}" x2="${W}" y2="${(i + 1) * 100}"/>`,
      ).join("")}</g>
      ${land}${water}${ghost}${route}${markers}
      <g class="scale" transform="translate(20,${H - 24})"><line x1="0" y1="0" x2="${barPx.toFixed(1)}" y2="0"/><text x="0" y="-7">${km}km</text></g>
      <g class="north" transform="translate(${W - 30},34)"><path d="M0,-16 L7,6 L0,1 L-7,6Z"/><text y="22" text-anchor="middle">N</text></g>
      <text class="waterLabel" x="${W - 16}" y="${H - 16}" text-anchor="end">${T.esc(city.waterLabel)} · 단순화한 윤곽</text>
    </svg>`;
  };

  T.BUDGET_COLORS = { 숙박: "#7aa7ff", 식비: "#ff7a59", 교통: "#ffd166", 체험: "#5fe0c0" };

  // 조각 사이에 틈이 있는 도넛.
  T.donut = function (parts, total) {
    const entries = Object.entries(parts).filter(([, v]) => v > 0);
    const sum = entries.reduce((s, [, v]) => s + v, 0) || 1;
    const r = 62;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = entries
      .map(([name, v]) => {
        const len = (v / sum) * c;
        const gap = entries.length > 1 ? Math.min(4, len / 3) : 0;
        const arc = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="${T.BUDGET_COLORS[name]}" stroke-width="18"
          stroke-dasharray="${(len - gap).toFixed(2)} ${(c - len + gap).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
          transform="rotate(-90 80 80)"><title>${name} ${T.won(v)}</title></circle>`;
        offset += len;
        return arc;
      })
      .join("");
    return `<svg class="donut" viewBox="0 0 160 160" role="img" aria-label="예상 비용 ${T.won(total)}: ${entries
      .map(([n, v]) => `${n} ${T.won(v)}`)
      .join(", ")}">
      <circle r="${r}" cx="80" cy="80" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="18"/>${arcs}
      <text x="80" y="76" text-anchor="middle" class="donutSmall">예상 비용</text>
      <text x="80" y="96" text-anchor="middle" class="donutBig">${T.won(total)}</text>
    </svg>`;
  };
})();
