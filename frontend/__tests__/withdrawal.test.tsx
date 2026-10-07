/**
 * 회원 탈퇴 화면 — Profile의 탈퇴와 Admin › 회원 상세의 탈퇴 영역.
 *
 * 규칙 자체(지원금 해제, 환불 대기, 30일)는 백엔드 테스트가 증명합니다.
 * 여기서 증명하는 것은 화면이 그 규칙을 **말하는지**입니다.
 *
 *   1. 탈퇴 양식보다 먼저 작업물 내려받기를 안내하고, 두 라이브러리로
 *      가는 링크가 있다.
 *   2. 비밀번호 없이는 진행되지 않고, 확인을 누르기 전에는 아무것도
 *      바뀌지 않는다.
 *   3. 확인창은 실제로 일어날 일을 한 줄씩 적는다 — 개인 충전 잔액이
 *      있으면 환불 대기라는 것까지.
 *   4. 비밀번호가 틀리면 확인창 안에서 그 이유를 보여 준다.
 *   5. Admin에는 환불 대기, 복구, 환불 완료 기록이 보이고, 복구는 백엔드가
 *      허락할 때만 보인다.
 *
 * 백엔드는 부르지 않습니다. 호출은 가짜로 바꾸고 불렸는지만 봅니다.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { withdrawalEffects, type Withdrawal, type WithdrawalPreview } from "@/lib/account";
import { ApiError } from "@/lib/api";
import type { MemberDetail } from "@/lib/admin";

const PREVIEW: WithdrawalPreview = {
  released_krw: 90_000,
  personal_remaining_krw: 15_000,
  pending_top_ups: 0,
  published_apps: 1,
  published_videos: 2,
  builder_projects: 3,
  video_projects: 4,
  grace_period_days: 30,
  refund_hold: true,
  quarters: ["2026 Q4"],
};

const NOTHING_LEFT: WithdrawalPreview = {
  ...PREVIEW,
  released_krw: 0,
  personal_remaining_krw: 0,
  refund_hold: false,
  quarters: [],
};

const WITHDRAWAL: Withdrawal = {
  id: 1,
  withdrawn_at: "2026-10-07T03:00:00Z",
  grace_ends_at: "2026-11-06T03:00:00Z",
  self_initiated: true,
  published_work: "keep",
  released_krw: 90_000,
  refund_status: "pending",
  refund_amount_krw: 15_000,
  refund_recorded_at: null,
  refund_reference: "",
  restored_at: null,
  anonymised_at: null,
  can_restore: true,
};

const getMyWithdrawalPreview = vi.fn();
const withdrawMyAccount = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/account", async (importOriginal) => {
  // 문구(withdrawalEffects, 라벨)는 진짜를 씁니다. 가짜로 두면 화면에
  // 실제로 어떤 한국어가 나오는지 증명하지 못합니다.
  const actual = await importOriginal<typeof import("@/lib/account")>();
  return {
    ...actual,
    getMyWithdrawalPreview: (...args: unknown[]) => getMyWithdrawalPreview(...args),
    withdrawMyAccount: (...args: unknown[]) => withdrawMyAccount(...args),
  };
});

vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({ state: { phase: "anonymous" }, refresh, signOut: vi.fn() }),
}));

beforeEach(() => {
  getMyWithdrawalPreview.mockReset().mockResolvedValue(PREVIEW);
  withdrawMyAccount.mockReset().mockResolvedValue(WITHDRAWAL);
  refresh.mockReset();
});

// ------------------------------------------------------------ 문장

describe("withdrawalEffects", () => {
  test("로그아웃, 해제할 지원금, 환불 대기, 30일을 한 줄씩 적는다", () => {
    const lines = withdrawalEffects(PREVIEW, "keep");

    expect(lines[0]).toContain("로그인할 수 없습니다");
    expect(lines.join("\n")).toContain("동아리 지원 90,000원(2026 Q4)");
    expect(lines.join("\n")).toContain("개인 충전 잔액 15,000원");
    expect(lines.join("\n")).toContain("환불 대기");
    expect(lines.join("\n")).toContain("게시한 작품 3개는 공개된 채로 남고");
    expect(lines.join("\n")).toContain("30일 안에는 관리자가 계정을 복구할 수 있습니다");
    expect(lines.join("\n")).toContain("사용 기록은");
  });

  test("게시 취소를 고르면 무엇을 내리는지 적는다", () => {
    const text = withdrawalEffects(PREVIEW, "unpublish").join("\n");
    expect(text).toContain("게시한 작품 3개(앱 1, 영상 2)를 모두 게시 취소합니다");
    expect(text).not.toContain("공개된 채로");
  });

  test("잔액이 없으면 환불 이야기를 하지 않는다", () => {
    const text = withdrawalEffects(NOTHING_LEFT, "keep").join("\n");
    expect(text).not.toContain("환불");
    expect(text).toContain("해제할 금액이 없습니다");
  });

  test("확인 전인 충전 요청도 환불 대기로 적는다", () => {
    const text = withdrawalEffects(
      { ...NOTHING_LEFT, pending_top_ups: 1, refund_hold: true },
      "keep",
    ).join("\n");
    expect(text).toContain("확인 전인 충전 요청 1건");
    expect(text).toContain("환불 대기");
  });

  test("Admin이 처리할 때는 주어가 그 회원이다", () => {
    expect(withdrawalEffects(PREVIEW, "keep", "admin")[0]).toMatch(/^이 회원은/);
  });
});

// ------------------------------------------------------------ Profile

describe("Profile — 회원 탈퇴", () => {
  async function openSection() {
    const { default: WithdrawalSection } = await import("@/app/profile/WithdrawalSection");
    const user = userEvent.setup();
    render(<WithdrawalSection />);
    await user.click(screen.getByRole("button", { name: "회원 탈퇴 진행" }));
    await screen.findByText(/개인 충전 잔액 15,000원/);
    return user;
  }

  test("처음에는 접혀 있어 양식이 보이지 않는다", async () => {
    const { default: WithdrawalSection } = await import("@/app/profile/WithdrawalSection");
    render(<WithdrawalSection />);
    expect(screen.queryByLabelText("비밀번호 확인")).toBeNull();
    expect(getMyWithdrawalPreview).not.toHaveBeenCalled();
  });

  test("먼저 작업물을 내려받으라고 안내하고, 두 라이브러리로 연결한다", async () => {
    await openSection();

    const note = screen.getByRole("note");
    expect(note.textContent).toContain("먼저 작업물을 내려받아 두세요");
    const links = within(note).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/video", "/builder"]);
    expect(note.textContent).toContain("코드 다운로드 (ZIP)");
  });

  test("개인 충전 잔액이 있으면 확인 전에 경고한다", async () => {
    await openSection();
    expect(screen.getByRole("alert").textContent).toContain("환불 대기");
  });

  test("비밀번호가 없으면 진행되지 않는다", async () => {
    await openSection();
    expect((screen.getByRole("button", { name: "탈퇴하기" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("확인창이 일어날 일을 적고, 확인을 누르기 전에는 아무것도 바뀌지 않는다", async () => {
    const user = await openSection();
    await user.click(screen.getByLabelText("모두 게시 취소"));
    await user.type(screen.getByLabelText("비밀번호 확인"), "memberpassword");
    await user.click(screen.getByRole("button", { name: "탈퇴하기" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("listitem").length).toBeGreaterThanOrEqual(5);
    expect(dialog.textContent).toContain("로그인할 수 없습니다");
    expect(dialog.textContent).toContain("90,000원");
    expect(dialog.textContent).toContain("모두 게시 취소");
    expect(withdrawMyAccount).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "탈퇴하기" }));

    expect(withdrawMyAccount).toHaveBeenCalledWith("memberpassword", "unpublish");
    expect(await screen.findByText("탈퇴가 완료되었습니다")).toBeTruthy();
    expect(screen.getByText(/15,000원은 관리자가 환불을 처리합니다/)).toBeTruthy();
  });

  test("비밀번호가 틀리면 확인창 안에서 알려 준다", async () => {
    withdrawMyAccount.mockRejectedValue(new ApiError("비밀번호가 올바르지 않습니다.", 400));
    const user = await openSection();
    await user.type(screen.getByLabelText("비밀번호 확인"), "wrong");
    await user.click(screen.getByRole("button", { name: "탈퇴하기" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "탈퇴하기" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "비밀번호가 올바르지 않습니다.",
    );
    expect(screen.queryByText("탈퇴가 완료되었습니다")).toBeNull();
  });
});

// ------------------------------------------------------------ Admin

describe("Admin — 회원 상세의 탈퇴 영역", () => {
  const MEMBER: MemberDetail = {
    user_id: 7,
    username: "yuri",
    display_name: "김유리",
    email: "yuri@example.com",
    role: "member",
    account_status: "former",
    created_at: "2026-01-01T00:00:00Z",
    quarters: [],
    personal: null,
    top_ups: [],
    audit: [],
    withdrawal: WITHDRAWAL,
  };

  async function renderPanel(member: MemberDetail) {
    const { default: WithdrawalPanel } = await import("@/app/admin/members/[id]/WithdrawalPanel");
    const askToConfirm = vi.fn();
    render(
      <WithdrawalPanel
        askToConfirm={askToConfirm}
        busy={false}
        member={member}
        run={vi.fn()}
        onError={vi.fn()}
      />,
    );
    return askToConfirm;
  }

  test("환불 대기와 두 작업이 보인다", async () => {
    const askToConfirm = await renderPanel(MEMBER);

    expect(screen.getByText("환불 대기")).toBeTruthy();
    expect(screen.getByText("유예 기간 끝")).toBeTruthy();
    expect(screen.getByRole("button", { name: "복구" })).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "환불 완료 기록" }));
    expect(askToConfirm).toHaveBeenCalledTimes(1);
    expect(askToConfirm.mock.calls[0][0].confirmLabel).toBe("환불 완료 기록");
  });

  test("복구는 백엔드가 허락할 때만 보인다", async () => {
    await renderPanel({
      ...MEMBER,
      withdrawal: { ...WITHDRAWAL, can_restore: false, refund_status: "recorded" },
    });

    expect(screen.queryByRole("button", { name: "복구" })).toBeNull();
    expect(screen.queryByRole("button", { name: "환불 완료 기록" })).toBeNull();
    expect(screen.getByText("유예 기간이 지나 복구할 수 없습니다.")).toBeTruthy();
  });

  test("탈퇴하지 않은 회원에게는 탈퇴 처리만 있다", async () => {
    await renderPanel({ ...MEMBER, account_status: "active", withdrawal: null });

    expect(screen.getByRole("button", { name: "탈퇴 처리" })).toBeTruthy();
    expect(
      (screen.getByLabelText("공개 유지 (탈퇴 회원으로 표시)") as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "복구" })).toBeNull();
  });
});
