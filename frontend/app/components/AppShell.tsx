"use client";

/**
 * 모든 화면을 감싸는 껍데기: 왼쪽 사이드바와 본문 영역.
 *
 * Client Component인 이유는 두 가지입니다. 현재 경로를 알아야 하고
 * (`usePathname`), 좁은 화면에서 메뉴 열림 상태를 기억해야 합니다.
 * 감싸는 화면들은 그대로 Server Component입니다.
 *
 * 언어 규칙: 제품/기능 이름(Chat, Project Builder, Video Generator,
 * CtrlAI Apps, CtrlAITube, Usage, Profile, Admin)은 영어를 유지하고,
 * 그 외 회원이 읽는 문구는 모두 한국어입니다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  CURRENT_USER,
  MOCK_ALLOCATIONS,
  SEASON_RANGE,
  formatCompact,
  formatDate,
  seasonDaysRemaining,
  usedPercent,
} from "@/lib/mock-data";

import styles from "./AppShell.module.css";

interface NavItem {
  href: string;
  label: string;
  glyph: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    // 묶음 제목은 일반 UI 문구라 한국어, 안에 있는 화면 이름은 제품 이름이라
    // 영어를 유지합니다.
    label: "만들기",
    items: [
      { href: "/", label: "Chat", glyph: "◇" },
      { href: "/builder", label: "Project Builder", glyph: "◆" },
      { href: "/video", label: "Video Generator", glyph: "▶" },
    ],
  },
  {
    label: "둘러보기",
    items: [
      { href: "/ctrlaistore", label: "CtrlAI Apps", glyph: "▣" },
      { href: "/ctrlaitube", label: "CtrlAITube", glyph: "◉" },
    ],
  },
  {
    label: "내 정보",
    items: [
      { href: "/usage", label: "Usage", glyph: "◑" },
      { href: "/profile", label: "Profile", glyph: "○" },
    ],
  },
];

/** 관리자에게만 보입니다. 회원 자격과 크레딧이 시즌 단위로 관리되므로
 *  Admin은 숨겨진 설정 화면이 아니라 독립된 영역입니다. */
const ADMIN_GROUP: NavGroup = {
  label: "관리",
  items: [{ href: "/admin", label: "Admin", glyph: "⚙" }],
};

/**
 * 화면 전체를 작업 공간으로 쓰는 경로.
 *
 * /builder 와 /video 는 프로젝트 목록이라 보통 화면처럼 여백을 둡니다.
 * 그 아래 /builder/{id}, /video/{id} 만 작업 공간이라 여백과 최대 너비를
 * 없애고 높이를 화면에 맞춥니다.
 */
const WORKSPACE_PATTERN = /^\/(builder|video)\/[^/]+/;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const groups = CURRENT_USER.role === "admin" ? [...NAV_GROUPS, ADMIN_GROUP] : NAV_GROUPS;
  const isWorkspace = WORKSPACE_PATTERN.test(pathname);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brandLink} href="/" onClick={() => setMenuOpen(false)}>
          <span className={styles.brandMark}>
            <span className={styles.brandGlyph} aria-hidden="true">
              AI
            </span>
            Ctrl AI
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
            <span className={styles.brandGlyph} aria-hidden="true">
              AI
            </span>
            Ctrl AI
          </span>
          <span className={styles.brandPhase}>Phase 0 — 화면 미리보기</span>
        </div>

        <div className={styles.navScroll}>
          {groups.map((group) => (
            <div key={group.label}>
              <p className={styles.navGroupLabel}>{group.label}</p>
              <ul className={styles.navList}>
                {group.items.map((item) => {
                  // "/"는 Chat이므로 정확히 일치할 때만 선택 표시를 합니다.
                  const isActive =
                    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

                  return (
                    <li key={item.href}>
                      <Link
                        className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span className={styles.navGlyph} aria-hidden="true">
                          {item.glyph}
                        </span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <MemberStatus onNavigate={() => setMenuOpen(false)} />
        </div>

        <div className={styles.navFooter}>
          <span className={styles.navUser}>
            <span className={styles.navAvatar} aria-hidden="true">
              {CURRENT_USER.displayName.slice(0, 1)}
            </span>
            {CURRENT_USER.displayName}
          </span>
          <span className={styles.navHint}>로그인 기능은 아직 준비 중입니다</span>
        </div>
      </nav>

      <main className={`${styles.main} ${isWorkspace ? styles.mainWorkspace : ""}`}>
        <div className={styles.mainInner}>{children}</div>
      </main>
    </div>
  );
}

/**
 * 사이드바의 회원 상태 블록.
 *
 * 시즌은 4개월 단위입니다(분기가 아닙니다). 숫자는 일부러 적게 보여 주고,
 * 자세한 내용은 Usage 화면에서 확인하도록 합니다.
 */
function MemberStatus({ onNavigate }: { onNavigate: () => void }) {
  const daysLeft = seasonDaysRemaining();

  return (
    <section className={styles.member} aria-label="회원 상태">
      <div className={styles.memberTop}>
        <span className={styles.memberSeason}>{SEASON_RANGE.name}</span>
        <span className="badge badge-ok">활동 회원</span>
      </div>

      <div className={styles.memberRange}>
        <span>
          {formatDate(SEASON_RANGE.startsAt)} – {formatDate(SEASON_RANGE.endsAt)}
        </span>
        <span className={styles.memberDday}>D-{daysLeft}</span>
      </div>

      <div className={styles.memberMeters}>
        {MOCK_ALLOCATIONS.map((allocation, index) => {
          const percent = usedPercent(allocation);

          return (
            <div className={styles.meterRow} key={allocation.provider}>
              <div className={styles.meterLabel}>
                <span>{allocation.provider}</span>
                <span className={styles.meterValue}>
                  {allocation.unit === "토큰"
                    ? `${formatCompact(allocation.used)} / ${formatCompact(allocation.allocated)}`
                    : `${allocation.used} / ${allocation.allocated}`}
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

      <Link className={styles.memberLink} href="/usage" onClick={onNavigate}>
        사용량 보기
      </Link>
    </section>
  );
}
