/**
 * 지금 돌고 있는 일 (running-state-calm) — Chat 답장과 Builder 만들기.
 *
 * 화면을 옮겨도 사이드바의 점과 목록의 "작업 중"이 남도록, 컴포넌트 밖에
 * 둡니다(모듈 하나 = 탭 하나의 상태). 새로 고침에도 남도록 sessionStorage에
 * 적되, 오래된 것(`STALE_MS`)은 버립니다 — 탭을 닫았다 열면 끝난 일이
 * 영원히 돌고 있는 것처럼 보이면 안 되니까요. 실제로 끝났는지는 각 화면이
 * 끝날 때(`finishRun`) 지웁니다.
 */

import { useSyncExternalStore } from "react";

export type RunKind = "chat" | "builder";

export interface Run {
  kind: RunKind;
  /** 대화 id 또는 프로젝트 id. 새 대화처럼 아직 없으면 0. */
  id: number;
  startedAt: number;
}

const KEY = "ctrlai.running";
export const STALE_MS = 30 * 60 * 1000;

let runs: Run[] = load();
const listeners = new Set<() => void>();

function load(): Run[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (run): run is Run =>
        run &&
        (run.kind === "chat" || run.kind === "builder") &&
        typeof run.id === "number" &&
        typeof run.startedAt === "number" &&
        now - run.startedAt < STALE_MS,
    );
  } catch {
    return [];
  }
}

function save() {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(runs));
  } catch {
    /* 기억하지 못해도 이 탭에서는 보여요 */
  }
  for (const listener of listeners) listener();
}

export function startRun(kind: RunKind, id: number, startedAt = Date.now()): void {
  runs = [...runs.filter((run) => !(run.kind === kind && run.id === id)), { kind, id, startedAt }];
  save();
}

export function finishRun(kind: RunKind, id: number): void {
  const next = runs.filter((run) => !(run.kind === kind && run.id === id));
  if (next.length === runs.length) return;
  runs = next;
  save();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: Run[] = [];

export function useRuns(): Run[] {
  return useSyncExternalStore(
    subscribe,
    () => runs,
    () => EMPTY,
  );
}

export function isRunning(list: Run[], kind: RunKind, id?: number): boolean {
  return list.some((run) => run.kind === kind && (id === undefined || run.id === id));
}

/** Tests only. */
export function resetRuns(): void {
  runs = [];
  save();
}
