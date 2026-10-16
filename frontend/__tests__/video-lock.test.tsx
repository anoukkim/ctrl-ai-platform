/**
 * owner-polish 6 — the Video Generator locked for members until the 관리자
 * opens it. The gate shows "다음 단계에서 열려요" to members, lets the admin
 * through with a notice, and disappears once /api/site says it is open.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const site = vi.hoisted(() => ({ video_open: false }));
const who = vi.hoisted(() => ({ is_admin: false }));

vi.mock("@/app/components/SiteProvider", () => ({
  useSite: () => ({ video_open: site.video_open, test_mode: { video: false } }),
  useSiteLoaded: () => true,
}));
vi.mock("@/app/components/CurrentUserProvider", () => ({
  useCurrentUser: () => ({
    state: { phase: "authenticated", user: { id: 1, username: "x", display_name: "x", is_admin: who.is_admin } },
  }),
}));

const { default: VideoGate } = await import("@/app/video/VideoGate");

describe("Video Generator 잠금", () => {
  test("회원: 목록·검색·단추 대신 가운데 자물쇠 하나와 짧은 안내 (오너의 모양)", () => {
    site.video_open = false;
    who.is_admin = false;
    const { container } = render(
      <VideoGate>
        <p>영상 목록</p>
      </VideoGate>,
    );

    expect(screen.queryByText("영상 목록")).toBeNull();
    expect(screen.getByText("Video Generator는 다음 단계에서 열려요")).toBeTruthy();
    expect(screen.getByText(/지금은 준비 중이에요/)).toBeTruthy();
    expect(container.querySelectorAll("svg.lucide-lock")).toHaveLength(1);
    // Nothing else: no buttons, no links for a member.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByTestId("video-admin-locked-notice")).toBeNull();
  });

  test("관리자: 같은 화면에 'Admin › System에서 열 수 있어요' 한 줄만 더", () => {
    site.video_open = false;
    who.is_admin = true;
    render(
      <VideoGate>
        <p>영상 목록</p>
      </VideoGate>,
    );

    expect(screen.queryByText("영상 목록")).toBeNull();
    expect(screen.getByText("Video Generator는 다음 단계에서 열려요")).toBeTruthy();
    expect(screen.getByTestId("video-admin-locked-notice").textContent).toContain("관리자:");
    expect(screen.getByRole("link", { name: "Admin › System" }).getAttribute("href")).toBe("/admin/system");
  });

  test("열리면 아무 안내 없이 그대로", () => {
    site.video_open = true;
    who.is_admin = false;
    render(
      <VideoGate>
        <p>영상 목록</p>
      </VideoGate>,
    );

    expect(screen.getByText("영상 목록")).toBeTruthy();
    expect(screen.queryByText(/다음 단계에서 열려요/)).toBeNull();
    expect(screen.queryByTestId("video-admin-locked-notice")).toBeNull();
  });
});
