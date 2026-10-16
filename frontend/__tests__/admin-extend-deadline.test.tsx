/**
 * 신청 기한 연장 (ui-improvements B).
 *
 * 창이 날짜를 오늘과 분기 종료일 사이로 묶는지, 저장이 PATCH 한 번으로
 * 가는지, 신청을 마감한 분기에서는 다시 열기까지 같이 보내는지를 봅니다.
 * 진짜 방벽은 백엔드입니다 (`backend/tests/test_admin_quarter_form.py`).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { Quarter } from "@/lib/quarters";

const updateQuarter = vi.fn();
vi.mock("@/lib/quarters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quarters")>();
  return { ...actual, updateQuarter: (...args: unknown[]) => updateQuarter(...args) };
});
vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));
vi.mock("@/app/components/confirm-dialog.module.css", () => ({ default: {} }));

const { default: ExtendDeadlineDialog } = await import("@/app/admin/quarters/ExtendDeadlineDialog");

const OPEN: Quarter = {
  id: 3,
  code: "2026-Q4",
  display_name: "2026 Q4",
  starts_at: "2026-10-01",
  ends_at: "2026-12-31",
  application_opens_at: "2026-09-20",
  application_closes_at: "2026-10-20",
  status: "application_open",
  subsidy_limit_krw: 80_000,
};

const onClose = vi.fn();
const onExtended = vi.fn();

function dateField(): HTMLInputElement {
  return screen.getByLabelText("새 신청 마감일") as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateQuarter.mockResolvedValue({ ...OPEN });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("신청 기한 연장", () => {
  test("고르개는 지금 마감일부터 분기 종료일까지로 묶이고, 저장은 마감일만 보냅니다", async () => {
    render(<ExtendDeadlineDialog quarter={OPEN} onClose={onClose} onExtended={onExtended} />);

    expect(screen.getByRole("heading", { name: "2026 Q4 신청 기한 연장" })).toBeTruthy();
    // The day after the current deadline: the dialog opens on a valid date,
    // with no alert and the button enabled.
    expect(dateField().min).toBe("2026-10-21");
    expect(dateField().value).toBe("2026-10-21");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(dateField().max).toBe("2026-12-31");

    fireEvent.change(dateField(), { target: { value: "2026-11-05" } });
    await userEvent.click(screen.getByRole("button", { name: "기한 연장" }));

    await waitFor(() => expect(updateQuarter).toHaveBeenCalledTimes(1));
    expect(updateQuarter).toHaveBeenCalledWith(3, { application_closes_at: "2026-11-05" });
    expect(onExtended).toHaveBeenCalledWith("2026 Q4의 신청 마감일을 2026.11.05로 늦췄습니다.");
  });

  test("종료일 뒤 날짜는 버튼이 꺼지고 이유가 보입니다", () => {
    render(<ExtendDeadlineDialog quarter={OPEN} onClose={onClose} onExtended={onExtended} />);

    fireEvent.change(dateField(), { target: { value: "2027-01-10" } });
    expect(screen.getByRole("alert").textContent).toContain("분기 종료일보다 뒤일 수 없습니다");
    expect((screen.getByRole("button", { name: "기한 연장" }) as HTMLButtonElement).disabled).toBe(true);
    expect(updateQuarter).not.toHaveBeenCalled();
  });

  test("신청을 마감한 분기는 다시 열면서 오늘 이후로 기한을 잡습니다", async () => {
    const active: Quarter = { ...OPEN, status: "active", application_closes_at: "2026-10-10" };
    render(<ExtendDeadlineDialog quarter={active} onClose={onClose} onExtended={onExtended} />);

    expect(screen.getByRole("heading", { name: "2026 Q4 신청 다시 열기" })).toBeTruthy();
    // 지난 마감일은 하한이 못 되고, 오늘(KST)부터입니다.
    expect(dateField().min).toBe("2026-10-16");
    expect(screen.getByText(/다시 신청할 수 있게/)).toBeTruthy();

    fireEvent.change(dateField(), { target: { value: "2026-10-30" } });
    await userEvent.click(screen.getByRole("button", { name: "신청 다시 열기" }));

    await waitFor(() => expect(updateQuarter).toHaveBeenCalledTimes(1));
    expect(updateQuarter).toHaveBeenCalledWith(3, {
      application_closes_at: "2026-10-30",
      status: "application_open",
    });
    expect(onExtended).toHaveBeenCalledWith(
      "2026 Q4의 신청을 다시 열었습니다. 마감일은 2026.10.30입니다.",
    );
  });

  test("백엔드가 거절하면 창이 열린 채로 그 문장을 보여 줍니다", async () => {
    updateQuarter.mockRejectedValueOnce(new ApiError("신청 마감일은 오늘이거나 그 뒤여야 합니다.", 400));
    render(<ExtendDeadlineDialog quarter={OPEN} onClose={onClose} onExtended={onExtended} />);

    fireEvent.change(dateField(), { target: { value: "2026-11-05" } });
    await userEvent.click(screen.getByRole("button", { name: "기한 연장" }));

    expect((await screen.findByRole("alert")).textContent).toContain("오늘이거나 그 뒤여야");
    expect(onExtended).not.toHaveBeenCalled();
  });
});
