// 여행 일정 메이커 — "다른 곳": 국내 어디든 (실제 AI + 지도 검색).
//
// 1) 지도 검색으로 그 지역을 찾아요 — 한국 안에서만. CTRL+AI가 OpenStreetMap 검색(Photon)을
//    대신 물어봐 주는 주소(/_ctrlai/places)를 써요: 한꺼번에 많이 물으면 검색 서버가 막는데,
//    CTRL+AI가 1초에 한 번씩 묻고 답을 기억해 둬요.
// 2) Claude에게 그 지역의 갈 만한 곳을 한 번 물어봐요 (방문자의 지원금, 버튼을 눌렀을 때만).
// 3) Claude가 고른 이름을 하나씩 지도 검색으로 찾아 진짜 위치를 붙여요.
//    위치는 Claude가 아니라 지도 검색이 정해요 — 못 찾은 곳은 빼요.
// 그다음 일정은 서울·부산·제주와 똑같이 데모 플래너가 짜요 (추가 비용 없음).

(function () {
  const T = window.TRIP;
  T.ANYWHERE = "__anywhere";

  const SEARCH = "/_ctrlai/places"; // CTRL+AI 밖(내려받아 연 파일)에서는 없어요
  const NEAR_KM = 40; // 지역 중심에서 이보다 먼 검색 결과는 다른 동네예요

  const PLACES_SCHEMA = {
    type: "object",
    required: ["places"],
    additionalProperties: false,
    properties: {
      places: {
        type: "array",
        minItems: 6,
        maxItems: 16,
        items: {
          type: "object",
          required: ["name", "pref", "indoor", "minutes", "cost", "note"],
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            pref: { type: "string", enum: T.PREFS },
            indoor: { type: "boolean" },
            minutes: { type: "integer" },
            cost: { type: "integer" },
            note: { type: "string" },
          },
        },
      },
    },
  };

  // Claude에게 보내는 부탁 — 가격 표시(estimate)와 실제 호출이 같은 내용을 써요.
  T.anywhereOptions = (name) => ({
    system:
      "국내 여행지의 갈 만한 곳을 골라 주는 도우미예요. 지도에서 이름으로 찾을 수 있는 실제 장소만, 공식 이름 그대로 적어요. " +
      "취향(pref)이 고르게 섞이게 12~16곳: 맛집은 식당·시장, 휴식은 카페·찻집도 좋아요. " +
      "minutes는 머무는 분(30~180), cost는 1인 비용(원, 무료면 0), note는 한국어 한 줄 소개.",
    prompt: `여행지: ${name} (대한민국)`,
    json: PLACES_SCHEMA,
    maxTokens: 1600,
  });

  const toRad = (d) => (d * Math.PI) / 180;
  function km(a, b) {
    const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  // 지도 검색 한 번 — 한국 안의 결과만, 가까운 곳 우선.
  async function search(query, near, kinds) {
    const params = new URLSearchParams({ q: query });
    if (near) {
      params.set("lat", near.lat);
      params.set("lon", near.lng);
    }
    const busy = new Error("지도 검색이 잠시 바빠요. 1분쯤 뒤에 다시 해 보세요.");
    const response = await fetch(`${SEARCH}?${params}`).catch(() => {
      throw busy; // 너무 자주 물으면 검색 서버가 잠깐 막아요
    });
    if (!response.ok) throw busy;
    const data = await response.json();
    return (data.places || [])
      .filter((hit) => hit.country === "KR" && (!kinds || kinds.includes(hit.kind)))
      .filter((hit) => !near || km(near, hit) <= NEAR_KM);
  }

  const pause = (ms) => new Promise((done) => setTimeout(done, ms));

  // Claude가 고른 장소 하나의 위치: "이름 지역" → 안 되면 "이름"만, 실패하면 1초 쉬고 한 번 더.
  async function locate(w, name, area) {
    for (const query of [`${w.name} ${name}`, String(w.name)]) {
      let hits = await search(query, area).catch(() => null);
      if (hits === null) {
        await pause(1000);
        hits = await search(query, area).catch(() => []);
      }
      if (hits.length) return { w, hit: hits[0] };
    }
    return null;
  }

  // 지역 찾기: "강릉" → 강릉시의 중심.
  T.findArea = async function (name) {
    const places = ["city", "town", "county", "village", "borough", "suburb", "island"];
    const hits = (await search(name, null, places)).concat(await search(name));
    return hits[0] || null;
  };

  // 장소 목록이 들어간 "도시" — 서울·부산·제주와 같은 모양이라 플래너와 지도가 그대로 써요.
  T.areaCity = function (name, places) {
    const lats = places.map((p) => p.lat);
    const lngs = places.map((p) => p.lng);
    const [s, n, w, e] = [Math.min(...lats) - 0.02, Math.max(...lats) + 0.02, Math.min(...lngs) - 0.02, Math.max(...lngs) + 0.02];
    const dy = (n - s) * 0.25;
    const dx = (e - w) * 0.25;
    return {
      name,
      anywhere: true,
      move: { label: "버스·택시", speed: 25, wait: 10, perPerson: 1500, perKm: 0 },
      lodging: { 알뜰: 55000, 보통: 100000, 좋음: 180000 },
      // 진짜 경계 대신 장소들을 둘러싼 팔각형 — 단순 지도와 작은 그림에만 써요.
      outline: [[n, w + dx], [n, e - dx], [n - dy, e], [s + dy, e], [s, e - dx], [s, w + dx], [s + dy, w], [n - dy, w]],
      water: [],
      waterLabel: "지도 검색",
      places,
    };
  };

  // 버튼 한 번에: 지역 찾기 → Claude가 고르기 → 하나씩 위치 찾기.
  T.buildArea = async function (name, sdk, onProgress) {
    const area = await T.findArea(name);
    if (!area) throw new Error(`국내에서 '${name}'을(를) 찾지 못했어요. 시·군 이름으로 적어 보세요.`);
    const result = await sdk.ai.ask(T.anywhereOptions(name));
    const wanted = (result.json && Array.isArray(result.json.places) ? result.json.places : []).slice(0, 16);
    // 하나씩 차례로 — CTRL+AI가 1초에 한 번씩 묻기 때문에 처음 찾는 지역은 십여 초 걸려요.
    const found = [];
    for (const w of wanted) {
      if (onProgress) onProgress(found.length + 1, wanted.length);
      found.push(await locate(w, name, area));
    }
    const places = found.filter(Boolean).map(({ w, hit }, i) => ({
      id: `a${String(i + 1).padStart(2, "0")}`,
      name: String(w.name).slice(0, 30),
      pref: T.PREFS.includes(w.pref) ? w.pref : "문화",
      indoor: Boolean(w.indoor),
      lat: hit.lat,
      lng: hit.lng,
      minutes: Math.max(30, Math.min(180, Math.round(Number(w.minutes) / 5) * 5 || 60)),
      cost: Math.max(0, Math.min(200000, Math.round(Number(w.cost) / 100) * 100 || 0)),
      note: String(w.note || "").slice(0, 60),
    }));
    if (places.length < 5) throw new Error(`'${name}'에서 지도에 찾은 장소가 ${places.length}곳뿐이에요. 더 큰 지역 이름으로 해 보세요.`);
    return { city: T.areaCity(name, places), krw: result.chargedKrw, asked: wanted.length };
  };
})();
