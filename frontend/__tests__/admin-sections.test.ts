/**
 * 메뉴에 무엇이 보이는지.
 *
 * 구역 목록은 한 파일에만 있고(`app/admin/sections.ts`), 사이드바·탭·
 * 빵가루·대시보드 카드·화면 제목이 모두 그것을 읽습니다. 그래서 "보일지
 * 말지"와 "무엇으로 불릴지"를 여기서 한 번 검사하면 다섯 곳 모두가
 * 검사됩니다.
 *
 * 세 가지를 지킵니다.
 *
 *   1. 기능이 없는 구역(`hidden`)은 **어디에도 보이지 않는다**. 이전에는
 *      "준비 중" 배지를 달아 보여 줬고, 누를 때마다 빈 화면이 나왔습니다.
 *   2. Dev Tools는 개발 환경에서만 보인다. 가리는 것은 편의일 뿐이고,
 *      실제 차단은 백엔드가 404로 합니다 — 그쪽은 백엔드 테스트가 봅니다.
 *   3. 구역 이름은 모두 영어다. 메뉴가 한 언어로 읽혀야 합니다.
 *
 * 경로는 남아 있어야 합니다. 숨긴 구역을 만드는 작업이 `hidden: true` 한
 * 줄만 지우면 켜지도록.
 */

import { describe, expect, test } from "vitest";

import {
  ADMIN_SECTIONS,
  activeSection,
  sectionLabel,
  visibleSections,
} from "@/app/admin/sections";

describe("Admin 구역 목록", () => {
  test("Budget과 Content는 메뉴에 보이지 않는다", () => {
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

  test("Dev Tools는 개발 환경에서만 보인다", () => {
    expect(visibleSections(true).map((s) => s.key)).toContain("dev");
    expect(visibleSections(false).map((s) => s.key)).not.toContain("dev");
  });

  test("보이는 구역은 열 개이고, Applications가 Quarters보다 앞이다", () => {
    const visible = visibleSections(false).map((section) => section.key);

    expect(visible).toEqual([
      "dashboard",
      "members",
      "applications",
      "quarters",
      "topups",
      "video-models",
      "claude-models",
      "deleted",
      "audit",
      "system",
    ]);
    // Deleted Items는 Audit Log 바로 앞입니다 — 둘 다 지난 일을
    // 들여다보는 구역이고, 되살리기는 감사 기록에 남습니다.
    expect(visible.indexOf("deleted")).toBeLessThan(visible.indexOf("audit"));
    // 심사가 관리자의 주된 일이므로 Quarters보다 먼저 옵니다.
    expect(visible.indexOf("applications")).toBeLessThan(visible.indexOf("quarters"));
  });

  test("Applications와 Quarters는 서로 다른 경로다", () => {
    const applications = ADMIN_SECTIONS.find((s) => s.key === "applications");
    const quarters = ADMIN_SECTIONS.find((s) => s.key === "quarters");

    expect(applications?.href).toBe("/admin/applications");
    expect(quarters?.href).toBe("/admin/quarters");
    expect(applications?.label).toBe("Applications");
    expect(quarters?.label).toBe("Quarters");
  });

  test("구역 이름은 모두 영어다", () => {
    // 메뉴는 한 언어로 읽혀야 합니다. 한글이 섞여 들어오면 사이드바 한
    // 묶음 안에서 두 가지 글자가 번갈아 나옵니다.
    for (const section of ADMIN_SECTIONS) {
      expect(section.label, section.key).toMatch(/^[A-Za-z][A-Za-z -]*$/);
    }
  });
});

describe("구역 이름 한 곳에서 꺼내 쓰기", () => {
  test("키로 이름을 돌려준다", () => {
    expect(sectionLabel("audit")).toBe("Audit Log");
    expect(sectionLabel("members")).toBe("Members");
  });

  test("없는 키는 조용히 비어 있지 않고 터진다", () => {
    // 화면 제목이 빈칸으로 나오는 것보다 즉시 실패하는 쪽이 낫습니다.
    expect(() => sectionLabel("nope")).toThrow();
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
    expect(activeSection("/admin/deleted")?.key).toBe("deleted");
    expect(activeSection("/admin/claude-models")?.key).toBe("claude-models");
  });

  test("Admin 밖의 경로는 어느 구역도 아니다", () => {
    expect(activeSection("/usage")).toBeUndefined();
    expect(activeSection("/profile")).toBeUndefined();
  });
});
