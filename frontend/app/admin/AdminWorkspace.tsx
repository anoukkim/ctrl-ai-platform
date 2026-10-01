"use client";

/**
 * Admin 화면을 하나의 분기 중심으로 묶습니다.
 *
 * 분기 목록을 한 번만 불러와 아래 화면들이 같은 분기를 보게 합니다.
 * 회원 관리와 지원금 조정이 서로 다른 분기를 보고 있으면 숫자가 맞지 않는
 * 것처럼 보이기 때문입니다.
 */

import { useEffect, useState } from "react";

import { describeError } from "@/lib/http";
import { listQuarters, type Quarter } from "@/lib/quarters";

import AuditLogView from "./AuditLog";
import MemberTable from "./MemberTable";
import QuarterAdmin from "./QuarterAdmin";
import VideoModelCatalog from "./VideoModelCatalog";
import styles from "./admin.module.css";

export default function AdminWorkspace() {
  const [quarters, setQuarters] = useState<Quarter[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listQuarters()
      .then((rows) => {
        if (cancelled) return;
        setQuarters(rows);
        // 백엔드의 current_quarter와 같은 규칙으로 고릅니다: 신청을 받는
        // 분기가 우선이고, 그중에서도 시작이 빠른 쪽입니다. 규칙이 다르면
        // Admin이 보는 분기와 회원이 보는 분기가 어긋나 숫자가 맞지 않는
        // 것처럼 보입니다. (목록은 최신순이므로 뒤에서부터 찾습니다.)
        const byStart = [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        const current =
          byStart.find((q) => q.status === "application_open") ??
          byStart.find((q) => q.status === "active") ??
          rows[0];
        setSelectedId((previous) => previous ?? current?.id ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="card">
        <p className="small muted">분기 정보를 불러오지 못했습니다. {error}.</p>
      </div>
    );
  }

  const selected = quarters?.find((q) => q.id === selectedId) ?? null;

  return (
    <div className={styles.sections}>
      {quarters !== null && quarters.length > 1 && (
        <section>
          <h2 className="section-title">보고 있는 분기</h2>
          <div className={styles.quarterPicker}>
            {quarters.map((quarter) => (
              <button
                className={`${styles.quarterPick} ${
                  quarter.id === selectedId ? styles.quarterPickActive : ""
                }`}
                key={quarter.id}
                type="button"
                onClick={() => setSelectedId(quarter.id)}
              >
                {quarter.display_name}
              </button>
            ))}
          </div>
        </section>
      )}

      <MemberTable quarter={selected} />

      <QuarterAdmin />

      <VideoModelCatalog />

      <AuditLogView />
    </div>
  );
}
