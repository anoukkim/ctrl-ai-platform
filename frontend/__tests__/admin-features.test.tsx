/**
 * Admin › System › 기능 열기 (owner-polish 6): the Video Generator switch
 * shows its state, asks before changing, sends the note, and re-reads.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { FeatureSwitch } from "@/lib/admin";

const LOCKED: FeatureSwitch = { key: "video", label: "Video Generator", open: false, note: "", set_by_username: "", set_at: null };

const listFeatures = vi.fn();
const setFeature = vi.fn();
vi.mock("@/lib/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin")>()),
  listFeatures: () => listFeatures(),
  setFeature: (...args: unknown[]) => setFeature(...args),
}));
vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));

const { default: FeaturePanel } = await import("@/app/admin/system/FeaturePanel");

beforeEach(() => {
  vi.clearAllMocks();
  listFeatures.mockResolvedValue([LOCKED]);
  setFeature.mockResolvedValue({ ...LOCKED, open: true, note: "2027 Q1부터", set_by_username: "admin", set_at: "2026-10-16T00:00:00Z" });
});

describe("기능 열기", () => {
  test("잠김으로 시작하고, 열기 전에 묻고, 메모와 함께 보낸 뒤 다시 읽는다", async () => {
    const user = userEvent.setup();
    render(<FeaturePanel />);

    const row = await screen.findByTestId("feature-video");
    expect(row.textContent).toContain("잠김 · 다음 단계에서 열려요");
    expect(row.textContent).toContain("아직 바꾼 적 없음");

    await user.click(screen.getByRole("button", { name: "회원에게 열기" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Video Generator를 회원에게 열까요?");
    expect(setFeature).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox"), "2027 Q1부터");
    const confirms = screen.getAllByRole("button", { name: "회원에게 열기" });
    await user.click(confirms[confirms.length - 1]);

    await waitFor(() => expect(setFeature).toHaveBeenCalledWith("video", true, "2027 Q1부터"));
    await waitFor(() => expect(listFeatures).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  test("열려 있으면 잠그기 단추가 빨갛게, 바꾼 사람과 때가 보인다", async () => {
    listFeatures.mockResolvedValue([{ ...LOCKED, open: true, note: "시험", set_by_username: "admin", set_at: "2026-10-16T00:00:00Z" }]);
    render(<FeaturePanel />);

    const row = await screen.findByTestId("feature-video");
    expect(row.textContent).toContain("열림");
    expect(row.textContent).toContain("시험");
    expect(row.textContent).toContain("admin");
    expect(screen.getByRole("button", { name: "잠그기" }).className).toContain("btn-danger");
  });
});
