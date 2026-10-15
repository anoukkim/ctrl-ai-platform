/**
 * app-platform P2 — 앱 연결 화면과 Profile › 연결된 앱.
 *
 * 연결 화면: 앱 이름·만든 사람·할 수 있는 일·AI 1회 비용, 허용하면 백엔드가
 * 준 주소로, 거절하면 앱(셸)에게만 알리고 닫기. 주소의 값은 모양부터 거릅니다.
 * 연결된 앱: 목록과 연결 끊기(확인 후).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import ConnectScreen from "@/app/apps/connect/ConnectScreen";
import ConnectedAppsSection from "@/app/profile/ConnectedAppsSection";
import { safeReturnPath } from "@/app/components/CurrentUserProvider";

const getConnectInfo = vi.fn();
const allowApp = vi.fn();
const listAppConsents = vi.fn();
const revokeAppConsent = vi.fn();

vi.mock("@/lib/app-platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app-platform")>();
  return {
    ...actual,
    getConnectInfo: (...args: unknown[]) => getConnectInfo(...args),
    allowApp: (...args: unknown[]) => allowApp(...args),
    listAppConsents: () => listAppConsents(),
    revokeAppConsent: (...args: unknown[]) => revokeAppConsent(...args),
  };
});

vi.mock("@/app/components/SiteProvider", () => ({
  useSite: () => ({ apps_base_url: "https://apps.example.test" }),
}));

vi.mock("@/app/components/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

const INFO = {
  name: "영수증 읽기",
  owner_name: "민지",
  mode: "app",
  scopes: [
    { key: "profile", label: "내 표시 이름을 이 앱에 알려 줘요" },
    { key: "ai", label: "이 앱에서 Claude를 써요" },
  ],
  ai_estimate_krw: 3,
  call_cap_krw: 200,
  connected: false,
};

const STATE = "abcdefghijklmnopqrstuvwx";

function setLocation(search: string) {
  window.history.replaceState(null, "", `/apps/connect${search}`);
}

beforeEach(() => {
  getConnectInfo.mockReset().mockResolvedValue(INFO);
  allowApp.mockReset();
  listAppConsents.mockReset();
  revokeAppConsent.mockReset();
});

const ORIGINAL_LOCATION = window.location;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { value: ORIGINAL_LOCATION, configurable: true });
});

describe("앱 연결 화면", () => {
  test("앱 이름, 만든 사람, 할 수 있는 일, AI 1회 비용을 보여 준다", async () => {
    setLocation(`?app=abcdefgh23&state=${STATE}`);
    render(<ConnectScreen />);

    expect(await screen.findByRole("heading", { name: /영수증 읽기/ })).toBeTruthy();
    expect(screen.getByText(/만든 사람: 민지/)).toBeTruthy();
    expect(screen.getByText(/1회 약 3원 \(최대 200원\)/)).toBeTruthy();
    expect(getConnectInfo).toHaveBeenCalledWith("abcdefgh23");
  });

  test("허용하면 백엔드가 준 주소로 간다", async () => {
    setLocation(`?app=abcdefgh23&state=${STATE}`);
    allowApp.mockResolvedValue({ redirect_url: "https://apps.example.test/abcdefgh23/_ctrlai/callback?code=c&state=s" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign, search: `?app=abcdefgh23&state=${STATE}` }, configurable: true });
    const user = userEvent.setup();
    render(<ConnectScreen />);

    await user.click(await screen.findByRole("button", { name: "허용" }));
    expect(allowApp).toHaveBeenCalledWith("abcdefgh23", STATE);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://apps.example.test/abcdefgh23/_ctrlai/callback?code=c&state=s"));
  });

  test("거절하면 앱 주소의 출처로만 알리고 끝낸다", async () => {
    setLocation(`?app=abcdefgh23&state=${STATE}`);
    const postMessage = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true });
    const user = userEvent.setup();
    render(<ConnectScreen />);

    await user.click(await screen.findByRole("button", { name: "거절" }));
    expect(postMessage).toHaveBeenCalledWith({ ctrlai: "login", ok: false }, "https://apps.example.test");
    expect(screen.getByRole("heading", { name: "거절했어요" })).toBeTruthy();
    expect(allowApp).not.toHaveBeenCalled();
  });

  test("모양이 틀린 주소는 백엔드에 묻지도 않는다", async () => {
    setLocation("?app=../../x&state=short");
    render(<ConnectScreen />);
    expect(await screen.findByText(/연결 주소가 올바르지 않아요/)).toBeTruthy();
    expect(getConnectInfo).not.toHaveBeenCalled();
  });
});

describe("Profile › 연결된 앱", () => {
  test("목록과 연결 끊기(확인 뒤)", async () => {
    listAppConsents.mockResolvedValue([
      {
        id: 7,
        app_name: "영수증 읽기",
        app_url: "https://apps.example.test/abcdefgh23/",
        scopes: INFO.scopes,
        granted_at: new Date().toISOString(),
      },
    ]);
    revokeAppConsent.mockResolvedValue({ detail: "연결을 끊었어요." });
    const user = userEvent.setup();
    render(<ConnectedAppsSection />);

    expect(await screen.findByTestId("connected-app")).toBeTruthy();
    expect(screen.getByText(/표시 이름 · AI 사용/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "연결 끊기" }));
    expect(revokeAppConsent).not.toHaveBeenCalled();
    const buttons = await screen.findAllByRole("button", { name: "연결 끊기" });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(revokeAppConsent).toHaveBeenCalledWith(7));
  });
});

describe("로그인 뒤 돌아갈 곳", () => {
  test("이 사이트 안의 경로만", () => {
    expect(safeReturnPath("/apps/connect?app=abcdefgh23&state=x")).toBe("/apps/connect?app=abcdefgh23&state=x");
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});
