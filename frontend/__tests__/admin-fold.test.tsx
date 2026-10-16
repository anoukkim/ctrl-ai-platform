/**
 * 접는 섹션 (ui-improvements B): 한 묶음에서는 한 번에 하나만 펼쳐지고,
 * 펼친 것은 이 브라우저가 기억하며, 접힌 줄에는 요약이 보이고 내용은
 * 그려지지 않습니다. 묶음 밖에서는 보통 섹션입니다.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { forgetPrefsInMemory } from "@/lib/layout-prefs";

vi.mock("@/app/admin/admin.module.css", () => ({ default: {} }));

const { default: Fold, FoldGroup } = await import("@/app/admin/components/Fold");

function Screen({ defaultOpen }: { defaultOpen?: string | null }) {
  return (
    <FoldGroup screen="test" defaultOpen={defaultOpen}>
      <Fold id="a" title="첫째" summary="요약 A">
        <p>내용 A</p>
      </Fold>
      <Fold id="b" title="둘째" summary="요약 B">
        <p>내용 B</p>
      </Fold>
    </FoldGroup>
  );
}

beforeEach(() => {
  forgetPrefsInMemory();
  window.localStorage.clear();
});

describe("접는 섹션", () => {
  test("기본은 모두 접힘 — 요약만 보이고 내용은 없다", () => {
    render(<Screen />);
    expect(screen.getByText("요약 A")).toBeTruthy();
    expect(screen.queryByText("내용 A")).toBeNull();
    expect(screen.getByRole("button", { name: "첫째" }).getAttribute("aria-expanded")).toBe("false");
  });

  test("하나를 펼치면 다른 것은 접히고, 다시 누르면 접힌다", async () => {
    const user = userEvent.setup();
    render(<Screen defaultOpen="a" />);
    expect(screen.getByText("내용 A")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "둘째" }));
    expect(screen.getByText("내용 B")).toBeTruthy();
    expect(screen.queryByText("내용 A")).toBeNull();
    expect(screen.getByText("요약 A")).toBeTruthy();
    expect(screen.queryByText("요약 B")).toBeNull();

    await user.click(screen.getByRole("button", { name: "둘째" }));
    expect(screen.queryByText("내용 B")).toBeNull();
  });

  test("펼친 것은 기억되어 다음에 열 때 그대로다", async () => {
    const user = userEvent.setup();
    const first = render(<Screen />);
    await user.click(screen.getByRole("button", { name: "둘째" }));
    expect(window.localStorage.getItem("ctrlai.admin.test.open")).toBe("b");
    first.unmount();
    forgetPrefsInMemory();

    render(<Screen defaultOpen="a" />);
    expect(screen.getByText("내용 B")).toBeTruthy();
    expect(screen.queryByText("내용 A")).toBeNull();
  });

  test("모두 접어 둔 것도 기억되어 기본값을 이긴다", async () => {
    const user = userEvent.setup();
    const first = render(<Screen defaultOpen="a" />);
    await user.click(screen.getByRole("button", { name: "첫째" }));
    expect(window.localStorage.getItem("ctrlai.admin.test.open")).toBe("");
    first.unmount();
    forgetPrefsInMemory();

    render(<Screen defaultOpen="a" />);
    expect(screen.queryByText("내용 A")).toBeNull();
  });

  test("묶음 밖에서는 늘 펼쳐진 보통 섹션이다", () => {
    render(
      <Fold id="solo" title="혼자">
        <p>내용</p>
      </Fold>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "혼자" })).toBeTruthy();
    expect(screen.getByText("내용")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
