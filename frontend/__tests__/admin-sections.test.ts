/**
 * 메뉴에 무엇이 보이는지.
 *
 * 구역 목록은 한 파일에만 있고(`app/admin/sections.ts`), 사이드바·탭·
 * 대시보드 카드가 모두 그것을 읽습니다. 그래서 "보일지 말지"를 여기서
 * 한 번 검사하면 세 곳 모두가 검사됩니다.
 *
 * 두 가지를 지킵니다.
 *
 *   1. 기능이 없는 구역(`hidden`)은 **어디에도 보이지 않는다**. 이전에는
 *      "준비 중" 배지를 달아 보여 줬고, 누를 때마다 빈 화면이 나왔습니다.
 *   2. 개발 도구는 개발 환경에서만 보인다. 가리는 것은 편의일 뿐이고,
 *      실제 차단은 백엔드가 404로 합니다 — 그쪽은 백엔드 테스트가 봅니다.
 *
 * 경로는 남아 있어야 합니다. 숨긴 구역을 만드는 작업이 `hidden: true` 한
 * 줄만 지우면 켜지도록.
 */

import { describe, expect, test } from "vitest";

import { ADMIN_SECTIONS, activeSection, visibleSections } from "@/app/admin/sections";

describe("Admin 구역 목록", () => {
  test("예산과 콘텐츠는 메뉴에 보이지 않는다", () => {
    const visible = visibleSections(true).map((section) => section.key);

    expect(visible).not.toContain("budget");
    expect(visible).not.toContain("content");
  });

  test("숨긴 구역도 경로와 정의는 남아 있다", () => {
    // budget-by-provider와 Phase 5/8이 한 줄만 지우면 켤 수 있도록.
    const budget = ADMIN_SECTIONS.find((section) => section.key === "budget");
    const content = ADMIN_SECTIONS.find((section) => section.key === "content");

    expect(budget?.href).toBe("/admin/budget");
    expect(content?.href).toBe("/admin/content");
    expect(budget?.hidden).toBe(true);
    expect(content?.hidden).toBe(true);
  });

  test("개발 도구는 개발 환경에서만 보인다", () => {
    expect(visibleSections(true).map((s) => s.key)).toContain("dev");
    expect(visibleSections(false).map((s) => s.key)).not.toContain("dev");
  });

  test("보이는 구역은 여덟 개이고, 신청 승인이 분기 설정보다 앞이다", () => {
    const visible = visibleSections(false).map((section) => section.key);

    expect(visible).toEqual([
      "dashboard",
      "members",
      "applications",
      "quarters",
      "topups",
      "video-models",
      "audit",
      "system",
    ]);
    // 심사가 관리자의 주된 일이므로 분기 설정보다 먼저 옵니다.
    expect(visible.indexOf("applications")).toBeLessThan(visible.indexOf("quarters"));
  });

  test("신청 승인과 분기 설정은 서로 다른 경로다", () => {
    const applications = ADMIN_SECTIONS.find((s) => s.key === "applications");
    const quarters = ADMIN_SECTIONS.find((s) => s.key === "quarters");

    expect(applications?.href).toBe("/admin/applications");
    expect(quarters?.href).toBe("/admin/quarters");
    expect(applications?.label).toBe("신청 승인");
    expect(quarters?.label).toBe("분기 설정");
  });
});

describe("지금 보고 있는 구역", () => {
  test("가장 긴 경로가 이긴다", () => {
    // /admin 이 모든 하위 경로를 먹으면 탭이 항상 대시보드로 보입니다.
    expect(activeSection("/admin")?.key).toBe("dashboard");
    expect(activeSection("/admin/members")?.key).toBe("members");
    expect(activeSection("/admin/members/11")?.key).toBe("members");
    expect(activeSection("/admin/applications")?.key).toBe("applications");
    expect(activeSection("/admin/quarters")?.key).toBe("quarters");
  });

  test("Admin 밖의 경로는 어느 구역도 아니다", () => {
    expect(activeSection("/usage")).toBeUndefined();
    expect(activeSection("/profile")).toBeUndefined();
  });
});
