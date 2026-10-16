"use client";

/**
 * 모든 화면을 감싸는 껍데기: 왼쪽 사이드바와 본문 영역.
 *
 * Client Component인 이유는 두 가지입니다. 현재 경로를 알아야 하고
 * (`usePathname`), 좁은 화면에서 메뉴 열림 상태를 기억해야 합니다.
 * 감싸는 화면들은 그대로 Server Component입니다.
 *
 * 언어 규칙: 메뉴는 전부 영어입니다 — 묶음 제목(Create, Explore,
 * Manage, Account)과 화면 이름(Chat, Project Builder, Video Generator,
 * CtrlAIApps, CtrlAITube, Usage, Profile, Admin) 모두. 의견은 아래쪽의
 * '의견 보내기'로 보냅니다. 메뉴 밖에서 회원이 읽는 문구는 모두 한국어입니다.
 *
 * 묶음 순서는 Create, Explore, Manage, Account입니다(owner, 2026-10-14).
 * Manage는 관리자에게만 보이고, 그 안의 Admin은 눌러서 구역을 펼치는
 * 항목입니다(`AdminNavBlock`).
 */

import {
  CircleHelp,
  Clapperboard,
  Code2,
  Gauge,
  LayoutGrid,
  Lock,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Shield,
  Sun,
  User,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ADMIN_SECTIONS, visibleSections } from "@/app/admin/sections";

import { VIDEO_LOCKED_HINT } from "@/lib/site";
import { useTheme } from "@/lib/theme";

import AnimatedNumber from "./AnimatedNumber";
import BrandMark from "./BrandMark";
import FeedbackButton from "./FeedbackButton";
import GuideProvider, { useGuide } from "./FirstVisitGuide";
import Skeleton from "./Skeleton";

import { useAdminNav } from "./AdminNavProvider";
import { isPublicPath, useCurrentUser } from "./CurrentUserProvider";
import { useMyQuarter } from "./MyQuarterProvider";
import { useSite } from "./SiteProvider";
import { useSpendFeedback } from "./SpendFeedbackProvider";

import {
  MEMBERSHIP_BADGE,
  MEMBERSHIP_LABEL,
  formatDate,
  formatKrw,
  walletSentence,
} from "@/lib/quarters";

import styles from "./AppShell.module.css";

interface NavItem {
  href: string;
  label: string;
  /** lucide 아이콘 한 벌만 씁니다. 크기와 선 굵기는 CSS가 정합니다. */
  Icon: LucideIcon;
  /** 아이콘을 영역 색으로 칠합니다 — Project Builder는 보라, Video는 청록. */
  tone?: "build" | "video";
  /** 회원에게 잠긴 화면 (owner-polish 6): 자물쇠와 "다음 분기에 열려요". 링크는 그대로 — 화면이 이유를 말합니다. */
  lockedHint?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * 사이드바 위쪽: 무언가를 만들거나 둘러보는 곳 (관리자에게는 그 아래 Manage).
 *
 * 아래쪽(Account)과 나눠 둔 이유는 성격이 다르기 때문입니다. 위쪽은 작업,
 * 아래쪽은 내 계정과 남은 지원금입니다. 사이에 빈 공간을 두어 눈으로도
 * 구분됩니다.
 */
const TOP_GROUPS: NavGroup[] = [
  {
    // 묶음 제목도 항목 이름도 영어입니다. 메뉴는 화면을 가리키는 이름표일
    // 뿐이라 짧은 영어가 눈에 빨리 들어오고, 본문은 한국어로 설명합니다.
    label: "Create",
    items: [
      { href: "/", label: "Chat", Icon: MessageSquare },
      { href: "/builder", label: "Project Builder", Icon: Code2, tone: "build" },
      { href: "/video", label: "Video Generator", Icon: Clapperboard, tone: "video" },
    ],
  },
  {
    label: "Explore",
    items: [
      { href: "/ctrlaistore", label: "CtrlAIApps", Icon: LayoutGrid },
      { href: "/ctrlaitube", label: "CtrlAITube", Icon: PlayCircle },
    ],
  },
];

/** 사이드바 아래쪽: 분기 카드와 계정 영역 바로 위에 붙습니다. */
const PERSONAL_GROUP: NavGroup = {
  label: "Account",
  items: [
    { href: "/usage", label: "Usage", Icon: Gauge },
    { href: "/profile", label: "Profile", Icon: User },
  ],
};

/**
 * 관리자에게만 보입니다. 회원 자격과 크레딧이 분기 단위로 관리되므로
 * Admin은 숨겨진 설정 화면이 아니라 독립된 영역입니다.
 *
 * Admin은 다른 항목과 달리 눌렀을 때 아래로 펼쳐집니다. 구역이 아홉
 * 개여서, 사이드바에서 바로 원하는 구역으로 가는 쪽이 대시보드를 한 번
 * 거치는 것보다 빠릅니다. 접고 펼친 상태는 기억합니다 — 화면을 옮길
 * 때마다 다시 펼치게 만들지 않도록.
 */
const ADMIN_STORAGE_KEY = "ctrlai.admin-nav-open";

/**
 * 사이드바를 아이콘만 남긴 좁은 막대로 접었는지. 브라우저마다 기억하고,
 * 처음에는 펼쳐 둡니다. 저장소를 막아 둔 브라우저에서는 기억하지 못할
 * 뿐 접기·펴기는 그대로 됩니다.
 *
 * 넓은 화면에서만 의미가 있습니다. 좁은 화면은 위쪽 "메뉴" 단추로 여는
 * 전체 메뉴를 그대로 씁니다.
 */
export const SIDEBAR_STORAGE_KEY = "ctrlai.sidebar-collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 화면 전체를 작업 공간으로 쓰는 경로.
 *
 * /builder 와 /video 는 프로젝트 목록이라 보통 화면처럼 여백을 둡니다.
 * 그 아래 /builder/{id}, /video/{id} 만 작업 공간이라 여백과 최대 너비를
 * 없애고 높이를 화면에 맞춥니다.
 */
const WORKSPACE_PATTERN = /^\/(builder|video)\/[^/]+/;

/** Chat도 화면 높이를 꽉 채웁니다. 대화 목록이 안에서 스크롤되고 입력창은
 *  바닥에 붙어야 하므로, 페이지 전체가 스크롤되면 안 됩니다. */
const CHAT_PATH = "/";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // 사이드바는 로그인을 확인한 뒤에만 그려지고, 그 확인은 브라우저에서
  // 일어납니다. 그래서 처음 값에서 바로 읽어도 서버가 그린 HTML과
  // 어긋나지 않습니다 — 효과로 읽으면 한 번 펼쳐졌다 접히며 깜빡입니다.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { state, signOut } = useCurrentUser();
  const { theme, toggle: toggleTheme } = useTheme();
  // owner-polish 6: Video Generator가 회원에게 잠겨 있으면 메뉴가 그렇게 말합니다.
  const site = useSite();

  // 로그인/회원가입 화면에는 사이드바를 두지 않습니다.
  if (isPublicPath(pathname)) {
    return <div className={styles.bare}>{children}</div>;
  }

  // 앱 연결 화면(app-platform P2)은 작은 새 창에서 열립니다. 로그인은
  // 필요하지만 사이드바는 두지 않습니다.
  if (pathname.startsWith("/apps/connect") && state.phase === "authenticated") {
    return <div className={styles.bare}>{children}</div>;
  }

  // 아직 확인 중이거나 로그인하지 않았다면 본문을 그리지 않습니다.
  // 로그인하지 않은 경우의 이동은 CurrentUserProvider가 맡습니다.
  if (state.phase !== "authenticated") {
    return (
      <div className={styles.bare}>
        <div style={{ padding: "2rem", maxWidth: "28rem", margin: "0 auto", width: "100%" }}>
          <Skeleton label={state.phase === "loading" ? "불러오는 중…" : "로그인 화면으로 이동합니다…"} />
        </div>
      </div>
    );
  }

  const user = state.user;
  const isWorkspace = WORKSPACE_PATTERN.test(pathname);
  const isChat = pathname === CHAT_PATH;

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* 기억하지 못해도 접기·펴기는 됩니다 */
      }
      return next;
    });
  }

  return (
    // 처음 로그인한 브라우저에서 한 번 뜨는 안내(ui-friendly-motion).
    <GuideProvider autoOpen>
    <div className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ""}`}>
      <header className={styles.topbar}>
        <Link className={styles.brandLink} href="/" onClick={() => setMenuOpen(false)}>
          <span className={styles.brandMark}>
            <BrandMark size={26} />
            CTRL+AI
          </span>
        </Link>
        <button
          className={styles.menuButton}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
        >
          {menuOpen ? "닫기" : "메뉴"}
        </button>
      </header>

      <nav
        className={`${styles.nav} ${menuOpen ? "" : styles.navHidden}`}
        id="primary-navigation"
        aria-label="주요 메뉴"
      >
        <div className={styles.navBrand}>
          <div className={styles.navBrandRow}>
            <span className={styles.brandMark}>
              <BrandMark size={18} variant="glyph" />
              <span className={styles.navLabel}>CTRL+AI</span>
            </span>
            <button
              className={`${styles.footerButton} ${styles.collapseButton}`}
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls="primary-navigation"
              aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
              title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            >
              {collapsed ? (
                <PanelLeftOpen size={16} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={16} aria-hidden="true" />
              )}
            </button>
          </div>
          <span className={styles.brandPhase}>함께 만들고 함께 나누는 AI 창작 커뮤니티</span>
        </div>

        <div className={styles.navScroll}>
          <div className={styles.navTop}>
            {TOP_GROUPS.map((group) => (
              <NavGroupBlock
                group={group}
                key={group.label}
                pathname={pathname}
                onNavigate={() => setMenuOpen(false)}
                collapsed={collapsed}
                lockedHints={site.video_open ? {} : { "/video": VIDEO_LOCKED_HINT }}
              />
            ))}

            {/* Manage 묶음 — 관리자에게만 보입니다(owner, 2026-10-14). 순서는
                Create, Explore, Manage, Account. 보이지 않게 하는 것은 편의일
                뿐이고, 실제 차단은 백엔드의 require_admin이 합니다. */}
            {user.is_admin && (
              <div className={styles.navGroup}>
                <p className={styles.navGroupLabel}>Manage</p>
                <AdminNavBlock
                  pathname={pathname}
                  onNavigate={() => setMenuOpen(false)}
                  collapsed={collapsed}
                />
              </div>
            )}
          </div>

          {/* 위아래 묶음 사이의 빈 공간. 화면이 길면 늘어납니다. */}
          <div className={styles.navSpacer} aria-hidden="true" />

          <div className={styles.navBottom}>
            <NavGroupBlock
              group={PERSONAL_GROUP}
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
              collapsed={collapsed}
            />
            <MemberStatus onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>

        {/* 계정 영역 — 두 줄입니다(fix-ui-polish-admin). 위는 이름과 관리자
            배지, 아래는 개인정보·약관과 네 개의 아이콘 단추. 한 줄에 모두
            두면 이름이 말줄임으로 사라졌습니다. */}
        <div className={styles.navFooter}>
          <span className={styles.navUser} title={collapsed ? user.display_name : undefined}>
            <span className={styles.navAvatar} aria-hidden="true">
              {user.display_name.slice(0, 1)}
            </span>
            <span className={styles.navUserNames}>
              <span className={styles.navUserNameRow}>
                <span className={styles.navUserName}>{user.display_name}</span>
                {user.is_admin && <span className={styles.adminBadge}>관리자</span>}
              </span>
              <span className={styles.navUserHandle}>@{user.username}</span>
            </span>
          </span>
          <div className={styles.navActions}>
            {/* 개인정보 처리방침·이용약관 (privacy-and-terms). 접힌 레일에는
                자리가 없어 펼친 사이드바에서만 보입니다. */}
            {!collapsed && (
              <span className={styles.navLegal}>
                <Link className={styles.navLegalLink} href="/privacy">
                  개인정보
                </Link>
                <span aria-hidden="true">·</span>
                <Link className={styles.navLegalLink} href="/terms">
                  약관
                </Link>
              </span>
            )}
            <button
              className={styles.footerButton}
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "밝은 화면으로" : "어두운 화면으로"}
              title={theme === "dark" ? "밝은 화면으로" : "어두운 화면으로"}
            >
              {theme === "dark" ? (
                <Sun size={16} aria-hidden="true" />
              ) : (
                <Moon size={16} aria-hidden="true" />
              )}
            </button>
            {/* 의견 보내기 — 어느 화면에서든 한 번에. 저장되고 Admin › Feedback에서
                읽습니다. */}
            <FeedbackButton variant="icon" className={styles.footerButton} />
            <GuideButton onOpen={() => setMenuOpen(false)} />
            <button
              className={styles.footerButton}
              type="button"
              onClick={() => void signOut()}
              aria-label="로그아웃"
              title="로그아웃"
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      <main
        className={`${styles.main} ${isWorkspace ? styles.mainWorkspace : ""} ${
          isChat ? styles.mainChat : ""
        }`}
      >
        <div className={styles.mainInner}>{children}</div>
      </main>
    </div>
    </GuideProvider>
  );
}

/** 사이드바 아래의 물음표 — 첫 안내를 다시 엽니다. 휴대폰 메뉴는 닫습니다. */
function GuideButton({ onOpen }: { onOpen: () => void }) {
  const { open } = useGuide();
  return (
    <button
      className={styles.footerButton}
      type="button"
      onClick={() => {
        onOpen();
        open();
      }}
      aria-label="처음 안내 다시 보기"
      title="처음 안내 다시 보기"
    >
      <CircleHelp size={16} aria-hidden="true" />
    </button>
  );
}

/**
 * 메뉴 한 묶음. 위/아래 두 곳에서 같은 모양으로 그립니다 — Account도
 * Chat처럼 아이콘과 이름이 한 줄인 세로 항목입니다(fix-ui-polish-admin).
 */
function NavGroupBlock({
  group,
  pathname,
  onNavigate,
  collapsed = false,
  lockedHints = {},
}: {
  group: NavGroup;
  pathname: string;
  onNavigate: () => void;
  /** 접힌 사이드바: 이름은 화면에서 감추고(읽어 주기는 그대로) 툴팁으로. */
  collapsed?: boolean;
  /** 주소별 잠김 안내 (owner-polish 6). 없으면 잠기지 않은 항목입니다. */
  lockedHints?: Record<string, string>;
}) {
  return (
    <div className={styles.navGroup}>
      <p className={styles.navGroupLabel}>{group.label}</p>
      <ul className={styles.navList}>
        {group.items.map((item) => {
          // "/"는 Chat이므로 정확히 일치할 때만 선택 표시를 합니다.
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const lockedHint = item.lockedHint ?? lockedHints[item.href];
          const hintId = lockedHint ? `nav-locked-${item.href.replace(/\W+/g, "")}` : undefined;

          return (
            <li key={item.href}>
              <Link
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""} ${
                  item.tone ? styles[`tone-${item.tone}`] : ""
                } ${lockedHint ? styles.navLocked : ""}`}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                aria-describedby={hintId}
                onClick={onNavigate}
                title={
                  lockedHint ? (collapsed ? `${item.label} — ${lockedHint}` : lockedHint) : collapsed ? item.label : undefined
                }
                data-locked={lockedHint ? "true" : undefined}
              >
                <item.Icon className={styles.navIcon} aria-hidden="true" />
                <span className={styles.navLabel}>{item.label}</span>
                {lockedHint && (
                  <>
                    <Lock className={styles.navLockIcon} aria-hidden="true" />
                    {/* aria-hidden keeps the link's name "Video Generator"; the
                        hint still reaches readers through aria-describedby. */}
                    <span className={styles.navLockHint} id={hintId} aria-hidden="true">
                      {lockedHint}
                    </span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Manage 묶음의 Admin 항목 — 눌러서 펼칩니다.
 *
 * 구역이 열 개가 넘어, Admin 항목을 누를 수 있는 단추로 두고 아래에
 * 구역을 폅니다.
 *
 * 펼친 상태는 브라우저에 남겨 둡니다. 관리자마다 쓰는 구역이 다르고,
 * 화면을 옮길 때마다 다시 펼치게 하면 두 번 누르는 메뉴가 됩니다.
 *
 * 숫자 배지는 손이 필요한 보이는 구역에만 붙습니다 — 지금은 심사를
 * 기다리는 신청입니다. 사람이 움직이지 않으면 회원이 기다리게 되는 일입니다.
 */
function AdminNavBlock({
  pathname,
  onNavigate,
  collapsed = false,
}: {
  pathname: string;
  onNavigate: () => void;
  collapsed?: boolean;
}) {
  const { pendingApplications, pendingTopUps, isDevelopment } = useAdminNav();

  /**
   * 처음 펼쳐져 있는지: Admin 안에 있으면 펼치고, 아니면 지난번에 둔
   * 대로 둡니다.
   *
   * 효과가 아니라 처음 값에서 읽습니다. 효과로 읽으면 접힌 상태로 한 번
   * 그린 뒤 펼쳐져 메뉴가 깜빡입니다. 사이드바는 로그인을 확인한 뒤에만
   * 그려지므로 — 그 확인 자체가 브라우저에서 일어납니다 — 서버가 그린
   * HTML과 어긋날 일이 없습니다.
   */
  const [open, setOpen] = useState(() => {
    if (pathname.startsWith("/admin")) return true;
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(ADMIN_STORAGE_KEY) === "1";
    } catch {
      /* 저장소를 막아 둔 브라우저에서는 기억하지 않습니다 */
      return false;
    }
  });

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(ADMIN_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* 기억하지 못해도 메뉴는 동작합니다 */
      }
      return next;
    });
  }

  const sections = visibleSections(isDevelopment);
  const pending: Record<string, number> = {
    applications: pendingApplications,
    topups: pendingTopUps,
  };
  // 보이는 구역의 수만 더합니다 — 숨긴 구역(Top-ups, personal-topup-off)의
  // 수가 들어가면 눌러 갈 곳 없는 배지가 됩니다.
  const totalPending = sections.reduce((sum, section) => sum + (pending[section.key] ?? 0), 0);
  const insideAdmin = pathname.startsWith("/admin");

  /**
   * 펼친 구역 목록이 길어 사이드바 높이를 넘으면(1280×860에서 약 300px),
   * 지금 보고 있는 구역이 아래로 밀려 안 보입니다. 화면에 들어올 때 그
   * 구역만 사이드바 안에서 보이게 굴립니다 — 페이지 자체는 움직이지 않도록
   * 스크롤 상자의 scrollTop만 바꿉니다.
   */
  const subListRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open || collapsed) return;
    const active = subListRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const scroller = active?.closest<HTMLElement>(`.${styles.navScroll}`);
    if (!active || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.bottom > box.bottom) scroller.scrollTop += item.bottom - box.bottom + 12;
    else if (item.top < box.top) scroller.scrollTop -= box.top - item.top + 12;
  }, [pathname, open, collapsed]);

  // 접힌 사이드바에는 하위 구역을 펼칠 자리가 없습니다. Admin은 대시보드로
  // 가는 아이콘 하나가 되고, 기다리는 수는 아이콘 위에 붙습니다.
  if (collapsed) {
    return (
      <Link
        className={`${styles.navLink} ${insideAdmin ? styles.navLinkActive : ""}`}
        href="/admin"
        onClick={onNavigate}
        title={totalPending > 0 ? `Admin — 기다리는 일 ${totalPending}건` : "Admin"}
        aria-current={pathname === "/admin" ? "page" : undefined}
      >
        <Shield className={styles.navIcon} aria-hidden="true" />
        <span className={styles.navLabel}>Admin</span>
        {totalPending > 0 && (
          <span className={styles.navCount} aria-label={`기다리는 일 ${totalPending}건`}>
            {totalPending}
          </span>
        )}
      </Link>
    );
  }

  return (
    <div>
      <button
        className={`${styles.navLink} ${styles.navToggle} ${
          insideAdmin ? styles.navLinkActive : ""
        }`}
        type="button"
        aria-expanded={open}
        aria-controls="admin-subnav"
        onClick={toggle}
      >
        <Shield className={styles.navIcon} aria-hidden="true" />
        <span className={styles.navToggleLabel}>Admin</span>
        {/* 기다리는 일의 합. 펼쳐도 그대로 둡니다 — 구역마다의 수는 아래에
            따로 붙습니다. */}
        {totalPending > 0 && (
          <span className={styles.navCount} aria-label={`기다리는 일 ${totalPending}건`}>
            {totalPending}
          </span>
        )}
        <span aria-hidden="true" className={styles.navCaret}>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <ul
          className={`${styles.navList} ${styles.navSubList}`}
          id="admin-subnav"
          ref={subListRef}
        >
          {sections.map((section) => {
            // 가장 긴 경로가 이깁니다 — /admin 이 모든 구역을 먹지 않도록.
            const isActive =
              [...ADMIN_SECTIONS]
                .sort((a, b) => b.href.length - a.href.length)
                .find(
                  (candidate) =>
                    pathname === candidate.href || pathname.startsWith(`${candidate.href}/`),
                )?.key === section.key;

            return (
              <li key={section.key}>
                <Link
                  className={`${styles.navSubLink} ${isActive ? styles.navSubLinkActive : ""}`}
                  href={section.href}
                  aria-current={isActive ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {section.label}
                  {pending[section.key] > 0 && (
                    <span className={styles.navCount}>{pending[section.key]}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * 사이드바의 회원 상태 카드.
 *
 * 카드 전체가 Usage로 가는 링크입니다. 예전에는 카드 안에 "사용량 보기"
 * 버튼이 따로 있었는데, 바로 위의 Usage 메뉴와 같은 곳으로 가는 중복이라
 * 없앴습니다.
 *
 * 숫자는 일부러 적게 보여 주고, 자세한 내용은 Usage 화면에 맡깁니다.
 * 값은 모두 백엔드에서 옵니다 — 목업이 아닙니다.
 */
function MemberStatus({ onNavigate }: { onNavigate: () => void }) {
  const { state } = useMyQuarter();
  // 방금 빠진 금액(feat-spend-feedback) — "-12원"이 떠올랐다 사라지고 잔액이
  // 잠깐 빛납니다. 알림을 껐거나 움직임 줄이기면 null.
  const { lastSpend } = useSpendFeedback();

  if (state.phase !== "ready" || state.quarter.quarter === null) return null;

  const { quarter, allocation, days_remaining, membership_status } = state.quarter;
  const status = membership_status ?? "inactive";

  // 지갑은 하나입니다(single-wallet). 채팅도 영상도 같은 잔액에서 씁니다.
  const percent =
    allocation && allocation.budget_krw > 0
      ? Math.min(100, Math.round((allocation.consumed_krw / allocation.budget_krw) * 100))
      : 0;

  return (
    <Link
      className={styles.member}
      href="/usage"
      onClick={onNavigate}
      aria-label={`${quarter.display_name} 사용량 보기`}
    >
      <div className={styles.memberTop}>
        <span className={styles.memberSeason}>
          {quarter.display_name}
          {days_remaining !== null && <span className={styles.memberDday}>D-{days_remaining}</span>}
        </span>
        <span className={`badge ${MEMBERSHIP_BADGE[status]}`}>{MEMBERSHIP_LABEL[status]}</span>
      </div>

      <div className={styles.memberRange}>
        <span>
          {formatDate(quarter.starts_at)} – {formatDate(quarter.ends_at)}
        </span>
      </div>

      {allocation ? (
        <div className={styles.wallet}>
          <div className={styles.meterLabel}>
            <span>동아리 지원</span>
            <span
              className={`${styles.meterValue} ${lastSpend ? styles.spendPulse : ""}`}
              key={lastSpend ? `pulse-${lastSpend.id}` : "balance"}
            >
              {/* 차감되면 약 0.6초 동안 새 값까지 세어 내려갑니다. */}
              <AnimatedNumber value={allocation.remaining_krw} format={formatKrw} duration={0.6} />
              {lastSpend && (
                <span className={styles.spendChip} aria-hidden="true" data-testid="spend-chip">
                  -{formatKrw(lastSpend.amountKrw)}
                </span>
              )}
            </span>
          </div>
          <div
            className="meter"
            role="img"
            aria-label={`지원금 중 ${percent}% 사용`}
          >
            <div className="meter-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className={styles.walletSentence}>{walletSentence(allocation)}</p>
        </div>
      ) : (
        <p className={styles.memberEmpty}>
          {status === "active" ? "승인된 지원금이 없습니다." : "이번 분기에 참여하고 있지 않습니다."}
        </p>
      )}
    </Link>
  );
}
