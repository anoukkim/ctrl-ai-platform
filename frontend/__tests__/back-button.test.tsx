import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const back = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, push }) }));

const { default: BackButton } = await import("@/app/components/BackButton");
const nav = await import("@/lib/in-app-nav");

describe("돌아가기", () => {
  beforeEach(() => {
    back.mockReset();
    push.mockReset();
  });

  test("opened straight from outside, it goes home", () => {
    render(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: /돌아가기/ }));
    expect(push).toHaveBeenCalledWith("/");
    expect(back).not.toHaveBeenCalled();
  });

  test("after moving inside the site, it goes back to that screen", () => {
    nav.notePath("/ctrlaistore");
    nav.notePath("/help/apps");
    window.history.pushState({}, "", "/help/apps");
    render(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: /돌아가기/ }));
    expect(back).toHaveBeenCalled();
  });
});
