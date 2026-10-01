"use client";

/**
 * Admin 안쪽의 틀: 빵가루 → 탭 → 분기 고르기 → 본문.
 *
 * 이전에는 Admin이 한 화면이었고, 열 개의 구역이 위에서 아래로 쌓여
 * 있었습니다. 구역을 경로로 나누면 "지금 어디에 있는지"와 "어디로 갈 수
 * 있는지"를 화면이 따로 말해 주어야 합니다. 그 둘이 빵가루와 탭입니다.
 *
 * 사이드바에도 같은 구역 목록이 들어 있는데 탭을 함께 두는 이유: 좁은
 * 화면에서는 사이드바가 접혀 있고, 넓은 화면에서도 지금 보고 있는 구역의
 * 이웃은 눈앞에 있는 쪽이 빠릅니다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAdminNav } from "@/app/components/AdminNavProvider";

import { useAdminQuarter, withQuarter } from "./AdminQuarterProvider";
import { activeSection, visibleSections } from "./sections";

import styles from "./admin.module.css";

/**
 * 빵가루의 마지막 칸.
 *
 * 구역까지는 경로만 보고 그릴 수 있지만 그 뒤(회원 상세의 이름 등)는
 * 화면이 불러온 데이터에 들어 있습니다. 그래서 화면이 알려 주면 틀이
 * 그립니다 — 같은 줄을 화면마다 다시 그리면 간격이 어긋납니다.
 */
const BreadcrumbTailContext = createContext<(label: string | null) => void>(() => {});

export function useBreadcrumbTail(label: string | null): void {
  const setTail = useContext(BreadcrumbTailContext);

  useEffect(() => {
    setTail(label);
    return () => setTail(null);
  }, [label, setTail]);
}

export default function AdminFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { quarters, selected, select, dashboard } = useAdminQuarter();
  // 사이드바가 이미 읽어 둔 값. 이 화면의 숫자가 도착하기 전까지 씁니다.
  const nav = useAdminNav();
  const [tail, setTail] = useState<string | null>(null);

  // 화면이 매번 새 함수를 받아 효과가 다시 돌지 않도록 고정합니다.
  const setTailStable = useCallback((label: string | null) => setTail(label), []);

  const current = activeSection(pathname);
  // 개발 도구는 백엔드가 개발 환경이라고 말할 때만 보입니다. 숨기는 것은
  // 편의일 뿐, 실제 차단은 백엔드가 404로 합니다.
  //
  // 탭이 뒤늦게 끼어들지 않도록, 이 화면의 숫자가 아직 없으면
  // 사이드바가 이미 읽어 둔 값을 씁니다. 둘이 잠깐이라도 어긋나면 같은
  // 환경에서 사이드바에는 있고 탭에는 없는 구역이 생깁니다.
  const isDevelopment = dashboard?.is_development ?? nav.isDevelopment;
  const sections = useMemo(() => visibleSections(isDevelopment), [isDevelopment]);

  // 손이 필요한 구역에 개수를 띄웁니다.
  const pending: Record<string, number> = {
    quarters: dashboard?.pending_applications ?? nav.pendingApplications,
    topups: dashboard?.pending_top_ups ?? nav.pendingTopUps,
  };

  return (
    <BreadcrumbTailContext.Provider value={setTailStable}>
      <div className={styles.frame}>
        <nav aria-label="현재 위치" className={styles.breadcrumbs}>
          <Link className={styles.crumb} href={withQuarter("/admin", selected?.id)}>
            Admin
          </Link>
          {current && current.key !== "dashboard" && (
            <>
              <span aria-hidden="true" className={styles.crumbSeparator}>
                ›
              </span>
              {tail === null ? (
                <span aria-current="page" className={styles.crumbCurrent}>
                  {current.label}
                </span>
              ) : (
                <Link className={styles.crumb} href={withQuarter(current.href, selected?.id)}>
                  {current.label}
                </Link>
              )}
            </>
          )}
          {tail !== null && (
            <>
              <span aria-hidden="true" className={styles.crumbSeparator}>
                ›
              </span>
              <span aria-current="page" className={styles.crumbCurrent}>
                {tail}
              </span>
            </>
          )}
        </nav>

        <div className={styles.tabsRow}>
          <ul className={styles.tabs}>
            {sections.map((section) => {
              const isActive = current?.key === section.key;

              if (section.comingSoon) {
                return (
                  <li key={section.key}>
                    <span
                      className={`${styles.tab} ${styles.tabDisabled}`}
                      title={`${section.label} — 준비 중`}
                    >
                      {section.label}
                      <span className="badge badge-mock">준비 중</span>
                    </span>
                  </li>
                );
              }

              return (
                <li key={section.key}>
                  <Link
                    className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
                    href={withQuarter(section.href, selected?.id)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {section.label}
                    {pending[section.key] > 0 && (
                      <span className={styles.tabCount}>{pending[section.key]}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          {quarters !== null && quarters.length > 1 && (
            <div className={styles.quarterSwitch}>
              <label className={styles.quarterSwitchLabel} htmlFor="admin-quarter">
                보고 있는 분기
              </label>
              <select
                className="field"
                id="admin-quarter"
                value={selected?.id ?? ""}
                onChange={(event) => select(Number(event.target.value))}
              >
                {quarters.map((quarter) => (
                  <option key={quarter.id} value={quarter.id}>
                    {quarter.display_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className={styles.frameBody}>{children}</div>
      </div>
    </BreadcrumbTailContext.Provider>
  );
}
