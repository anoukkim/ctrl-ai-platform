/**
 * 메뉴에 무엇이 보이는지 (admin-consolidation v3, owner 2026-10-17).
 *
 * 구역 목록은 한 파일에만 있고(`app/admin/sections.ts`), 사이드바·위쪽 탭·
 * 구역 안의 탭·빵가루·화면 제목이 모두 그것을 읽습니다. 13개였던 구역은
 * **6개** — Dashboard · Members · Quarters · Models · Community · System —
 * 이고, 예전 구역은 그 안의 탭이 됐으며 예전 주소는 새 자리로 넘어갑니다.
 */

import { describe, expect, test } from "vitest";

import { legacyTarget } from "@/app/admin/legacy";
import {
  ADMIN_SECTIONS,
  LEGACY_ROUTES,
  activeSection,
  activeTab,
  sectionLabel,
  tabHref,
  visibleSections,
} from "@/app/admin/sections";

describe("Admin 구역 목록", () => {
  test("보이는 구역은 여섯 개, 이 순서", () => {
    expect(visibleSections(false).map((section) => section.key)).toEqual([
      "dashboard",
      "members",
      "quarters",
      "models",
      "community",
      "system",
    ]);
  });

  test("예전 구역은 모두 어딘가의 탭이다", () => {
    const tabs = visibleSections(false).flatMap((section) => section.tabs.map((tab) => tab.key));
    for (const old of ["members", "applications", "quarters", "budget", "ai-models", "video-models", "content", "feedback", "apps", "deleted", "system", "audit"]) {
      expect(tabs, old).toContain(old);
    }
  });

  test("Top-ups는 개인 충전을 받지 않는 동안 보이지 않지만 정의는 남아 있다", () => {
    const topups = ADMIN_SECTIONS.find((section) => section.key === "topups");
    expect(topups?.href).toBe("/admin/topups");
    expect(topups?.hidden).toBe(true);
    expect(visibleSections(true).map((s) => s.key)).not.toContain("topups");
  });

  test("Dev Tools는 없다 — 개발 환경에서도 메뉴가 같다", () => {
    expect(visibleSections(true).map((s) => s.key)).toEqual(visibleSections(false).map((s) => s.key));
  });

  test("구역 이름은 모두 영어다", () => {
    for (const section of ADMIN_SECTIONS) {
      expect(section.label, section.key).toMatch(/^[A-Za-z][A-Za-z -]*$/);
    }
  });
});

describe("이름 한 곳에서 꺼내 쓰기", () => {
  test("구역 키는 그 이름, 예전 구역(탭)의 키는 자기가 들어 있는 구역의 이름", () => {
    expect(sectionLabel("members")).toBe("Members");
    expect(sectionLabel("applications")).toBe("Members");
    expect(sectionLabel("budget")).toBe("Quarters");
    expect(sectionLabel("ai-models")).toBe("Models");
    expect(sectionLabel("feedback")).toBe("Community");
    expect(sectionLabel("audit")).toBe("System");
  });

  test("없는 키는 조용히 비어 있지 않고 터진다", () => {
    expect(() => sectionLabel("nope")).toThrow();
  });
});

describe("지금 보고 있는 구역과 탭", () => {
  test("가장 긴 경로가 이기고, 상세 화면도 자기 구역이다", () => {
    expect(activeSection("/admin")?.key).toBe("dashboard");
    expect(activeSection("/admin/members")?.key).toBe("members");
    expect(activeSection("/admin/members/11")?.key).toBe("members");
    expect(activeSection("/admin/quarters")?.key).toBe("quarters");
    expect(activeSection("/admin/apps/7")?.key).toBe("community");
    expect(activeSection("/admin/system")?.key).toBe("system");
  });

  test("Admin 밖의 경로는 어느 구역도 아니다", () => {
    expect(activeSection("/usage")).toBeUndefined();
    expect(activeSection("/profile")).toBeUndefined();
  });

  test("탭: 주소의 ?tab=, 없거나 모르면 첫 탭; 첫 탭의 주소에는 ?tab=이 없다", () => {
    const community = ADMIN_SECTIONS.find((s) => s.key === "community")!;
    expect(activeTab(community, null).key).toBe("content");
    expect(activeTab(community, "feedback").key).toBe("feedback");
    expect(activeTab(community, "nope").key).toBe("content");
    expect(tabHref("community", "content")).toBe("/admin/community");
    expect(tabHref("community", "apps")).toBe("/admin/community?tab=apps");
  });
});

describe("예전 주소", () => {
  test("모두 새 자리로 넘어가고, 다른 값(분기, 거르기)은 그대로 간다", () => {
    expect(legacyTarget("/admin/applications", { status: "submitted", quarter: "3" })).toBe(
      "/admin/members?tab=applications&status=submitted&quarter=3",
    );
    expect(legacyTarget("/admin/budget", {})).toBe("/admin/quarters?tab=budget");
    expect(legacyTarget("/admin/content", {})).toBe("/admin/community");
    expect(legacyTarget("/admin/audit", { quarter: "2" })).toBe("/admin/system?tab=audit&quarter=2");
    for (const path of Object.keys(LEGACY_ROUTES)) {
      const target = legacyTarget(path, {});
      expect(activeSection(target.split("?")[0])?.key, path).toBe(LEGACY_ROUTES[path].section);
    }
  });
});
