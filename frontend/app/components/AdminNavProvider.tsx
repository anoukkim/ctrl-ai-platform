"use client";

/**
 * 사이드바의 Admin 묶음이 필요한 것만 들고 있습니다.
 *
 * 사이드바는 Admin 레이아웃 밖에 있어서 `useAdminQuarter`에 닿지 못합니다.
 * 그래서 숫자를 여기서 한 번 더 읽습니다 — 다만 보고 있는 분기가 아니라
 * **지금 분기** 기준입니다. 사이드바가 답하는 질문이 "지금 손이 필요한
 * 일이 있나"이고, 지난 분기를 들여다보는 중에도 그 답은 달라지지
 * 않아야 하기 때문입니다.
 *
 * 관리자가 아니면 아무것도 부르지 않습니다. 회원에게는 403이 돌아올
 * 요청이고, 사이드바에 Admin 묶음 자체가 없습니다.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { getAdminDashboard } from "@/lib/admin";

import { useCurrentUser } from "./CurrentUserProvider";

interface AdminNavValue {
  pendingApplications: number;
  pendingTopUps: number;
  isDevelopment: boolean;
  refresh: () => Promise<void>;
}

const AdminNavContext = createContext<AdminNavValue>({
  pendingApplications: 0,
  pendingTopUps: 0,
  isDevelopment: false,
  refresh: async () => {},
});

export function useAdminNav(): AdminNavValue {
  return useContext(AdminNavContext);
}

export default function AdminNavProvider({ children }: { children: React.ReactNode }) {
  const { state } = useCurrentUser();
  const isAdmin = state.phase === "authenticated" && state.user.is_admin;

  const [value, setValue] = useState({
    pendingApplications: 0,
    pendingTopUps: 0,
    isDevelopment: false,
  });

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const dashboard = await getAdminDashboard();
      setValue({
        pendingApplications: dashboard.pending_applications,
        pendingTopUps: dashboard.pending_top_ups,
        isDevelopment: dashboard.is_development,
      });
    } catch {
      // 숫자를 못 읽어도 메뉴는 그려야 합니다. 배지만 보이지 않습니다.
    }
  }, [isAdmin]);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    getAdminDashboard()
      .then((dashboard) => {
        if (cancelled) return;
        setValue({
          pendingApplications: dashboard.pending_applications,
          pendingTopUps: dashboard.pending_top_ups,
          isDevelopment: dashboard.is_development,
        });
      })
      .catch(() => {
        /* 배지 없이 메뉴만 보여 줍니다 */
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  return (
    <AdminNavContext.Provider value={{ ...value, refresh }}>{children}</AdminNavContext.Provider>
  );
}
