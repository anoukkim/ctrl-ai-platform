// 여행 일정 메이커 — 데모 플래너.
// AI 대신 정해진 규칙으로 일정을 짜요: 같은 조건이면 늘 같은 일정이 나와요.
// 실제 AI(로그인한 회원)에서는 app.js의 planWithAi가 Claude에게 맡기고, 장소는 여전히 아래 목록에서만 고릅니다. 맞지 않는 날은 이 플래너가 채워요.

(function () {
  const T = window.TRIP;

  T.LODGING_TIERS = ["알뜰", "보통", "좋음"];
  T.MEAL_ALLOWANCE = 10000; // 맛집 일정이 없는 끼니 1인 식비
  T.WALK_KM = 1.2; // 이보다 가까우면 걸어가요

  // "다른 곳"(anywhere.js)으로 만든 일정은 장소 목록을 일정 안(cityData)에 갖고 있어요.
  T.city = (trip) => trip.cityData || T.CITIES[trip.input.city];
  T.place = (trip, id) => T.city(trip).places.find((p) => p.id === id);

  // 두 지점 사이의 직선 거리(km) — 하버사인 공식.
  T.haversine = function (a, b) {
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
  const round100 = (n) => Math.round(n / 100) * 100;

  // 한 구간의 이동 — 가까우면 도보, 아니면 도시의 이동 수단(길은 직선보다 30% 길다고 봐요).
  T.leg = function (trip, a, b) {
    const km = T.haversine(a, b);
    const people = trip.input.people;
    if (km <= T.WALK_KM) {
      return { km, minutes: round5((km * 1.3 * 60) / 4.5), mode: "도보", cost: 0 };
    }
    const move = T.city(trip).move;
    const minutes = round5((km * 1.3 * 60) / move.speed + move.wait);
    let cost = move.perPerson * people;
    if (move.perKm) cost += round100((move.base || 0) + move.perKm * km * 1.3) * Math.ceil(people / 5);
    return { km, minutes, mode: move.label, cost };
  };

  // ---------------------------------------------------------------- 점수
  function score(trip, p) {
    let s = trip.input.prefs.includes(p.pref) ? 3 : 1;
    if (trip.rain) s += p.indoor ? 2 : -2;
    if (trip.cheap) s -= p.cost / 15000;
    return s;
  }

  const dayMinutes = (trip) => (trip.relaxed ? 420 : 540);
  const maxStops = (trip) => (trip.relaxed ? 3 : 5);

  // 하루치 일정을 욕심쟁이(greedy) 방식으로 채워요: 점수가 높고 가까운 곳부터.
  function buildDay(trip, used, rotation) {
    const places = T.city(trip).places.filter((p) => !used.has(p.id));
    if (!places.length) return [];
    const starters = places
      .filter((p) => p.pref !== "맛집")
      .map((p, i) => ({ p, s: score(trip, p) * 100 - i }))
      .sort((x, y) => y.s - x.s);
    if (!starters.length) return [];
    const first = starters[rotation % Math.min(starters.length, 4)].p;
    const day = [first];
    let elapsed = first.minutes;
    const count = (pref) => day.filter((p) => p.pref === pref).length;
    while (day.length < maxStops(trip)) {
      const last = day[day.length - 1];
      let best = null;
      for (const p of places) {
        if (day.includes(p)) continue;
        const leg = T.leg(trip, last, p);
        if (elapsed + leg.minutes + p.minutes > dayMinutes(trip)) continue;
        let value = score(trip, p) * 10 - leg.minutes / 3;
        if (p.pref === "맛집") value += count("맛집") === 0 && day.length >= 1 ? 8 : count("맛집") >= 2 ? -100 : 0;
        if (p.pref === "쇼핑" && count("쇼핑") >= 2) value -= 100;
        if (p.pref === "휴식" && count("휴식") >= 1) value -= 6;
        if (!best || value > best.value) best = { p, value, leg };
      }
      if (!best || best.value < -50) break;
      day.push(best.p);
      elapsed += best.leg.minutes + best.p.minutes;
    }
    return day.map((p) => p.id);
  }

  T.plan = function (input, cityData) {
    const trip = { input: { ...input, prefs: [...input.prefs] }, lodging: "보통", rain: false, cheap: false, relaxed: false, days: [], notes: [] };
    if (cityData) trip.cityData = cityData;
    const used = new Set();
    for (let d = 0; d < input.days; d += 1) {
      const ids = buildDay(trip, used, 0);
      ids.forEach((id) => used.add(id));
      trip.days.push(ids);
    }
    fitBudget(trip);
    return trip;
  };

  // ---------------------------------------------------------------- 시간표와 비용
  T.schedule = function (trip, dayIndex) {
    const ids = trip.days[dayIndex] || [];
    let clock = trip.relaxed ? 630 : 600; // 10:30 또는 10:00
    const out = [];
    ids.forEach((id, i) => {
      const p = T.place(trip, id);
      const leg = i === 0 ? null : T.leg(trip, T.place(trip, ids[i - 1]), p);
      if (leg) clock += leg.minutes;
      out.push({ place: p, leg, start: clock, end: clock + p.minutes });
      clock += p.minutes;
    });
    return out;
  };

  T.clock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  T.budget = function (trip) {
    const { people, days } = trip.input;
    const lodging = Math.max(0, days - 1) * Math.ceil(people / 2) * T.city(trip).lodging[trip.lodging];
    let food = 0;
    let fun = 0;
    let move = 0;
    let meals = 0;
    trip.days.forEach((ids, d) => {
      for (const item of T.schedule(trip, d)) {
        if (item.place.pref === "맛집") {
          food += item.place.cost * people;
          meals += 1;
        } else {
          fun += item.place.cost * people;
        }
        if (item.leg) move += item.leg.cost;
      }
    });
    food += Math.max(0, days * 2 - meals) * T.MEAL_ALLOWANCE * people;
    const rent = T.city(trip).move.perDay;
    if (rent) move += rent * days * Math.ceil(people / 5); // 제주: 차 빌리는 값
    const parts = { 숙박: lodging, 식비: food, 교통: move, 체험: fun };
    return { parts, total: lodging + food + move + fun };
  };

  // ---------------------------------------------------------------- 바꾸기
  const usedIds = (trip) => new Set(trip.days.flat());

  // 한 곳을 비슷한 다른 곳으로 — 조건(test)을 만족하고, 앞 장소와 가까운 곳.
  function swap(trip, d, i, test) {
    const ids = trip.days[d];
    const here = T.place(trip, ids[i]);
    const anchor = i > 0 ? T.place(trip, ids[i - 1]) : here;
    const used = usedIds(trip);
    const options = T.city(trip).places
      .filter((p) => !used.has(p.id) && test(p, here))
      .map((p) => ({ p, v: (p.pref === here.pref ? 5 : 0) + score(trip, p) * 2 - T.haversine(anchor, p) }))
      .sort((x, y) => y.v - x.v);
    if (!options.length) return false;
    ids[i] = options[0].p.id;
    return true;
  }

  // 바꾼 뒤 하루가 너무 길어졌으면 끝에서부터 덜어 내요 (첫 장소는 남겨요).
  T.trim = function (trip) {
    const limit = (trip.relaxed ? 630 : 600) + dayMinutes(trip) + 30;
    trip.days.forEach((ids, d) => {
      while (ids.length > 1) {
        const items = T.schedule(trip, d);
        if (items[items.length - 1].end <= limit) break;
        ids.pop();
      }
    });
  };

  function fitBudget(trip) {
    if (T.budget(trip).total <= trip.input.budget) return;
    const tier = T.LODGING_TIERS.indexOf(trip.lodging);
    if (tier > 0) {
      trip.lodging = T.LODGING_TIERS[tier - 1];
      trip.notes.push(`예산에 맞추려고 숙소를 '${trip.lodging}'으로 낮췄어요.`);
    }
    let swapped = 0;
    for (let guard = 0; guard < 30 && T.budget(trip).total > trip.input.budget; guard += 1) {
      // 가장 비싼 곳을 더 싼 곳으로
      let worst = null;
      trip.days.forEach((ids, d) =>
        ids.forEach((id, i) => {
          const p = T.place(trip, id);
          if (p.cost > 0 && (!worst || p.cost > worst.cost)) worst = { d, i, cost: p.cost };
        }),
      );
      if (!worst || !swap(trip, worst.d, worst.i, (p, here) => p.cost < here.cost)) break;
      swapped += 1;
    }
    T.trim(trip);
    if (swapped) trip.notes.push(`예산에 맞추려고 비싼 장소 ${swapped}곳을 더 싼 곳으로 바꿨어요.`);
    const over = T.budget(trip).total - trip.input.budget;
    if (over > 0) trip.notes.push(`그래도 예산보다 ${T.won(over)} 많아요. 기간·인원·예산을 바꿔 보세요.`);
  }

  T.regenerateDay = function (trip, d) {
    trip.attempts = (trip.attempts || 0) + 1;
    const others = new Set(trip.days.filter((_, k) => k !== d).flat());
    const mine = trip.days[d];
    // 오늘 있던 곳은 빼고 새로 짜 봐요. 남은 곳이 모자라면 다시 넣어요.
    let ids = buildDay(trip, new Set([...others, ...mine]), trip.attempts);
    if (ids.length < 2) ids = buildDay(trip, others, trip.attempts);
    trip.days[d] = ids;
  };

  T.move = function (trip, d, from, to) {
    const ids = trip.days[d];
    if (to < 0 || to >= ids.length || from === to) return;
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
  };

  T.remove = (trip, d, i) => trip.days[d].splice(i, 1);
  T.add = (trip, d, id) => trip.days[d].push(id);

  T.unused = function (trip, d) {
    const used = usedIds(trip);
    const ids = trip.days[d];
    const last = ids.length ? T.place(trip, ids[ids.length - 1]) : null;
    return T.city(trip).places
      .filter((p) => !used.has(p.id))
      .map((p) => ({ p, km: last ? T.haversine(last, p) : 0 }))
      .sort((x, y) => x.km - y.km);
  };

  // ---- 문장으로 바꾸기: 데모는 세 가지 규칙만 알아들어요.
  T.intent = function (text) {
    const t = text.replace(/\s+/g, "");
    if (/(비|우천|실내|장마)/.test(t) && /(오는|날|버전|때|실내|우천|장마)/.test(t)) return "rain";
    if (/(저렴|싸게|싼|아끼|절약|돈|예산줄)/.test(t)) return "cheap";
    if (/(여유|느긋|천천|덜빡빡|적게|쉬엄)/.test(t)) return "relax";
    return null;
  };

  T.applyRain = function (trip) {
    trip.rain = true;
    let changed = 0;
    trip.days.forEach((ids, d) =>
      ids.forEach((id, i) => {
        if (!T.place(trip, id).indoor && swap(trip, d, i, (p) => p.indoor)) changed += 1;
      }),
    );
    T.trim(trip);
    const left = trip.days.flat().filter((id) => !T.place(trip, id).indoor).length;
    const rest = left ? ` 남은 실내 장소가 모자라 ${left}곳은 실외 그대로예요 — 빼거나 직접 바꿔 보세요.` : "";
    return changed
      ? `비 오는 날 규칙으로 실외 ${changed}곳을 실내로 바꿨어요.${rest}`
      : left
        ? `더 바꿀 실내 장소가 없어요.${rest}`
        : "이미 모두 실내 일정이에요.";
  };

  T.applyCheap = function (trip) {
    trip.cheap = true;
    const said = [];
    const tier = T.LODGING_TIERS.indexOf(trip.lodging);
    if (tier > 0) {
      trip.lodging = T.LODGING_TIERS[tier - 1];
      said.push(`숙소를 '${trip.lodging}'으로`);
    }
    let changed = 0;
    trip.days.forEach((ids, d) =>
      ids.forEach((id, i) => {
        const p = T.place(trip, id);
        if (p.cost >= 15000 && swap(trip, d, i, (q, here) => q.cost <= here.cost / 2)) changed += 1;
      }),
    );
    T.trim(trip);
    if (changed) said.push(`비싼 곳 ${changed}곳을 더 싼 곳으로`);
    return said.length ? `${said.join(", ")} 바꿨어요.` : "이미 가장 알뜰한 일정이에요.";
  };

  T.applyRelax = function (trip) {
    trip.relaxed = true;
    let dropped = 0;
    trip.days = trip.days.map((ids) => {
      if (ids.length <= 3) return ids;
      const keep = ids
        .map((id, i) => ({ id, i, s: score(trip, T.place(trip, id)) }))
        .sort((x, y) => y.s - x.s || x.i - y.i)
        .slice(0, 3)
        .sort((x, y) => x.i - y.i)
        .map((x) => x.id);
      dropped += ids.length - keep.length;
      return keep;
    });
    return dropped
      ? `하루 3곳까지로 줄이고 출발을 10시 30분으로 늦췄어요 (${dropped}곳 뺌).`
      : "출발을 10시 30분으로 늦췄어요. 이미 하루 3곳 이하예요.";
  };

  // ---------------------------------------------------------------- 공유
  // 일정 전체를 주소의 # 뒤에 넣어요. 서버에는 아무것도 보내지 않아요.
  T.encode = function (trip) {
    const slim = { i: trip.input, l: trip.lodging, r: trip.rain, c: trip.cheap, x: trip.relaxed, d: trip.days };
    if (trip.cityData) slim.p = trip.cityData.places.map((p) => [p.id, p.name, p.pref, p.indoor, p.lat, p.lng, p.minutes, p.cost, p.note]);
    const bytes = new TextEncoder().encode(JSON.stringify(slim));
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  // 공유 링크로 받은 "다른 곳" 장소 목록 — 한국 안의 위치와 짧은 글만 받아요.
  function sharedArea(name, rows) {
    if (typeof name !== "string" || !T.areaCity) return null;
    const places = rows
      .slice(0, 16)
      .filter((r) => Array.isArray(r) && r.length === 9)
      .map(([id, label, pref, indoor, lat, lng, minutes, cost, note]) => ({
        id: String(id).slice(0, 4),
        name: String(label).slice(0, 30),
        pref: T.PREFS.includes(pref) ? pref : "문화",
        indoor: Boolean(indoor),
        lat: Number(lat),
        lng: Number(lng),
        minutes: Math.max(30, Math.min(180, Number(minutes) || 60)),
        cost: Math.max(0, Math.min(200000, Number(cost) || 0)),
        note: String(note).slice(0, 60),
      }))
      .filter((p) => p.lat > 33 && p.lat < 39 && p.lng > 124 && p.lng < 132);
    return places.length ? T.areaCity(name.slice(0, 20), places) : null;
  }

  T.decode = function (text) {
    try {
      const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
      const slim = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
      const city = Array.isArray(slim.p) ? sharedArea(slim.i && slim.i.city, slim.p) : T.CITIES[slim.i && slim.i.city];
      if (!city || !Array.isArray(slim.d)) return null;
      const known = new Set(city.places.map((p) => p.id));
      const days = slim.d.slice(0, 7).map((ids) => (Array.isArray(ids) ? ids.filter((id) => known.has(id)).slice(0, 8) : []));
      const input = {
        city: city.name,
        days: days.length,
        budget: Math.max(0, Math.min(100000000, Number(slim.i.budget) || 0)),
        people: Math.max(1, Math.min(8, Number(slim.i.people) || 1)),
        prefs: (slim.i.prefs || []).filter((p) => T.PREFS.includes(p)),
      };
      const lodging = T.LODGING_TIERS.includes(slim.l) ? slim.l : "보통";
      const trip = { input, lodging, rain: !!slim.r, cheap: !!slim.c, relaxed: !!slim.x, days, notes: [] };
      if (city.anywhere) trip.cityData = city;
      return trip;
    } catch (error) {
      return null;
    }
  };
})();
