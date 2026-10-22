/**
 * Admin › System › 연결 상태 한 줄 (ui-improvements B).
 *
 * 서버·DB는 /api/health에서, 외부 서비스는 마지막 기록에서 색을 정하고,
 * 화면을 열 때 외부 서비스를 부르지 않으며, "모두 확인"을 눌러야 네 곳을
 * 차례로 확인하고 다시 읽습니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ProviderStatus } from "@/lib/admin";

const fetchHealth = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchHealth: (...args: unknown[]) => fetchHealth(...args),
}));
const listProviders = vi.fn();
const checkProvider = vi.fn();
vi.mock("@/lib/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin")>()),
  listProviders: () => listProviders(),
  checkProvider: (key: string) => checkProvider(key),
}));
vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));

const { default: HealthStrip, providerTone } = await import("@/app/admin/system/HealthStrip");

function provider(over: Partial<ProviderStatus>): ProviderStatus {
  return {
    key: "claude",
    name: "Claude",
    purpose: "",
    setting: "CLAUDE_PROVIDER",
    mode: "mock",
    is_mock: true,
    has_key: false,
    last_success_at: null,
    last_success_label: "",
    last_error_at: null,
    last_error_message: "",
    balance_label: null,
    ...over,
  };
}

const FOUR = [
  provider({ key: "claude", name: "Claude", is_mock: false, has_key: true, last_success_at: "2026-10-16T01:00:00Z" }),
  provider({ key: "video", name: "Higgsfield" }),
  provider({ key: "github", name: "GitHub", is_mock: false, has_key: true, last_error_at: "2026-10-16T02:00:00Z", last_error_message: "401" }),
  provider({ key: "youtube", name: "YouTube" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  fetchHealth.mockResolvedValue({
    status: "ok",
    service: "ctrl-ai-backend",
    version: "0.1.0",
    environment: "development",
    database: { status: "ok", detail: null },
  });
  listProviders.mockResolvedValue(FOUR);
  checkProvider.mockResolvedValue({ key: "x", ok: true, message: "ok" });
});

describe("연결 상태 한 줄", () => {
  test("서버·DB·외부 서비스 여섯 점, 색은 기록대로, 문제 수를 센다", async () => {
    render(<HealthStrip />);

    await waitFor(() => expect(screen.getByTestId("health-api").getAttribute("data-tone")).toBe("ok"));
    expect(screen.getByTestId("health-db").getAttribute("data-tone")).toBe("ok");
    await waitFor(() => expect(screen.getByTestId("health-claude").getAttribute("data-tone")).toBe("ok"));
    expect(screen.getByTestId("health-video").getAttribute("data-tone")).toBe("muted");
    expect(screen.getByTestId("health-github").getAttribute("data-tone")).toBe("error");
    expect(screen.getByTestId("health-youtube").getAttribute("data-tone")).toBe("muted");
    expect(screen.getByTestId("health-overall").textContent).toBe("문제 1곳");
    // 화면을 열기만 해서는 외부로 아무것도 보내지 않습니다.
    expect(checkProvider).not.toHaveBeenCalled();
  });

  test("서버에 닿지 않으면 서버와 DB가 빨갛다", async () => {
    fetchHealth.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<HealthStrip />);

    await waitFor(() => expect(screen.getByTestId("health-api").getAttribute("data-tone")).toBe("error"));
    expect(screen.getByTestId("health-db").getAttribute("data-tone")).toBe("error");
    expect(screen.getByTestId("health-db").textContent).toContain("서버 너머라 알 수 없음");
  });

  test("DB만 죽은 것은 따로 보인다", async () => {
    fetchHealth.mockResolvedValue({
      status: "degraded",
      service: "ctrl-ai-backend",
      version: "0.1.0",
      environment: "development",
      database: { status: "unavailable", detail: "OperationalError" },
    });
    render(<HealthStrip />);

    await waitFor(() => expect(screen.getByTestId("health-api").getAttribute("data-tone")).toBe("ok"));
    expect(screen.getByTestId("health-db").getAttribute("data-tone")).toBe("error");
    expect(screen.getByTestId("health-db").textContent).toContain("OperationalError");
  });

  test("모두 확인은 네 곳을 차례로 확인하고 기록을 다시 읽는다", async () => {
    const user = userEvent.setup();
    render(<HealthStrip />);
    const button = await screen.findByRole("button", { name: "모두 확인" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    await user.click(button);

    await waitFor(() => expect(checkProvider).toHaveBeenCalledTimes(4));
    expect(checkProvider.mock.calls.map((call) => call[0])).toEqual(["claude", "video", "github", "youtube"]);
    await waitFor(() => expect(listProviders).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/확인함 ·/)).toBeTruthy();
  });

  test("서버에 잠깐 닿지 않아도 다시 물어 돌아온다 (fix-health-strip-retry)", async () => {
    // 배포 중 몇 초, 또는 네트워크가 잠깐 끊긴 사이에 연 화면: 첫 요청은
    // 실패하고 두 번째가 성공합니다. 새로 고치지 않아도 초록으로 돌아와야 합니다.
    fetchHealth.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<HealthStrip retryMs={20} refreshMs={60_000} />);

    await waitFor(() => expect(screen.getByTestId("health-api").getAttribute("data-tone")).toBe("error"));
    expect(screen.getByTestId("health-api").textContent).toContain("다시 확인 중");

    await waitFor(() => expect(screen.getByTestId("health-api").getAttribute("data-tone")).toBe("ok"));
    expect(screen.getByTestId("health-db").getAttribute("data-tone")).toBe("ok");
    expect(fetchHealth).toHaveBeenCalledTimes(2);
  });

  test("닿지 않는 동안 마지막으로 닿은 때를 적는다", async () => {
    render(<HealthStrip retryMs={20} refreshMs={20} />);
    await waitFor(() => expect(screen.getByTestId("health-api").getAttribute("data-tone")).toBe("ok"));

    fetchHealth.mockRejectedValue(new TypeError("Failed to fetch"));
    await waitFor(() => expect(screen.getByTestId("health-api").getAttribute("data-tone")).toBe("error"));
    expect(screen.getByTestId("health-api").textContent).toContain("마지막 연결");
  });

  test("색의 규칙: mock은 회색, 키 없는 실제 연결은 빨강, 오류 뒤 성공은 초록", () => {
    expect(providerTone(provider({ is_mock: true }))).toBe("muted");
    expect(providerTone(provider({ is_mock: false, has_key: false }))).toBe("error");
    expect(
      providerTone(provider({ is_mock: false, has_key: true, last_error_at: "2026-10-16T01:00:00Z", last_success_at: "2026-10-16T02:00:00Z" })),
    ).toBe("ok");
    expect(
      providerTone(provider({ is_mock: false, has_key: true, last_error_at: "2026-10-16T03:00:00Z", last_success_at: "2026-10-16T02:00:00Z" })),
    ).toBe("error");
  });
});
