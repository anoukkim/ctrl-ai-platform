"use client";

/**
 * 화면 테마 — 어둡게(기본) / 밝게.
 *
 * 고른 값은 `<html data-theme>`에 붙고 localStorage(`ctrlai-theme`)에
 * 남습니다. 첫 화면은 `app/layout.tsx`의 작은 스크립트가 그리기 전에
 * 맞춰 두므로, 여기서는 그 뒤의 바꾸기만 맡습니다.
 *
 * 상태를 React 안에 따로 두지 않고 `data-theme` 자체를 읽습니다
 * (`useSyncExternalStore`). 값이 한 곳에만 있으니 단추와 화면이 서로
 * 다른 테마를 말할 일이 없습니다.
 */

import { useCallback, useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "./theme-boot";

export type Theme = "dark" | "light";

const CHANGE_EVENT = "ctrlai-theme-change";

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  // 다른 탭에서 바꾼 것도 따라갑니다.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    if (event.newValue === "light" || event.newValue === "dark") {
      document.documentElement.dataset.theme = event.newValue;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* 저장을 막아 둔 브라우저에서는 이번 방문 동안만 바뀝니다 */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  // 서버에서는 언제나 기본값(어둡게)으로 그립니다.
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);
  const toggle = useCallback(() => setTheme(readTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggle, setTheme };
}
