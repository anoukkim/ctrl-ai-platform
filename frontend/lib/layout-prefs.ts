/**
 * 작업 공간의 배치 기억 (quality-tuning Q3) — 마지막 탭, 접어 둔 판.
 *
 * 이 브라우저에만 남는 편의 기능이라 localStorage에 둡니다. 사생활 보호
 * 창이나 막힌 저장소에서는 읽기·쓰기가 실패할 수 있으니, 같은 값을 이
 * 페이지의 메모리에도 둡니다 — 기억하지 못해도 화면은 그대로 동작해야
 * 합니다. 화면은 `useSyncExternalStore`로 읽습니다(lib/theme.ts와 같은
 * 방식): 서버 렌더링과 첫 화면은 기본값, 그다음 브라우저의 값.
 */

import { useSyncExternalStore } from "react";

const EVENT = "ctrlai-layout-pref";

/** 저장소가 막혀도 이 페이지에서는 기억합니다. 접두사를 붙인 전체 키로 둡니다. */
const memory = new Map<string, string>();

function subscribePrefs(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * 한 영역의 기억 — 접두사 하나에 읽기·쓰기·훅 한 벌. Builder 작업 공간이
 * 처음 썼고(`ctrlai.builder.`), Admin 화면의 펼친 섹션(ui-improvements B)이
 * 같은 방식을 `ctrlai.admin.`으로 씁니다. 메모리와 이벤트는 함께 씁니다.
 */
export function makePrefs(prefix: string) {
  function readPref(key: string): string | null {
    const full = prefix + key;
    if (memory.has(full)) return memory.get(full)!;
    try {
      return window.localStorage.getItem(full);
    } catch {
      return null;
    }
  }

  function writePref(key: string, value: string): void {
    const full = prefix + key;
    memory.set(full, value);
    try {
      window.localStorage.setItem(full, value);
    } catch {
      /* 메모리에는 남았습니다 */
    }
    window.dispatchEvent(new Event(EVENT));
  }

  /** 기억해 둔 값. 서버와 첫 화면에서는 null. */
  function usePref(key: string): string | null {
    return useSyncExternalStore(
      subscribePrefs,
      () => readPref(key),
      () => null,
    );
  }

  return { readPref, writePref, usePref };
}

const builderPrefs = makePrefs("ctrlai.builder.");
export const readPref = builderPrefs.readPref;
export const writePref = builderPrefs.writePref;
export const usePref = builderPrefs.usePref;

/** Admin 화면의 기억 — 어느 섹션을 펼쳐 두었는지. */
export const adminPrefs = makePrefs("ctrlai.admin.");

/** 테스트에서 페이지를 새로 연 것처럼 메모리를 비웁니다. */
export function forgetPrefsInMemory(): void {
  memory.clear();
}

/**
 * 화면 폭 조건이 맞는지. 서버와 첫 화면에서는 `false`(넓은 화면)이고,
 * `matchMedia`가 없는 곳(테스트의 jsdom)에서도 계속 `false`입니다.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}
