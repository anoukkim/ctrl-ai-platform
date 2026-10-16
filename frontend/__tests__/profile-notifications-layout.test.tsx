/**
 * ui-improvements — Profile › 알림 카드의 두 줄.
 *
 * 오너의 스크린샷: "사용 알림 표시" 체크박스가 제목 위에 따로 떠 있고, "띠링
 * 소리"는 체크박스와 글이 어긋나 있었다. 이제 두 줄이 같은 모양 — 제목과
 * 한 줄 설명은 왼쪽, 스위치는 오른쪽 — 이고, 라벨이 스위치에 묶여 있어
 * 키보드와 화면 읽기 프로그램에서 그대로 쓸 수 있다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

const setEnabled = vi.fn().mockResolvedValue(undefined);
const setSound = vi.fn();

vi.mock("@/app/components/SpendFeedbackProvider", () => ({
  useSpendFeedback: () => ({ enabled: true, setEnabled, sound: false, setSound }),
}));
vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({ state: { phase: "loading" }, signOut: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/components/MyQuarterProvider", () => ({ useMyQuarter: () => ({ state: { phase: "loading" } }) }));

const { NotificationSettings } = await import("@/app/profile/AccountIdentity");

const CSS = readFileSync(join(process.cwd(), "app", "profile", "profile.module.css"), "utf-8");

function declaration(selector: string, property: string): string | null {
  const body = CSS.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, "m"))?.[1];
  if (!body) throw new Error(`.${selector} 규칙을 찾지 못했습니다`);
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "m"));
  return match ? match[1].trim() : null;
}

describe("Profile › 알림", () => {
  test("두 스위치가 각자의 제목에 묶여 있고, 같은 줄 모양을 쓴다", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);

    const notify = screen.getByRole("switch", { name: /사용 알림 표시/ });
    const sound = screen.getByRole("switch", { name: /띠링 소리/ });
    expect(notify).toHaveProperty("checked", true);
    expect(sound).toHaveProperty("checked", false);
    expect(notify.closest("div")?.className).toBe(sound.closest("div")?.className);

    await user.click(screen.getByText("띠링 소리"));
    expect(setSound).toHaveBeenCalledWith(true);
    await user.click(notify);
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  test("CSS 계약: 글은 왼쪽, 스위치는 오른쪽, 줄마다 같은 간격", () => {
    expect(declaration("switchRow", "justify-content")).toBe("space-between");
    expect(declaration("switchRow", "align-items")).toBe("center");
    expect(declaration("switch", "flex")).toBe("none");
  });
});
