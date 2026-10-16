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
  AppWindow,
  Bot,
  Clapperboard,
  FileText,
  Trash2,
  LayoutDashboard,
  MessageSquarePlus,
  PiggyBank,
  ScrollText,
  Server,
  Stamp,
  Users,
  Wallet,
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
    // personal-topup-off(2026-10-14): 개인 충전을 받지 않는 동안 숨깁니다.
    // 백엔드 경로는 남아서 거절하고, personal-topup-ui가 이 줄을 지우면
    // 다시 보입니다.
    key: "topups",
    href: "/admin/topups",
    label: "Top-ups",
    description: "회원이 올린 개인 충전 신청의 입금을 확인합니다.",
    Icon: Wallet,
    hidden: true,
  },
  {
    // single-wallet이 켰습니다. 회원마다 지갑은 하나지만 동아리는 제공자별로
    // 크레딧을 사므로, 사용액을 제공자별로 모아 보여 줍니다.
    key: "budget",
    href: "/admin/budget",
    label: "Budget",
    description: "회원별 지원금 잔액과 제공자별 사용액을 봅니다 — 크레딧 구매의 근거.",
    Icon: PiggyBank,
  },
  {
    key: "video-models",
    href: "/admin/video-models",
    label: "Video Models",
    description: "회원에게 열어 줄 영상 모델을 고릅니다.",
    Icon: Clapperboard,
  },
  {
    // chat-model-choice. Video Models와 같은 모양이라 바로 옆에 둡니다.
    // admin-and-nav-cleanup(2026-10-14)에서 Claude Models → AI Models:
    // 제공자별로 묶고, 연결 전인 제공자(DeepSeek)도 목록에 둡니다.
    // 예전 주소 /admin/claude-models는 이리로 넘어옵니다.
    key: "ai-models",
    href: "/admin/ai-models",
    label: "AI Models",
    description: "회원이 Chat에서 고를 수 있는 AI 모델과 요금을 제공자별로 정합니다.",
    Icon: Bot,
  },
  {
    // prep-beta-launch. 회원이 "의견 보내기"로 남긴 글. 회원이 의견을 남기는
    // 유일한 길입니다(admin-and-nav-cleanup에서 Report Issue를 없앴습니다).
    // 달리 공개되지 않고 운영진만 읽습니다.
    key: "feedback",
    href: "/admin/feedback",
    label: "Feedback",
    description: "회원이 화면 어디에서든 '의견 보내기'로 남긴 글을 읽습니다.",
    Icon: MessageSquarePlus,
  },
  {
    // 회원이 지운 것을 되살리는 곳. Audit Log 앞에 둡니다 — 둘 다 지난
    // 일을 들여다보는 구역이고, 되살리기는 감사 기록에 남습니다.
    key: "deleted",
    href: "/admin/deleted",
    label: "Deleted Items",
    description: "회원이 삭제한 프로젝트와 영상을 되살립니다.",
    Icon: Trash2,
  },
  {
    key: "audit",
    href: "/admin/audit",
    label: "Audit Log",
    description: "관리자가 바꾼 모든 기록 — 읽기 전용입니다.",
    Icon: ScrollText,
  },
  {
    // app-platform P4b: 회원 앱의 기능 상자 — AI 사용, 동의, 데이터, 멈추기.
    // 게시 여부와 상관없이 기능 상자를 쓴 앱은 모두 여기 있습니다.
    key: "apps",
    href: "/admin/apps",
    label: "Apps",
    description: "회원 앱의 기능 상자 — AI 사용량, 연결 동의, 데이터, 멈추기.",
    Icon: AppWindow,
  },
  {
    // ctrlaiapps-publish(2026-10-14)가 켰습니다 — 신고와 게시 내리기.
    // P4b부터 앱 자체는 Apps에서 다룹니다. 영상(Phase 8)은 나중에 같은 화면에.
    key: "content",
    href: "/admin/content",
    label: "Content",
    description: "회원들의 신고를 확인하고, 필요하면 게시를 내립니다.",
    Icon: FileText,
  },
  {
    key: "system",
    href: "/admin/system",
    label: "System",
    description: "백엔드, 데이터베이스, 외부 서비스 상태를 확인합니다.",
    Icon: Server,
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
