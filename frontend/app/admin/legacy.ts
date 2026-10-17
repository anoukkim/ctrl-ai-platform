/**
 * 예전 Admin 주소 → 새 자리 (admin-consolidation v3). 북마크와 오래된
 * 링크가 살아 있도록, 예전 화면 파일이 이것으로 넘겨 줍니다. 주소의 다른
 * 값(`?quarter=`, `?status=` …)은 그대로 들고 갑니다.
 */

import { redirect } from "next/navigation";

import { LEGACY_ROUTES, tabHref } from "./sections";

type Params = Promise<Record<string, string | string[] | undefined>>;

export function legacyTarget(path: string, params: Record<string, string | string[] | undefined>): string {
  const target = LEGACY_ROUTES[path];
  if (!target) throw new Error(`예전 주소가 아닙니다: ${path}`);
  const base = tabHref(target.section, target.tab);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) query.append(key, one);
  }
  const rest = query.toString();
  return rest ? `${base}${base.includes("?") ? "&" : "?"}${rest}` : base;
}

export async function legacyRedirect(path: string, searchParams: Params): Promise<never> {
  redirect(legacyTarget(path, await searchParams));
}
