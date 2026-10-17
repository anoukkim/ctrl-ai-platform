/**
 * 오로라 배경 (running-state-calm) — 그림 카드와 미리보기 칸 안의 아주 은은한
 * 빛. Profile › 오로라 배경으로 끌 수 있어요(기기마다, 기본은 켜짐). 움직임
 * 줄이기를 켠 기기에서는 이 스위치와 상관없이 그리지 않습니다(CSS).
 */

import { useSyncExternalStore } from "react";

export const AURORA_KEY = "ctrlai.aurora";

const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(AURORA_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAurora(on: boolean): void {
  try {
    window.localStorage.setItem(AURORA_KEY, on ? "1" : "0");
  } catch {
    /* 기억하지 못해도 이 화면에서는 바뀌어요 */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === AURORA_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAurora(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
