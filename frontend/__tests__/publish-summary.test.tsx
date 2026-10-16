/**
 * publish-summary — 게시 창의 미리 채움 (owner, 2026-10-16).
 *
 * 창이 열리면 "요약하는 중"이 보이고, Claude가 쓴 설명이 빈 칸을 채웁니다.
 * 이미 적힌 설명은 두고 "Claude 요약으로 바꾸기"만 보이며, 타이핑을 시작한
 * 칸은 늦게 온 요약이 덮지 않습니다. 업데이트 게시면 메모도 채우고, 못
 * 받으면 빈 칸 그대로 게시할 수 있습니다.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getPublishSummary = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return { ...actual, getPublishSummary: (...args: unknown[]) => getPublishSummary(...args) };
});

const { default: PublishDialog } = await import("@/app/builder/[projectId]/PublishDialog");

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function open(initial: { name: string; description: string; note: string }, publishedVersion: number | null = null) {
  const onConfirm = vi.fn();
  render(
    <PublishDialog
      projectId={7}
      publishedVersion={publishedVersion}
      nextVersion={publishedVersion === null ? 1 : publishedVersion + 2}
      initial={initial}
      busy={false}
      error={null}
      onClose={() => {}}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

beforeEach(() => {
  getPublishSummary.mockReset();
});

describe("게시 창의 Claude 요약", () => {
  test("요약하는 중 → 빈 설명 칸이 채워지고, 요약이라는 표시가 붙는다", async () => {
    const pending = deferred<{ description: string; note: string; cached: boolean; model: string }>();
    getPublishSummary.mockReturnValue(pending.promise);
    open({ name: "메모장", description: "", note: "" });

    expect(screen.getByTestId("summary-state").textContent).toContain("요약하는 중");
    expect(screen.getByText(/설명은 Claude가 미리 써 줘요 \(무료\)/)).toBeTruthy();
    expect(getPublishSummary).toHaveBeenCalledWith(7);

    await act(async () => {
      pending.resolve({ description: "할 일을 적고 지우는 앱이에요.", note: "", cached: false, model: "fast" });
    });
    expect((screen.getByLabelText(/CtrlAIApps에 보일 설명/) as HTMLTextAreaElement).value).toBe("할 일을 적고 지우는 앱이에요.");
    expect(screen.getByTestId("summary-state").textContent).toContain("Claude가 쓴 설명이에요");
    // 게시 버튼이 바로 눌린다.
    expect((screen.getByRole("button", { name: "게시하기" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("이미 적힌 설명은 두고 '요약으로 바꾸기'만 보여 준다", async () => {
    getPublishSummary.mockResolvedValue({ description: "Claude 설명", note: "", cached: true, model: "fast" });
    const user = userEvent.setup();
    open({ name: "메모장", description: "내가 쓴 설명", note: "" });
    const replace = await screen.findByRole("button", { name: "Claude 요약으로 바꾸기" });
    expect((screen.getByLabelText(/CtrlAIApps에 보일 설명/) as HTMLTextAreaElement).value).toBe("내가 쓴 설명");
    await user.click(replace);
    expect((screen.getByLabelText(/CtrlAIApps에 보일 설명/) as HTMLTextAreaElement).value).toBe("Claude 설명");
  });

  test("타이핑을 시작한 칸은 늦게 온 요약이 덮지 않는다", async () => {
    const pending = deferred<{ description: string; note: string; cached: boolean; model: string }>();
    getPublishSummary.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    open({ name: "메모장", description: "", note: "" });
    await user.type(screen.getByLabelText(/CtrlAIApps에 보일 설명/), "직접");
    await act(async () => {
      pending.resolve({ description: "Claude 설명", note: "", cached: false, model: "fast" });
    });
    expect((screen.getByLabelText(/CtrlAIApps에 보일 설명/) as HTMLTextAreaElement).value).toBe("직접");
    expect(screen.getByRole("button", { name: "Claude 요약으로 바꾸기" })).toBeTruthy();
  });

  test("적었다가 지운 칸도 회원이 손댄 칸이라 요약이 덮지 않는다", async () => {
    const pending = deferred<{ description: string; note: string; cached: boolean; model: string }>();
    getPublishSummary.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    open({ name: "메모장", description: "", note: "" });
    const field = screen.getByLabelText(/CtrlAIApps에 보일 설명/);
    await user.type(field, "직접");
    await user.clear(field);
    await act(async () => {
      pending.resolve({ description: "Claude 설명", note: "", cached: false, model: "fast" });
    });
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  test("업데이트 게시면 메모도 채운다", async () => {
    getPublishSummary.mockResolvedValue({ description: "Claude 설명", note: "댓글 기능을 넣었어요", cached: false, model: "fast" });
    open({ name: "메모장", description: "", note: "" }, 3);
    await screen.findByText("Claude가 쓴 설명이에요 — 마음에 안 들면 고치세요.");
    expect((screen.getByLabelText(/업데이트 메모/) as HTMLInputElement).value).toBe("댓글 기능을 넣었어요");
  });

  test("못 받으면 빈 칸 그대로 — 직접 적어 게시할 수 있다", async () => {
    getPublishSummary.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    const onConfirm = open({ name: "메모장", description: "", note: "" });
    await screen.findByText("요약을 받지 못했어요 — 직접 적어 주세요.");
    await user.type(screen.getByLabelText(/CtrlAIApps에 보일 설명/), "내 설명");
    await user.click(screen.getByRole("button", { name: "게시하기" }));
    expect(onConfirm).toHaveBeenCalledWith({ name: "메모장", description: "내 설명", note: "" });
  });
});
