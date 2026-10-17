/**
 * 지금 돌고 있는 일 (running-state-calm) — Chat 답장과 Builder 만들기.
 *
 * 화면을 옮겨도 사이드바의 점과 목록의 "작업 중"이 남도록, 컴포넌트 밖에
 * 둡니다 — 모듈 하나가 이 탭의 상태입니다(Next의 화면 이동은 페이지를 다시
 * 불러오지 않으므로 남습니다). 새로 고침에는 남기지 않습니다: 그 일을
 * 지켜보던 연결이 끊겨 끝났는지 알 길이 없고, 모르는 것을 "도는 중"이라고
 * 보여 줄 수는 없으니까요. 끝나면 각 화면이 `finishRun`으로 지웁니다.
 *
 * background-runs (2026-10-17): 답장과 만들기는 이제 화면을 떠나도 서버에서
 * 계속돼요. 그래서 점은 **서버가 말해 주는 것**도 함께 보여 줘요 —
 * `useServerRunsSync`가 몇 초마다 `/api/chat/running`을 읽어 `setServerRuns`로
 * 채웁니다(새로 고침한 페이지도, 다른 탭에서 시작한 답장도). 이 탭이 직접
 * 시작한 일은 그 사이에도 바로 보이도록 `startRun`이 그대로 남아요.
 */

import { useEffect, useSyncExternalStore } from "react";

import { API_BASE_URL } from "./api";

export type RunKind = "chat" | "builder";

export interface Run {
  kind: RunKind;
  /** 대화 id 또는 프로젝트 id. 새 대화처럼 아직 없으면 0. */
  id: number;
  startedAt: number;
}

let local: Run[] = [];
let server: Run[] = [];
let runs: Run[] = [];
const listeners = new Set<() => void>();

function save() {
  // This tab's own runs first; the server's add what this tab did not start.
  runs = [...local, ...server.filter((run) => !local.some((mine) => mine.kind === run.kind && mine.id === run.id))];
  for (const listener of listeners) listener();
}

/** background-runs: what the server says is running for this member. */
export function setServerRuns(conversations: number[], projects: number[]): void {
  const now = Date.now();
  const keep = (kind: RunKind, id: number) =>
    server.find((run) => run.kind === kind && run.id === id)?.startedAt ?? now;
  const next: Run[] = [
    ...conversations.map((id) => ({ kind: "chat" as const, id, startedAt: keep("chat", id) })),
    ...projects.map((id) => ({ kind: "builder" as const, id, startedAt: keep("builder", id) })),
  ];
  const same =
    next.length === server.length && next.every((run, index) => run.kind === server[index].kind && run.id === server[index].id);
  if (same) return;
  server = next;
  save();
}

/**
 * The page stopped watching a run that goes on on the server (it left the
 * conversation): the dot stays, now as the server's — the next poll keeps
 * or clears it.
 */
export function handOverRun(kind: RunKind, id: number): void {
  const mine = local.find((run) => run.kind === kind && run.id === id);
  if (!mine) return;
  local = local.filter((run) => run !== mine);
  if (!server.some((run) => run.kind === kind && run.id === id)) server = [...server, mine];
  save();
}

/** How often the open page asks the server what is running. */
export const SERVER_POLL_MS = 5000;

/** Ask once: `{ conversations, projects }`, or null when it could not. */
export async function fetchServerRuns(): Promise<{ conversations: number[]; projects: number[] } | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat/running`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return (await response.json()) as { conversations: number[]; projects: number[] };
  } catch {
    return null;
  }
}

/**
 * Keeps the server's runs in the store while the page is open: at once,
 * every `SERVER_POLL_MS` while the tab is visible, and when it comes back
 * into view. Mounted once, in the app shell.
 */
export function useServerRunsSync(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const pull = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const found = await fetchServerRuns();
      if (!stopped && found) setServerRuns(found.conversations, found.projects);
    };
    void pull();
    const timer = window.setInterval(() => void pull(), SERVER_POLL_MS);
    const onVisible = () => void pull();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled]);
}

/** Ask the server now (after a reply ends or 중지). */
export async function refreshServerRuns(): Promise<void> {
  const found = await fetchServerRuns();
  if (found) setServerRuns(found.conversations, found.projects);
}

export function startRun(kind: RunKind, id: number, startedAt = Date.now()): void {
  local = [...local.filter((run) => !(run.kind === kind && run.id === id)), { kind, id, startedAt }];
  save();
}

export function finishRun(kind: RunKind, id: number): void {
  const next = local.filter((run) => !(run.kind === kind && run.id === id));
  // The server's word on it is stale too: the next poll brings it back if
  // it really is still running.
  const nextServer = server.filter((run) => !(run.kind === kind && run.id === id));
  if (next.length === local.length && nextServer.length === server.length) return;
  local = next;
  server = nextServer;
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
  local = [];
  server = [];
  save();
}
