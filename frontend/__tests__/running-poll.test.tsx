/**
 * running-poll-idle — the running poll is cheap while nothing is running.
 *
 * One signed-in tab used to ask `/api/chat/running` every few seconds all
 * day, hidden or not, with no run anywhere. Now: every 2 s only while a
 * dot is showing, every 30 s otherwise, nothing while the tab is hidden,
 * and once at the moment it is visible again.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { FAST_POLL_MS, IDLE_POLL_MS, finishRun, resetRuns, startRun, useServerRunsSync } from "@/lib/running";

function Sync() {
  useServerRunsSync();
  return null;
}

const fetchMock = vi.fn();

function answer(conversations: number[], projects: number[] = []) {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ conversations, projects }), { status: 200 })));
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  resetRuns();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the running poll keeps pace with what is running", () => {
  test("a run is listed: once at mount, then every 2 s", async () => {
    answer([3]);
    render(<Sync />);
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/chat/running");
    await tick(FAST_POLL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(FAST_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test("nothing is running: once at mount, then every 30 s", async () => {
    answer([]);
    render(<Sync />);
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(IDLE_POLL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(IDLE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("a message sent from this tab re-times the long wait to 2 s; its end goes back to 30 s", async () => {
    answer([]);
    render(<Sync />);
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(10_000);
    act(() => startRun("chat", 0));
    await tick(FAST_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(FAST_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    act(() => finishRun("chat", 0));
    await tick(FAST_POLL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await tick(IDLE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("the server's own answer sets the pace: a run found at 30 s turns the poll fast, its end turns it slow", async () => {
    answer([]);
    render(<Sync />);
    await tick(0);
    answer([8]);
    await tick(IDLE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(FAST_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    answer([]);
    await tick(FAST_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await tick(FAST_POLL_MS * 5);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("the running poll stops with the tab", () => {
  test("hidden: no request at all; visible again: one at once, then the usual pace", async () => {
    answer([3]);
    render(<Sync />);
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => setVisibility("hidden"));
    await tick(IDLE_POLL_MS * 4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The window's focus follows the switch; the request is already on its way.
    act(() => window.dispatchEvent(new Event("focus")));
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(FAST_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("mounted while hidden: nothing until the tab shows", async () => {
    answer([]);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    render(<Sync />);
    await tick(IDLE_POLL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    act(() => setVisibility("visible"));
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("unmounted: the waiting poll is dropped", async () => {
    answer([3]);
    const { unmount } = render(<Sync />);
    await tick(0);
    unmount();
    await tick(FAST_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
