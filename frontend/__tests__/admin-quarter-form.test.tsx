/**
 * 새 분기 양식 — 검사와 자동 채우기.
 *
 * 검사는 양식과 백엔드 양쪽에 있습니다. 백엔드의 것이 진짜 방벽이고
 * (`backend/tests/test_admin_quarter_form.py`), 여기 있는 것은 날짜를
 * 고치러 서버까지 다녀오지 않기 위한 것입니다.
 *
 * fix-quarter-form-autofill (2026-10-14): 코드 하나(2026-Q4)로 이름과
 * 날짜가 채워지고, 손으로 고친 칸은 코드를 바꿔도 그대로이며, 날짜 고르개는
 * min/max로 순서를 지킵니다.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { addDays, autofill, parseQuarterCode } from "@/lib/quarter-code";

vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));

const { default: QuarterForm } = await import("@/app/admin/quarters/QuarterForm");

const onSubmit = vi.fn();
const onCancel = vi.fn();

function setup() {
  render(<QuarterForm busy={false} onSubmit={onSubmit} onCancel={onCancel} />);
}

/** 라벨로 칸을 찾습니다 — 화면에 보이는 문구 그대로. */
function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

/** 칸의 값을 통째로 바꿉니다(손으로 고친 것과 같습니다). */
function set(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date is faked: "today" is 2026-10-14 in Korea; userEvent's timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("분기 코드 읽기", () => {
  test.each([
    ["2026-Q1", "2026-01-01", "2026-03-31"],
    ["2026-Q2", "2026-04-01", "2026-06-30"],
    ["2026-Q3", "2026-07-01", "2026-09-30"],
    ["2026-Q4", "2026-10-01", "2026-12-31"],
    ["2028-Q1", "2028-01-01", "2028-03-31"],
    ["2027-q2", "2027-04-01", "2027-06-30"],
  ])("%s → %s – %s", (code, start, end) => {
    const parsed = parseQuarterCode(code)!;
    expect(parsed.start).toBe(start);
    expect(parsed.end).toBe(end);
    expect(parsed.code).toBe(code.toUpperCase());
  });

  test.each(["2026Q4", "26-Q4", "2026-Q5", "2026-Q0", "봄학기", ""])("%s는 코드가 아니다", (code) => {
    expect(parseQuarterCode(code)).toBeNull();
  });

  test("신청 기간: 오늘부터 분기 시작 + 30일까지, 끝난 분기면 분기 첫날부터", () => {
    expect(autofill(parseQuarterCode("2027-Q1")!, "2026-10-14")).toEqual({
      display_name: "2027 Q1",
      starts_at: "2027-01-01",
      ends_at: "2027-03-31",
      application_opens_at: "2026-10-14",
      application_closes_at: "2027-01-31",
    });
    // Today after the quarter ended → the quarter's start.
    expect(autofill(parseQuarterCode("2025-Q4")!, "2026-10-14").application_opens_at).toBe(
      "2025-10-01",
    );
    // Created mid-quarter: never a closing day before the opening day.
    const mid = autofill(parseQuarterCode("2026-Q4")!, "2026-11-20");
    expect(mid.application_opens_at).toBe("2026-11-20");
    expect(mid.application_closes_at).toBe("2026-11-20");
    expect(addDays("2028-02-15", 30)).toBe("2028-03-16");
  });
});

describe("새 분기 양식", () => {
  test("빈 양식은 보내지지 않고, 무엇이 비었는지 알려 준다", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("분기 코드를 적어 주세요.")).toBeTruthy();
    expect(screen.getByText("화면에 보일 이름을 적어 주세요.")).toBeTruthy();
    expect(screen.getByText("시작일을 골라 주세요.")).toBeTruthy();
  });

  test("코드 모양이 틀리면 다 적자마자 한국어로 알려 준다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2026-Q9");
    expect(await screen.findByText("2026-Q4 꼴로 입력해 주세요.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("올바른 코드를 적으면 이름과 날짜가 채워지고 그대로 보낼 수 있다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2026-q4");
    expect(field("화면에 보일 이름").value).toBe("2026 Q4");
    expect(field("분기 시작일").value).toBe("2026-10-01");
    expect(field("분기 종료일").value).toBe("2026-12-31");
    expect(field("신청 시작일").value).toBe("2026-10-14");
    expect(field("신청 마감일").value).toBe("2026-10-31");

    await user.click(screen.getByRole("button", { name: "분기 만들기" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [input, summary] = onSubmit.mock.calls[0];
    expect(input).toMatchObject({
      code: "2026-Q4",
      display_name: "2026 Q4",
      starts_at: "2026-10-01",
      ends_at: "2026-12-31",
      application_opens_at: "2026-10-14",
      application_closes_at: "2026-10-31",
      subsidy_limit_krw: 80000,
    });
    expect(summary).toContain("준비 상태");
  });

  test("손으로 고친 칸은 코드를 다시 바꿔도 덮어쓰지 않는다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2026-Q4");
    set("화면에 보일 이름", "2026 가을");
    set("신청 마감일", "2026-11-15");

    await user.clear(field("분기 코드"));
    await user.type(field("분기 코드"), "2027-Q1");

    // Changed by the new code:
    expect(field("분기 시작일").value).toBe("2027-01-01");
    expect(field("분기 종료일").value).toBe("2027-03-31");
    // Kept, because the admin typed them:
    expect(field("화면에 보일 이름").value).toBe("2026 가을");
    expect(field("신청 마감일").value).toBe("2026-11-15");
  });

  test("날짜 고르개는 순서가 어긋난 날을 고를 수 없게 한다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2026-Q4");
    expect(field("분기 종료일").min).toBe("2026-10-01");
    expect(field("신청 마감일").min).toBe("2026-10-14");
    expect(field("신청 마감일").max).toBe("2026-12-31");
    expect(field("신청 시작일").max).toBe("2026-12-31");

    // With no 신청 시작일, the closing day may not precede the quarter start.
    set("신청 시작일", "");
    expect(field("신청 마감일").min).toBe("2026-10-01");
  });

  test("종료일이 시작일보다 앞서면 보내지지 않는다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2027-Q1");
    set("분기 시작일", "2027-03-31");
    set("분기 종료일", "2027-01-01");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("종료일은 시작일보다 뒤여야 합니다.")).toBeTruthy();
  });

  test("신청 기간은 한쪽만 적을 수 없고, 둘 다 비워 둘 수는 있다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2027-Q1");
    set("신청 마감일", "");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByText("신청 기간은 시작일과 마감일을 함께 적거나 둘 다 비워 주세요."),
    ).toBeTruthy();

    set("신청 시작일", "");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      application_opens_at: null,
      application_closes_at: null,
    });
  });

  test("신청 마감일은 분기 종료일보다 뒤일 수 없다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2027-Q1");
    set("신청 마감일", "2027-06-30");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByText("신청 마감일은 분기 종료일보다 뒤일 수 없습니다."),
    ).toBeTruthy();
  });

  test("1인 지원금은 0 이상의 숫자여야 한다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2027-Q1");
    set("1인 지원금 (원)", "열만원");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("1인 지원금을 0 이상의 숫자로 적어 주세요.")).toBeTruthy();
  });
});
