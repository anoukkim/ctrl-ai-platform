/**
 * Admin의 구역 목록 — 한 곳에만 적습니다.
 *
 * admin-consolidation v3 (owner, 2026-10-17): 13개 구역이 **6개**가 됐어요 —
 * Dashboard · Members · Quarters · Models · Community · System. 예전 구역은
 * 각 구역 안의 **탭**(`tabs`)이 되고, 예전 주소는 새 자리로 넘어갑니다
 * (`LEGACY_ROUTES`). 사이드바, 위쪽 탭, 구역 안의 탭, 빵가루, 각 화면의
 * 제목이 모두 이 파일을 읽어요.
 *
 * **이름은 영어, 탭 이름과 설명은 한국어입니다**(시안 v3 그대로). 구역
 * 이름은 사이드바 항목과 같은 성격의 이름표라 Chat이나 Usage처럼 영어로 둡니다.
 */

import {
  Bot,
  LayoutDashboard,
  MessagesSquare,
  Server,
  Users,
  Wallet,
  CalendarRange,
  type LucideIcon,
} from "lucide-react";

/** 구역 안의 탭 하나 — 예전에는 따로 있던 구역. */
export interface AdminTab {
  /** 예전 구역의 키 — 화면이 제목을 찾을 때 씁니다. */
  key: string;
  label: string;
}

export interface AdminSection {
  /** 탭과 사이드바에서 쓰는 키. 경로와 별개로 안정적입니다. */
  key: string;
  href: string;
  label: string;
  /** 한 줄 설명. */
  description: string;
  Icon: LucideIcon;
  /** 구역 안의 탭(첫 탭이 기본, 주소의 `?tab=`). 하나뿐이면 탭 줄을 그리지 않아요. */
  tabs: AdminTab[];
  /** 이 구역에 속하는 다른 경로(상세 화면 등) — 빵가루와 탭 강조에 씁니다. */
  also?: string[];
  /** 개발 환경에서만 보이는 구역. */
  developmentOnly?: boolean;
  /**
   * 기능이 아직 없는 구역 — 메뉴 어디에도 보이지 않고, 경로와 정의만 남아요.
   * 해당 기능을 만드는 작업이 이 한 줄만 지우면 켜집니다.
   */
  hidden?: boolean;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "dashboard",
    href: "/admin",
    label: "Dashboard",
    description: "처리할 일이 있으면 위에, 나머지는 한눈에.",
    Icon: LayoutDashboard,
    tabs: [{ key: "dashboard", label: "Dashboard" }],
  },
  {
    // 신청 심사가 관리자의 주된 일이라 Members 안의 탭으로 바로 옵니다.
    key: "members",
    href: "/admin/members",
    label: "Members",
    description: "참여 신청, 회원, 초대 코드. 줄을 누르면 회원 상세.",
    Icon: Users,
    // admin-consolidation v3 (2): 참여 신청 is the list's 승인 대기 chip now,
    // and 지운 작업 is in the member panel.
    tabs: [{ key: "members", label: "회원" }],
  },
  {
    key: "quarters",
    href: "/admin/quarters",
    label: "Quarters",
    description: "분기와 예산 — 산 돈이 어디로 나뉘었나. 분기는 위쪽에서 바꿔요.",
    Icon: CalendarRange,
    // 분기 · 예산 = "산 돈이 어디로 나뉘었나" (돈의 흐름, 분기 마감), 사용 분석 =
    // "어디에 썼나" (v3, batch 3 — the former Budget screen's place).
    tabs: [
      { key: "quarters", label: "분기 · 예산" },
      { key: "budget", label: "사용 분석" },
    ],
  },
  {
    // personal-topup-off(2026-10-14): 개인 충전을 받지 않는 동안 숨깁니다.
    key: "topups",
    href: "/admin/topups",
    label: "Top-ups",
    description: "회원이 올린 개인 충전 신청의 입금을 확인합니다.",
    Icon: Wallet,
    tabs: [{ key: "topups", label: "Top-ups" }],
    hidden: true,
  },
  {
    key: "models",
    href: "/admin/models",
    label: "Models",
    description: "Chat · Video · Image 모델과 요금. 연결 전인 제공자도 목록에 있어요.",
    Icon: Bot,
    // 한도 (채팅 한도, from System) and 보정 (비용 보정) sit with the models (v3).
    tabs: [
      { key: "ai-models", label: "Chat" },
      { key: "video-models", label: "Video" },
      { key: "image-models", label: "Image" },
      { key: "limits", label: "한도" },
      { key: "calibration", label: "보정" },
    ],
  },
  {
    // 회원이 올리고 회원이 남긴 것 — 신고, 의견, 앱(기능 상자), 지운 작업.
    key: "community",
    href: "/admin/community",
    label: "Community",
    description: "신고 · 의견 · 앱.",
    Icon: MessagesSquare,
    tabs: [
      { key: "content", label: "신고" },
      { key: "feedback", label: "의견" },
      { key: "apps", label: "앱" },
    ],
    also: ["/admin/apps"],
  },
  {
    key: "system",
    href: "/admin/system",
    label: "System",
    description: "상태, 유지보수, 감사 기록.",
    Icon: Server,
    tabs: [
      { key: "system", label: "상태" },
      { key: "audit", label: "감사 기록" },
    ],
  },
];

/**
 * 예전 주소 → 새 자리 (북마크가 살아 있도록). 예전 화면 파일은 이 표를
 * 읽어 넘겨 줍니다.
 */
export const LEGACY_ROUTES: Record<string, { section: string; tab: string; query?: Record<string, string> }> = {
  "/admin/applications": { section: "members", tab: "members", query: { filter: "pending" } },
  "/admin/budget": { section: "quarters", tab: "budget" },
  "/admin/ai-models": { section: "models", tab: "ai-models" },
  "/admin/claude-models": { section: "models", tab: "ai-models" },
  "/admin/video-models": { section: "models", tab: "video-models" },
  "/admin/content": { section: "community", tab: "content" },
  "/admin/feedback": { section: "community", tab: "feedback" },
  "/admin/apps": { section: "community", tab: "apps" },
  "/admin/deleted": { section: "members", tab: "members" },
  "/admin/audit": { section: "system", tab: "audit" },
};

function sectionByKey(key: string): AdminSection {
  const section = ADMIN_SECTIONS.find((candidate) => candidate.key === key);
  if (section === undefined) throw new Error(`Admin 구역이 없습니다: ${key}`);
  return section;
}

/** Former sections that are no longer a tab: where their screens now live. */
const RETIRED_TABS: Record<string, string> = { applications: "members", deleted: "members" };

/** 탭(예전 구역)이 들어 있는 구역. */
export function sectionOfTab(tabKey: string): AdminSection | undefined {
  const retired = RETIRED_TABS[tabKey];
  if (retired) return ADMIN_SECTIONS.find((section) => section.key === retired);
  return ADMIN_SECTIONS.find((section) => section.tabs.some((tab) => tab.key === tabKey));
}

/**
 * 화면 제목(`<h1>`)에 쓰는 이름 — 구역의 이름입니다. 예전 구역의 화면은
 * 이제 탭이므로, 그 키를 주면 자기가 들어 있는 구역의 이름이 나와요
 * (Applications 화면의 제목은 Members). 키를 잘못 적으면 터집니다.
 */
export function sectionLabel(key: string): string {
  const section = ADMIN_SECTIONS.find((candidate) => candidate.key === key) ?? sectionOfTab(key);
  if (section === undefined) throw new Error(`Admin 구역이 없습니다: ${key}`);
  return section.label;
}

/** 지금 보고 있는 구역. 가장 긴 경로가 이깁니다 (`/admin`이 모두를 먹지 않도록). */
export function activeSection(pathname: string): AdminSection | undefined {
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const candidates = ADMIN_SECTIONS.flatMap((section) =>
    [section.href, ...(section.also ?? [])].map((href) => ({ section, href })),
  );
  return candidates.sort((a, b) => b.href.length - a.href.length).find((candidate) => matches(candidate.href))?.section;
}

/** 구역 안에서 지금 탭 — 주소의 `?tab=`, 없거나 모르는 값이면 첫 탭. */
export function activeTab(section: AdminSection, tab: string | null): AdminTab {
  return section.tabs.find((candidate) => candidate.key === tab) ?? section.tabs[0];
}

/** 구역의 탭 주소. 첫 탭은 `?tab=` 없이. */
export function tabHref(sectionKey: string, tabKey: string): string {
  const section = sectionByKey(sectionKey);
  return tabKey === section.tabs[0].key ? section.href : `${section.href}?tab=${encodeURIComponent(tabKey)}`;
}

/**
 * 메뉴에 보일 구역만. 아직 기능이 없는 구역(`hidden`)은 누구에게도
 * 보이지 않고, 개발 도구는 개발 환경에서만. 실제 차단은 백엔드가 합니다.
 */
export function visibleSections(isDevelopment: boolean): AdminSection[] {
  return ADMIN_SECTIONS.filter(
    (section) => !section.hidden && (!section.developmentOnly || isDevelopment),
  );
}
