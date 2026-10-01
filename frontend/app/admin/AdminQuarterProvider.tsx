"use client";

/**
 * Admin이 보고 있는 분기를 한곳에서 들고 있습니다.
 *
 * 참여도 지원금도 분기마다 따로이므로, 어느 분기를 보고 있는지가 분명해야
 * 숫자를 읽을 수 있습니다. 회원 화면과 분기 화면이 서로 다른 분기를 보고
 * 있으면 숫자가 맞지 않는 것처럼 보입니다.
 *
 * 고른 분기는 주소(`?quarter=`)에도 적습니다. 이전에는 화면 안의 상태로만
 * 들고 있었는데, Admin이 여러 경로로 나뉘면 그 상태가 이동할 때마다
 * 사라집니다. 주소에 있으면 새로 고쳐도, 링크를 보내도 같은 분기가
 * 열립니다.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getAdminDashboard, type AdminDashboard } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { listQuarters, type Quarter } from "@/lib/quarters";

interface AdminQuarterValue {
  quarters: Quarter[] | null;
  selected: Quarter | null;
  select: (quarterId: number) => void;
  /** 고른 분기의 대시보드 숫자. 카드와 배지가 같은 값을 읽습니다. */
  dashboard: AdminDashboard | null;
  /** 무언가를 바꾼 뒤 숫자를 다시 읽습니다. */
  refresh: () => Promise<void>;
  error: string | null;
}

const AdminQuarterContext = createContext<AdminQuarterValue | null>(null);

export function useAdminQuarter(): AdminQuarterValue {
  const value = useContext(AdminQuarterContext);
  if (value === null) {
    throw new Error("useAdminQuarter는 Admin 레이아웃 안에서만 쓸 수 있습니다.");
  }
  return value;
}

/**
 * 백엔드의 `current_quarter`와 같은 규칙으로 고릅니다.
 *
 * 규칙이 다르면 Admin이 보는 분기와 회원이 보는 분기가 어긋나, 같은 숫자를
 * 두 화면이 다르게 보여 줍니다. (목록은 최신순이므로 시작일로 다시
 * 정렬한 뒤 찾습니다.)
 */
function defaultQuarter(rows: Quarter[]): Quarter | undefined {
  const byStart = [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    byStart.find((q) => q.status === "application_open") ??
    byStart.find((q) => q.status === "active") ??
    rows[0]
  );
}

export default function AdminQuarterProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [quarters, setQuarters] = useState<Quarter[] | null>(null);
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fromUrl = Number(searchParams.get("quarter")) || null;

  // 분기 목록. 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listQuarters()
      .then((rows) => {
        if (!cancelled) setQuarters(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(() => {
    if (quarters === null) return null;
    // 주소의 분기가 실제로 있을 때만 씁니다. 지워진 분기를 가리키는 링크가
    // 빈 화면이 되지 않도록 기본 분기로 돌아갑니다.
    return quarters.find((q) => q.id === fromUrl) ?? defaultQuarter(quarters) ?? null;
  }, [quarters, fromUrl]);

  const selectedId = selected?.id ?? null;

  // 고른 분기의 숫자.
  useEffect(() => {
    if (selectedId === null) {
      // 분기가 하나도 없는 설치 직후에도 대시보드는 열려야 합니다.
      if (quarters !== null && quarters.length === 0) {
        getAdminDashboard()
          .then(setDashboard)
          .catch((caught: unknown) => setError(describeError(caught)));
      }
      return;
    }

    let cancelled = false;

    getAdminDashboard(selectedId)
      .then((rows) => {
        if (!cancelled) setDashboard(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, quarters]);

  const select = useCallback(
    (quarterId: number) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("quarter", String(quarterId));
      // `replace`이지 `push`가 아닙니다. 분기를 고르는 것은 새 화면으로
      // 가는 일이 아니므로, 뒤로 가기가 분기 선택 이력으로 채워지면
      // 안 됩니다.
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const refresh = useCallback(async () => {
    try {
      const [rows, figures] = await Promise.all([
        listQuarters(),
        getAdminDashboard(selectedId),
      ]);
      setQuarters(rows);
      setDashboard(figures);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [selectedId]);

  const value = useMemo(
    () => ({ quarters, selected, select, dashboard, refresh, error }),
    [quarters, selected, select, dashboard, refresh, error],
  );

  return <AdminQuarterContext.Provider value={value}>{children}</AdminQuarterContext.Provider>;
}

/**
 * 다른 경로로 갈 때 고른 분기를 가지고 갑니다.
 *
 * Admin 안의 링크는 모두 이것을 통과해야 합니다. 그러지 않으면 회원
 * 목록에서 분기를 고르고 상세로 들어갔을 때 다른 분기가 열립니다.
 */
export function withQuarter(href: string, quarterId: number | null | undefined): string {
  if (!quarterId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}quarter=${quarterId}`;
}
