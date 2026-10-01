"use client";

/**
 * 모든 화면을 감싸는 껍데기: 왼쪽 사이드바와 본문 영역.
 *
 * Client Component인 이유는 두 가지입니다. 현재 경로를 알아야 하고
 * (`usePathname`), 좁은 화면에서 메뉴 열림 상태를 기억해야 합니다.
 * 감싸는 화면들은 그대로 Server Component입니다.
 *
 * 언어 규칙: 메뉴는 전부 영어입니다 — 묶음 제목(Create, Explore,
 * Account)과 화면 이름(Chat, Project Builder, Video Generator,
 * CtrlAIApps, CtrlAITube, Usage, Profile, Report Issue, Admin) 모두.
 * 메뉴 밖에서 회원이 읽는 문구는 모두 한국어입니다.
 *
 * 관리 묶음은 따로 없습니다. Admin은 제목이 아니라 눌러서 펼치는 항목
 * 자체이고(`AdminNavBlock`), 그 이름은 이미 영어입니다.
 */

import {
  CircleAlert,
  Clapperboard,
  Code2,
  Gauge,
  LayoutGrid,
  MessageSquare,
  PlayCircle,
  Shield,
  User,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ADMIN_SECTIONS, visibleSections } from "@/app/admin/sections";

import BrandMark from "./BrandMark";

import { useAdminNav } from "./AdminNavProvider";
import { isPublicPath, useCurrentUser } from "./CurrentUserProvider";
import { useMyQuarter } from "./MyQuarterProvider";

import {
  MEMBERSHIP_BADGE,
  MEMBERSHIP_LABEL,
  formatDate,
  formatKrw,
} from "@/lib/quarters";

import styles from "./AppShell.module.css";

interface NavItem {
  href: string;
  label: string;
  /** lucide 아이콘 한 벌만 씁니다. 크기와 선 굵기는 CSS가 정합니다. */
  Icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * 사이드바 위쪽: 무언가를 만들거나 둘러보는 곳.
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
      { href: "/builder", label: "Project Builder", Icon: Code2 },
      { href: "/video", label: "Video Generator", Icon: Clapperboard },
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
    { href: "/issues", label: "Report Issue", Icon: CircleAlert },
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
  const { state, signOut } = useCurrentUser();

  // 로그인/회원가입 화면에는 사이드바를 두지 않습니다.
  if (isPublicPath(pathname)) {
    return <div className={styles.bare}>{children}</div>;
  }

  // 아직 확인 중이거나 로그인하지 않았다면 본문을 그리지 않습니다.
  // 로그인하지 않은 경우의 이동은 CurrentUserProvider가 맡습니다.
  if (state.phase !== "authenticated") {
    return (
      <div className={styles.bare}>
        <p className="small muted" style={{ padding: "2rem", textAlign: "center" }}>
          {state.phase === "loading" ? "불러오는 중…" : "로그인 화면으로 이동합니다…"}
        </p>
      </div>
    );
  }

  const user = state.user;
  const isWorkspace = WORKSPACE_PATTERN.test(pathname);
  const isChat = pathname === CHAT_PATH;

  return (
    <div className={styles.shell}>
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
          <span className={styles.brandMark}>
            <BrandMark size={28} />
            CTRL+AI
          </span>
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
              />
            ))}

            {/* Admin 메뉴는 관리자에게만 보입니다. 보이지 않게 하는 것은
                편의일 뿐이고, 실제 차단은 백엔드의 require_admin이 합니다.
                위쪽 묶음에 붙입니다 — 아래쪽은 Account와 계정 영역
                전용입니다. */}
            {user.is_admin && (
              <AdminNavBlock pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            )}
          </div>

          {/* 위아래 묶음 사이의 빈 공간. 화면이 길면 늘어납니다. */}
          <div className={styles.navSpacer} aria-hidden="true" />

          <div className={styles.navBottom}>
            <NavGroupBlock
              group={PERSONAL_GROUP}
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
            />
            <MemberStatus onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>

        <div className={styles.navFooter}>
          <span className={styles.navUser}>
            <span className={styles.navAvatar} aria-hidden="true">
              {user.display_name.slice(0, 1)}
            </span>
            <span className={styles.navUserNames}>
              {user.display_name}
              <span className={styles.navUserHandle}>@{user.username}</span>
            </span>
          </span>
          <button className={styles.signOut} type="button" onClick={() => void signOut()}>
            로그아웃
          </button>
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
  );
}

/** 메뉴 한 묶음. 위/아래 두 곳에서 같은 모양으로 그립니다. */
function NavGroupBlock({
  group,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div>
      <p className={styles.navGroupLabel}>{group.label}</p>
      <ul className={styles.navList}>
        {group.items.map((item) => {
          // "/"는 Chat이므로 정확히 일치할 때만 선택 표시를 합니다.
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <li key={item.href}>
              <Link
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                onClick={onNavigate}
              >
                <item.Icon className={styles.navIcon} aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 사이드바의 Admin 묶음 — 눌러서 펼칩니다.
 *
 * 다른 묶음(Create, Explore)은 제목이 글자일 뿐이고 항목이 두세 개
 * 입니다. Admin은 구역이 아홉 개라, 묶음 제목 자체를 누를 수 있는 단추로
 * 두고 아래에 구역을 폅니다.
 *
 * 펼친 상태는 브라우저에 남겨 둡니다. 회원마다 쓰는 구역이 다르고,
 * 화면을 옮길 때마다 다시 펼치게 하면 두 번 누르는 메뉴가 됩니다.
 *
 * 숫자 배지는 손이 필요한 구역에만 붙습니다 — 심사를 기다리는 신청과
 * 확인을 기다리는 충전입니다. 둘 다 사람이 움직이지 않으면 회원이 기다리게
 * 되는 일입니다.
 */
function AdminNavBlock({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
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
  const totalPending = pendingApplications + pendingTopUps;
  const insideAdmin = pathname.startsWith("/admin");

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
        {!open && totalPending > 0 && (
          <span className={styles.navCount}>{totalPending}</span>
        )}
        <span aria-hidden="true" className={styles.navCaret}>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <ul className={`${styles.navList} ${styles.navSubList}`} id="admin-subnav">
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

  if (state.phase !== "ready" || state.quarter.quarter === null) return null;

  const { quarter, allocation, days_remaining, membership_status } = state.quarter;
  const status = membership_status ?? "inactive";

  const meters = allocation
    ? [
        {
          label: "Build",
          budget: allocation.build_budget_krw,
          consumed: allocation.build_consumed_krw,
        },
        {
          label: "Video",
          budget: allocation.video_budget_krw,
          consumed: allocation.video_consumed_krw,
        },
      ]
    : [];

  return (
    <Link
      className={styles.member}
      href="/usage"
      onClick={onNavigate}
      aria-label={`${quarter.display_name} 사용량 보기`}
    >
      <div className={styles.memberTop}>
        <span className={styles.memberSeason}>{quarter.display_name}</span>
        <span className={`badge ${MEMBERSHIP_BADGE[status]}`}>{MEMBERSHIP_LABEL[status]}</span>
      </div>

      <div className={styles.memberRange}>
        <span>
          {formatDate(quarter.starts_at)} – {formatDate(quarter.ends_at)}
        </span>
        {days_remaining !== null && <span className={styles.memberDday}>D-{days_remaining}</span>}
      </div>

      {meters.length > 0 ? (
        <div className={styles.memberMeters}>
          {meters.map((meter, index) => {
            const percent =
              meter.budget > 0
                ? Math.min(100, Math.round((meter.consumed / meter.budget) * 100))
                : 0;

            return (
              <div className={styles.meterRow} key={meter.label}>
                <div className={styles.meterLabel}>
                  <span>{meter.label}</span>
                  <span className={styles.meterValue}>
                    {formatKrw(meter.budget - meter.consumed)} 남음
                  </span>
                </div>
                <div className="meter">
                  <div
                    className={`meter-fill ${index === 1 ? "meter-fill-blue" : ""}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className={styles.memberEmpty}>
          {status === "active" ? "승인된 지원금이 없습니다." : "이번 분기에 참여하고 있지 않습니다."}
        </p>
      )}
    </Link>
  );
}
