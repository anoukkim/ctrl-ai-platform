/**
 * Admin의 구역 목록 — 한 곳에만 적습니다.
 *
 * 같은 목록을 다섯 곳이 읽습니다: 사이드바의 접히는 Admin 묶음, Admin
 * 안쪽의 탭, 빵가루, 대시보드의 카드, 그리고 각 구역 화면의 제목.
 * 여러 곳에 따로 적으면 이름 하나를 바꿀 때 어딘가를 잊게 되고,
 * 화면마다 다른 이름이 보입니다.
 *
 * **이름은 영어, 설명은 한국어입니다.** 구역 이름은 사이드바 항목과
 * 같은 성격의 이름표라 Chat이나 Usage처럼 영어로 둡니다. 카드에 붙는
 * 한 줄 설명과 화면 본문은 한국어입니다.
 */

import {
  Clapperboard,
  FileText,
  LayoutDashboard,
  ScrollText,
  Server,
  Stamp,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface AdminSection {
  /** 대시보드 카드와 탭에서 쓰는 키. 경로와 별개로 안정적입니다. */
  key: string;
  href: string;
  label: string;
  /** 카드에 한 줄로 들어가는 설명. */
  description: string;
  Icon: LucideIcon;
  /** 개발 환경에서만 보이는 구역. */
  developmentOnly?: boolean;
  /**
   * 기능이 아직 없는 구역.
   *
   * 메뉴에도 카드에도 **보이지 않습니다**. 경로와 자리 표시 화면은 코드에
   * 남아 있어서, 해당 기능을 만드는 작업이 이 한 줄만 지우면 켜집니다.
   *
   * 이전에는 "준비 중" 배지를 달아 보여 줬습니다. 그러면 메뉴가 길어지고,
   * 누를 때마다 아무것도 없는 화면이 나옵니다 — 쓸 수 없는 항목은 자리를
   * 알려 주는 것보다 방해가 더 큽니다.
   */
  hidden?: boolean;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "dashboard",
    href: "/admin",
    label: "Dashboard",
    description: "손이 필요한 일과 이번 분기 현황을 한눈에 봅니다.",
    Icon: LayoutDashboard,
  },
  {
    key: "members",
    href: "/admin/members",
    label: "Members",
    description: "회원을 찾아 참여 상태, 역할, 지원금을 관리합니다.",
    Icon: Users,
  },
  {
    // 신청 심사가 관리자의 주된 일이라 분기 설정보다 앞에 둡니다.
    key: "applications",
    href: "/admin/applications",
    label: "Applications",
    description: "올라온 참여 신청을 승인하거나 거절합니다.",
    Icon: Stamp,
  },
  {
    key: "quarters",
    href: "/admin/quarters",
    label: "Quarters",
    description: "분기를 만들고 신청을 열고 닫습니다.",
    Icon: FileText,
  },
  {
    key: "topups",
    href: "/admin/topups",
    label: "Top-ups",
    description: "회원이 올린 개인 충전 신청의 입금을 확인합니다.",
    Icon: Wallet,
  },
  {
    // budget-by-provider가 켭니다.
    key: "budget",
    href: "/admin/budget",
    label: "Budget",
    description: "제공자별 예산 관리.",
    Icon: Wallet,
    hidden: true,
  },
  {
    key: "video-models",
    href: "/admin/video-models",
    label: "Video Models",
    description: "회원에게 열어 줄 영상 모델을 고릅니다.",
    Icon: Clapperboard,
  },
  {
    key: "audit",
    href: "/admin/audit",
    label: "Audit Log",
    description: "관리자가 바꾼 모든 기록 — 읽기 전용입니다.",
    Icon: ScrollText,
  },
  {
    // Phase 5(앱)와 Phase 8(영상)이 켭니다.
    key: "content",
    href: "/admin/content",
    label: "Content",
    description: "게시된 앱과 영상, 댓글을 정리합니다.",
    Icon: FileText,
    hidden: true,
  },
  {
    key: "system",
    href: "/admin/system",
    label: "System",
    description: "백엔드, 데이터베이스, 외부 서비스 상태를 확인합니다.",
    Icon: Server,
  },
  {
    key: "dev",
    href: "/admin/dev",
    label: "Dev Tools",
    description: "제공자 없이 예산을 써 보는 사용량 시뮬레이터입니다.",
    Icon: Wrench,
    developmentOnly: true,
  },
];

/**
 * 구역 하나의 이름.
 *
 * 구역 화면의 제목(`<h1>`)이 이것을 씁니다. 화면마다 제목을 직접 적어
 * 두면 탭에는 Audit Log, 제목에는 감사 로그가 보이는 일이 생깁니다 —
 * 같은 구역을 두 이름으로 부르는 셈입니다.
 *
 * 키를 잘못 적으면 조용히 빈 제목이 나오지 않도록 터집니다.
 */
export function sectionLabel(key: string): string {
  const section = ADMIN_SECTIONS.find((candidate) => candidate.key === key);
  if (section === undefined) throw new Error(`Admin 구역이 없습니다: ${key}`);
  return section.label;
}

/** 지금 보고 있는 구역. 가장 긴 경로가 이깁니다 (`/admin`이 모두를 먹지 않도록). */
export function activeSection(pathname: string): AdminSection | undefined {
  return [...ADMIN_SECTIONS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`));
}

/**
 * 메뉴와 카드에 보일 구역만.
 *
 * 두 가지를 걸러 냅니다. 아직 기능이 없는 구역(`hidden`)은 누구에게도
 * 보이지 않고, 개발 도구는 개발 환경에서만 보입니다. 숨기는 것은 편의일
 * 뿐이고, 실제 차단은 백엔드가 합니다 — 시뮬레이터는 배포 환경에서
 * 404를 돌려줍니다.
 */
export function visibleSections(isDevelopment: boolean): AdminSection[] {
  return ADMIN_SECTIONS.filter(
    (section) => !section.hidden && (!section.developmentOnly || isDevelopment),
  );
}
