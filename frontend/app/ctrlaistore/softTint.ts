/**
 * 표지 그림의 부드러운 색.
 *
 * 예시 데이터의 표지는 채도가 높은 두 색 그라데이션(`artwork`)입니다.
 * 그대로 칠하면 카드 여섯 장이 서로 다른 형광색으로 다투고, 밝은 테마에서는
 * 화면에서 그것만 보입니다. 그래서 **색상(hue)만** 가져오고, 밝기와 채도는
 * 모두 같은 값으로 고정합니다:
 *
 *   oklch(.42 .09 H) → oklch(.30 .07 H+20)
 *
 * OKLCH는 사람 눈에 고른 색 공간이라, 색상이 달라도 카드들의 밝기가 같아
 * 보입니다. 데이터는 바꾸지 않습니다 — 같은 앱은 언제나 같은 색입니다.
 * CtrlAITube 썸네일도 같은 함수를 씁니다.
 */

/** "#rrggbb"의 OKLCH 색상각(0–359). */
export function hueOf(hex: string): number {
  const value = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(value)) return 260;

  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return Math.round(((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360);
}

/** 표지 배경 — 두 색 중 첫 색의 색상으로 만든 부드러운 그라데이션. */
export function softTint(artwork: readonly [string, string], angle = 140): string {
  const hue = hueOf(artwork[0]);
  return `linear-gradient(${angle}deg, oklch(0.42 0.09 ${hue}), oklch(0.3 0.07 ${(hue + 20) % 360}))`;
}
