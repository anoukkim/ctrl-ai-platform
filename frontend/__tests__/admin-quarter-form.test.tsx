/**
 * 새 분기 양식이 잘못된 값을 걸러 내는지.
 *
 * 검사는 양식과 백엔드 양쪽에 있습니다. 백엔드의 것이 진짜 방벽이고
 * (`backend/tests/test_admin_quarter_form.py`), 여기 있는 것은 날짜를
 * 고치러 서버까지 다녀오지 않기 위한 것입니다.
 *
 * 그래서 여기서 보는 것은 두 가지입니다: 잘못된 값으로는 보내지지
 * 않는다, 그리고 **무엇이 잘못됐는지 한국어로 적힌다**. "잘못된
 * 값입니다"는 고칠 방법을 알려 주지 않습니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

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

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field("분기 코드"), "2027-Q1");
  await user.type(field("화면에 보일 이름"), "2027 Q1");
  await user.type(field("분기 시작일"), "2027-01-01");
  await user.type(field("분기 종료일"), "2027-03-31");
}

describe("새 분기 양식", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("빈 양식은 보내지지 않고, 무엇이 비었는지 알려 준다", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("분기 코드를 적어 주세요.")).toBeTruthy();
    expect(screen.getByText("화면에 보일 이름을 적어 주세요.")).toBeTruthy();
    expect(screen.getByText("시작일을 골라 주세요.")).toBeTruthy();
  });

  test("분기 코드의 모양을 검사한다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "봄학기");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("2026-Q1 꼴로 적어 주세요.")).toBeTruthy();
  });

  test("종료일이 시작일보다 앞서면 보내지지 않는다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2027-Q1");
    await user.type(field("화면에 보일 이름"), "2027 Q1");
    await user.type(field("분기 시작일"), "2027-03-31");
    await user.type(field("분기 종료일"), "2027-01-01");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText("종료일은 시작일보다 뒤여야 합니다.")).toBeTruthy();
  });

  test("신청 기간은 한쪽만 적을 수 없다", async () => {
    const user = userEvent.setup();
    setup();

    await fillValid(user);
    await user.type(field("신청 시작일"), "2026-12-01");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "신청 기간은 시작일과 마감일을 함께 적거나 둘 다 비워 주세요.",
      ),
    ).toBeTruthy();
  });

  test("신청 마감일은 분기 종료일보다 뒤일 수 없다", async () => {
    const user = userEvent.setup();
    setup();

    await fillValid(user);
    await user.type(field("신청 시작일"), "2026-12-01");
    await user.type(field("신청 마감일"), "2027-06-30");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByText("신청 마감일은 분기 종료일보다 뒤일 수 없습니다."),
    ).toBeTruthy();
  });

  test("한도는 0 이상의 숫자여야 한다", async () => {
    const user = userEvent.setup();
    setup();

    await fillValid(user);
    await user.clear(field("1인 한도 (원)"));
    await user.type(field("1인 한도 (원)"), "열만원");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByText("1인 한도를 0 이상의 숫자로 적어 주세요."),
    ).toBeTruthy();
  });

  test("제대로 채우면 확인 요약과 함께 넘어간다", async () => {
    const user = userEvent.setup();
    setup();

    await fillValid(user);
    await user.type(field("신청 시작일"), "2026-12-01");
    await user.type(field("신청 마감일"), "2026-12-31");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const [input, summary] = onSubmit.mock.calls[0];
    expect(input).toMatchObject({
      code: "2027-Q1",
      display_name: "2027 Q1",
      starts_at: "2027-01-01",
      ends_at: "2027-03-31",
      application_opens_at: "2026-12-01",
      application_closes_at: "2026-12-31",
      subsidy_limit_krw: 100000,
    });
    // 확인창에 적힐 요약 — 무엇이 만들어지는지 한국어로.
    expect(summary).toContain("2027 Q1");
    expect(summary).toContain("준비 상태");
  });

  test("신청 기간은 둘 다 비워 둘 수 있다", async () => {
    /** 분기를 먼저 만들고 신청 날짜는 나중에 정하는 흐름입니다. */
    const user = userEvent.setup();
    setup();

    await fillValid(user);
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      application_opens_at: null,
      application_closes_at: null,
    });
  });

  test("코드는 대문자로 보냅니다", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(field("분기 코드"), "2027-q1");
    await user.type(field("화면에 보일 이름"), "2027 Q1");
    await user.type(field("분기 시작일"), "2027-01-01");
    await user.type(field("분기 종료일"), "2027-03-31");
    await user.click(screen.getByRole("button", { name: "분기 만들기" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].code).toBe("2027-Q1");
  });
});
