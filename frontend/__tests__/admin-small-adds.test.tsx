/**
 * admin-consolidation v3 (4) — 공지 띠, 알림 기준, 백업, 비밀번호 재설정.
 *
 * 증명하는 것:
 *   - 공지 띠는 /api/site의 `banner`를 따른다: 숨기면 띠도 <html data-beta>도
 *     없고, 문구는 관리자 것이며, 의견 보내기 링크도 끌 수 있다.
 *   - Dashboard 알림은 알림 기준을 따르고, 늦은 백업을 알린다(개발 환경 제외).
 *   - 임시 비밀번호는 확인한 뒤 한 번 보이고, 닫으면 사라진다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AdminDashboard, MemberDetail } from "@/lib/admin";
import type { SiteInfo } from "@/lib/site";

const fetchSite = vi.fn<() => Promise<SiteInfo>>();
const fetchCurrentUser = vi.fn();
const resetMemberPassword = vi.fn();

vi.mock("@/lib/site", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/site")>()),
  fetchSite: () => fetchSite(),
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  fetchCurrentUser: () => fetchCurrentUser(),
}));
vi.mock("@/lib/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin")>()),
  resetMemberPassword: (...args: unknown[]) => resetMemberPassword(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: BetaBanner } = await import("@/app/components/BetaBanner");
const { default: CurrentUserProvider } = await import("@/app/components/CurrentUserProvider");
const { default: SiteProvider } = await import("@/app/components/SiteProvider");
const { alertsOf } = await import("@/app/admin/AdminDashboard");
const { backupLight } = await import("@/app/admin/system/HealthStrip");
const { default: PasswordReset } = await import("@/app/admin/members/[id]/PasswordReset");

function site(overrides: Partial<SiteInfo> = {}): SiteInfo {
  return {
    environment: "beta",
    is_development: false,
    is_beta: true,
    data_location_notice: "",
    top_ups_enabled: false,
    google_login: false,
    test_mode: { chat: false, builder: false, video: false, community: false },
    ...overrides,
  };
}

beforeEach(() => {
  fetchSite.mockReset();
  fetchCurrentUser.mockReset();
  resetMemberPassword.mockReset();
  fetchCurrentUser.mockResolvedValue({ id: 2, username: "yuri", display_name: "유리", role: "member", account_status: "active" });
  delete document.documentElement.dataset.beta;
});

function withSite(children: React.ReactNode) {
  return (
    <SiteProvider>
      <CurrentUserProvider>{children}</CurrentUserProvider>
    </SiteProvider>
  );
}

describe("공지 띠", () => {
  test("관리자의 문구로 보이고, 의견 보내기 링크를 끌 수 있다", async () => {
    fetchSite.mockResolvedValue(site({ banner: { shown: true, text: "10월 25일 점검이 있어요", feedback_link: false } }));
    render(withSite(<BetaBanner />));
    const banner = await screen.findByRole("region", { name: "베타 안내" });
    expect(banner.textContent).toContain("10월 25일 점검이 있어요");
    await waitFor(() => expect(fetchCurrentUser).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "의견 보내기" })).toBeNull();
    expect(document.documentElement.dataset.beta).toBe("");
  });

  test("숨기면 베타여도 띠가 없고 높이도 0이다", async () => {
    fetchSite.mockResolvedValue(site({ banner: { shown: false, text: "x", feedback_link: true } }));
    render(withSite(<BetaBanner />));
    await waitFor(() => expect(fetchSite).toHaveBeenCalled());
    await waitFor(() => expect(fetchCurrentUser).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "베타 안내" })).toBeNull();
    expect(document.documentElement.dataset.beta).toBeUndefined();
  });

  test("베타가 아니어도 켜면 꼬리표 없이 공지로 보인다", async () => {
    fetchSite.mockResolvedValue(site({ is_beta: false, banner: { shown: true, text: "공지예요", feedback_link: true } }));
    render(withSite(<BetaBanner />));
    const banner = await screen.findByRole("region", { name: "공지" });
    expect(banner.textContent).not.toContain("베타");
  });
});

function dashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    failing_providers: [],
    is_development: false,
    wallet_alerts: [{ user_id: 3, username: "minji", display_name: "민지", used_pct: 72, remaining_krw: 22_400 }],
    anthropic_month: { month: "2026-10", used_usd: 85, budget_usd: 100, used_pct: 85 },
    alert_thresholds: { wallet_pct: 70, month_pct: 90, backup_hours: 24 },
    backups: [
      { kind: "local", file_name: "ctrlai-20261015-031500.sql.gz", size_bytes: 1, at: "2026-10-15T03:15:00Z", late: true },
      { kind: "offsite", file_name: null, size_bytes: 0, at: null, late: true },
    ],
    ...overrides,
  } as AdminDashboard;
}

describe("알림 기준과 백업", () => {
  test("알림은 기준을 따르고 늦은 백업을 알린다; 설정하지 않은 서버 밖 백업은 조용하다", () => {
    const alerts = alertsOf(dashboard());
    expect(alerts.find((a) => a.key === "wallet-3")?.note).toContain("70% 넘음");
    // 85%: under this quarter's 90%, so informational.
    expect(alerts.find((a) => a.key === "anthropic")?.tone).toBe("info");
    expect(alerts.find((a) => a.key === "backup")?.text).toContain("24시간");
    expect(alerts.find((a) => a.key === "backup-offsite")).toBeUndefined();
  });

  test("개발 환경에는 백업 알림이 없고, 연결 상태의 백업 점은 회색이다", () => {
    expect(alertsOf(dashboard({ is_development: true, backups: [] })).find((a) => a.key === "backup")).toBeUndefined();
    expect(backupLight([], true)?.tone).toBe("muted");
    expect(backupLight([], false)?.tone).toBe("error");
    const fresh = backupLight([{ kind: "local", file_name: "f", size_bytes: 1, at: "2026-10-17T03:15:00Z", late: false }], false);
    expect(fresh?.tone).toBe("ok");
  });
});

describe("비밀번호 재설정", () => {
  test("확인하면 임시 비밀번호가 한 번 보이고, 닫으면 사라진다", async () => {
    resetMemberPassword.mockResolvedValue({ username: "minji", temporary_password: "abcd-EFGH-2345-wxyz", sessions_ended: 2 });
    const askToConfirm = vi.fn();
    const run = vi.fn(async (_text: string, action: () => Promise<unknown>) => {
      await action();
    });
    const member = { user_id: 3, display_name: "민지" } as MemberDetail;
    render(<PasswordReset member={member} busy={false} run={run} askToConfirm={askToConfirm} />);

    await userEvent.click(screen.getByRole("button", { name: "비밀번호 재설정" }));
    expect(resetMemberPassword).not.toHaveBeenCalled();
    const request = askToConfirm.mock.calls[0][0];
    expect(request.danger).toBe(true);
    await request.onConfirm("");

    const shown = await screen.findByTestId("temporary-password");
    expect(shown.textContent).toContain("abcd-EFGH-2345-wxyz");
    expect(shown.textContent).toContain("로그인 2곳");
    expect(resetMemberPassword).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByTestId("temporary-password")).toBeNull();
  });
});
