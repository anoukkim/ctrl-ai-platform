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
  Clapperboard,
  Code2,
  Compass,
  Gauge,
  LayoutGrid,
  Lock,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
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
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { activeSection, visibleSections } from "@/app/admin/sections";

import { VIDEO_LOCKED_HINT } from "@/lib/site";
import { useMediaQuery } from "@/lib/layout-prefs";
import { useTheme } from "@/lib/theme";
import { isRunning, useRuns, useServerRunsSync } from "@/lib/running";

import AnimatedNumber from "./AnimatedNumber";
import BrandMark from "./BrandMark";
import { FeedbackDialog } from "./FeedbackButton";
import MenuButton from "./MenuButton";
import NotificationBell from "./NotificationBell";
import GuideProvider, { useGuide } from "./FirstVisitGuide";
import Skeleton from "./Skeleton";

import { useAdminNav } from "./AdminNavProvider";
import { isPublicPath, useCurrentUser } from "./CurrentUserProvider";
import { useMyQuarter } from "./MyQuarterProvider";
import { useSite, useSiteLoaded } from "./SiteProvider";
import { useSpendFeedback } from "./SpendFeedbackProvider";

import {
  STANDING_BADGE,
  STANDING_LABEL,
  standingOf,
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

/**
 * 관리자에게만 보입니다. 회원 자격과 크레딧이 분기 단위로 관리되므로
 * Admin은 숨겨진 설정 화면이 아니라 독립된 영역입니다.
 *
 * Admin은 다른 항목과 달리 눌렀을 때 아래로 펼쳐집니다. 구역이 여섯
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
  // owner-polish-3 (c2): 의견 보내기 is a menu item now; its dialog is ours to open.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const router = useRouter();
  const guide = useRef<() => void>(() => {});
  const openGuide = () => guide.current();
  const go = (href: string) => {
    setMenuOpen(false);
    router.push(href);
  };
  // 사이드바는 로그인을 확인한 뒤에만 그려지고, 그 확인은 브라우저에서
  // 일어납니다. 그래서 처음 값에서 바로 읽어도 서버가 그린 HTML과
  // 어긋나지 않습니다 — 효과로 읽으면 한 번 펼쳐졌다 접히며 깜빡입니다.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { state, signOut } = useCurrentUser();
  const { theme, toggle: toggleTheme } = useTheme();
  // The sidebar's header is hidden under 60rem (the top bar takes over): one bell, in the right place.
  const narrow = useMediaQuery("(max-width: 59.99rem)");
  // owner-polish 6: Video Generator가 회원에게 잠겨 있으면 메뉴가 그렇게 말합니다.
  const site = useSite();
  const siteLoaded = useSiteLoaded();
  // background-runs: the running dots come from the server — a reply or a
  // build goes on after its page is closed.
  useServerRunsSync(state.phase === "authenticated" && !isPublicPath(pathname));

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
    <GuideHandle register={(open) => { guide.current = open; }} />
    <div className={`${styles.shell} ${collapsed ? styles.shellCollapsed : ""}`}>
      <header className={styles.topbar}>
        <Link className={styles.brandLink} href="/" onClick={() => setMenuOpen(false)}>
          <span className={styles.brandMark}>
            <BrandMark size={26} />
            CTRL+AI
          </span>
        </Link>
        <span className={styles.topbarTools}>
          {/* owner-polish-3 (c2): on a phone the sidebar's header is hidden, so
              the bell lives in the top bar — reachable without opening 메뉴. */}
          {narrow && <NotificationBell className={styles.footerButton} onNavigate={() => setMenuOpen(false)} />}
          <button
            className={styles.menuButton}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
          >
            {menuOpen ? "닫기" : "메뉴"}
          </button>
        </span>
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
            {/* owner-polish-3 (c2): the bell lives up here beside the name — its
                popover opens below it, over nothing. The footer was too crowded. */}
            <span className={styles.navBrandTools}>
              {!narrow && <NotificationBell className={styles.footerButton} onNavigate={() => setMenuOpen(false)} />}
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
            </span>
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
                lockedHints={siteLoaded && !site.video_open ? { "/video": VIDEO_LOCKED_HINT } : {}}
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
            {/* Usage와 Profile은 계정 메뉴에만 있어요 — 같은 것이 두 번 보이지
                않게 (owner, 2026-10-17). */}
            <MemberStatus onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>

        {/* 계정 영역 (owner-polish-3 (c2)): the way common sites split it —
            the account row is a button that opens a small menu (Profile,
            Usage, 테마, 처음 안내, 의견 보내기, 로그아웃); the line under it
            keeps only 개인정보 · 약관. The bell moved up beside the name, so
            nothing here overlaps anything. */}
        <div className={styles.navFooter}>
          <MenuButton
            className={styles.navUser}
            label={`${user.display_name} — 계정 메뉴`}
            title={collapsed ? user.display_name : undefined}
            align="start"
            placement="up"
            items={[
              { label: "Profile", icon: <User size={15} />, onSelect: () => go("/profile") },
              { label: "Usage", icon: <Gauge size={15} />, onSelect: () => go("/usage") },
              {
                label: theme === "dark" ? "밝은 화면으로" : "어두운 화면으로",
                icon: theme === "dark" ? <Sun size={15} /> : <Moon size={15} />,
                onSelect: toggleTheme,
              },
              { label: "처음 안내 다시 보기", icon: <Compass size={15} />, onSelect: () => { setMenuOpen(false); openGuide(); } },
              { label: "의견 보내기", icon: <MessageSquarePlus size={15} />, onSelect: () => setFeedbackOpen(true) },
              { label: "로그아웃", icon: <LogOut size={15} />, danger: true, onSelect: () => void signOut() },
            ]}
          >
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
          </MenuButton>
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
        </div>
        {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
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

/** Hands the guide's `open` to the shell — the account menu's 처음 안내 다시
 *  보기 lives outside the provider's own tree (owner-polish-3 (c2)). */
function GuideHandle({ register }: { register: (open: () => void) => void }) {
  const { open } = useGuide();
  useEffect(() => {
    register(open);
  }, [open, register]);
  return null;
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
  // running-state-calm: a pulsing dot on Chat / Project Builder while a reply
  // or a build runs — it stays while the member looks at other screens.
  const runs = useRuns();
  const runningAt: Record<string, boolean> = {
    "/": isRunning(runs, "chat"),
    "/builder": isRunning(runs, "builder"),
  };
  return (
    <div className={styles.navGroup}>
      <p className={styles.navGroupLabel}>{group.label}</p>
      <ul className={styles.navList}>
        {group.items.map((item) => {
          // "/"는 Chat이므로 정확히 일치할 때만 선택 표시를 합니다.
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          // 회원에게 잠긴 화면 (owner-polish 6): 자물쇠와 "다음 단계에서 열려요".
          // 링크는 그대로 — 화면이 이유를 말합니다.
          const lockedHint = lockedHints[item.href];
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
                {runningAt[item.href] && (
                  <span className={`run-dot ${styles.navRunDot}`} role="img" aria-label="작업 중" data-testid="nav-running" />
                )}
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
  const { pendingApplications, openReports, pendingTopUps, isDevelopment } = useAdminNav();

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
  // admin-consolidation v3: 승인 대기 lives in Members, 열린 신고 in Community.
  const pending: Record<string, number> = {
    members: pendingApplications,
    community: openReports,
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
            const isActive = activeSection(pathname)?.key === section.key;

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

  const { quarter, allocation, days_remaining } = state.quarter;
  // The same standing as Usage and Profile: 승인 대기 shows here too.
  const standing = standingOf(state.quarter);

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
        <span className={`badge ${STANDING_BADGE[standing]}`}>{STANDING_LABEL[standing]}</span>
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
              data-wallet-balance="true"
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
            aria-label={`동아리 지원 중 ${percent}% 사용`}
          >
            <div className="meter-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className={styles.walletSentence}>{walletSentence(allocation)}</p>
        </div>
      ) : (
        <p className={styles.memberEmpty}>
          {standing === "active"
            ? "동아리 지원을 준비하고 있어요."
            : standing === "pending"
              ? "승인되면 동아리 지원이 생겨요."
              : standing === "stopped"
                ? "이번 분기 참여가 중지됐어요."
                : "이번 분기에 참여하고 있지 않아요."}
        </p>
      )}
    </Link>
  );
}
