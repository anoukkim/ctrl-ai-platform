/**
 * owner-polish 6 — the Video Generator locked for members until the 관리자
 * opens it. The gate shows "다음 분기에 열려요" to members, lets the admin
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
  test("회원: 목록 대신 잠긴 화면 — 다음 분기에 열려요, Builder로 안내", () => {
    site.video_open = false;
    who.is_admin = false;
    render(
      <VideoGate>
        <p>영상 목록</p>
      </VideoGate>,
    );

    expect(screen.queryByText("영상 목록")).toBeNull();
    expect(screen.getByText("Video Generator는 다음 분기에 열려요")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Project Builder로 가기" }).getAttribute("href")).toBe("/builder");
  });

  test("관리자: 들어가되 회원에게 잠겨 있다는 띠와 Admin › System 링크", () => {
    site.video_open = false;
    who.is_admin = true;
    render(
      <VideoGate>
        <p>영상 목록</p>
      </VideoGate>,
    );

    expect(screen.getByText("영상 목록")).toBeTruthy();
    const notice = screen.getByTestId("video-admin-locked-notice");
    expect(notice.textContent).toContain("회원에게는 Video Generator가 잠겨 있어요");
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
    expect(screen.queryByText(/다음 분기에 열려요/)).toBeNull();
    expect(screen.queryByTestId("video-admin-locked-notice")).toBeNull();
  });
});
