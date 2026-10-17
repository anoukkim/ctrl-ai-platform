"use client";

/**
 * 회원 상세 › 지운 작업 (admin-consolidation v3, owner 2026-10-17).
 *
 * Deleted Items가 회원 상세로 왔어요: 이 회원이 지운 프로젝트와 영상을 보고,
 * 되살리거나(복구) 사유를 적고 완전히 삭제해요 (둘 다 감사 기록에 남음).
 * 남아 있는 것은 분기 마감 때 함께 사라져요 — 그 규칙은 예전과 같아요.
 */

import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { WORK_KIND_LABEL, listDeletedItems, purgeWork, restoreWork, type DeletedItem } from "@/lib/projects";

import ResultMessage, { type Result } from "../../components/ResultMessage";

import styles from "../../admin.module.css";

export default function MemberDeletedWork({ userId, onChanged }: { userId: number; onChanged?: () => void }) {
  const [items, setItems] = useState<DeletedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await listDeletedItems();
    setItems(rows.filter((row) => row.owner_user_id === userId));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    listDeletedItems()
      .then((rows) => {
        if (!cancelled) setItems(rows.filter((row) => row.owner_user_id === userId));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const act = useCallback(
    async (text: string, action: () => Promise<void>) => {
      setBusy(true);
      try {
        await action();
        setResult({ kind: "ok", text });
        await load();
        onChanged?.();
      } catch (caught) {
        setResult({ kind: "error", text: describeError(caught) });
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [load, onChanged],
  );

  return (
    <section aria-labelledby="member-deleted" data-testid="member-deleted-work">
      <h2 className="section-title" id="member-deleted">
        지운 작업
        <span className={styles.sectionNote}>분기 마감 때 남아 있으면 함께 사라져요</span>
      </h2>
      <ResultMessage result={result} onDismiss={() => setResult(null)} />
      {error !== null ? (
        <div className="card">
          <p className="small muted">지운 작업을 불러오지 못했습니다. {error}.</p>
        </div>
      ) : items === null ? (
        <p className="small muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="small muted">지운 작업이 없어요.</p>
        </div>
      ) : (
        <ul className={styles.deletedList}>
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className={styles.deletedRow}>
              <span>
                <strong>{item.name}</strong>{" "}
                <span className="small dim">
                  {WORK_KIND_LABEL[item.kind]} · {formatWhen(item.deleted_at)}에 지움
                </span>
              </span>
              <span className={styles.rowButtons}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: `복구 — ${item.name}`,
                      effect: `${item.owner_display_name}의 ${WORK_KIND_LABEL[item.kind]} '${item.name}'이 다시 보이게 됩니다.`,
                      confirmLabel: "복구",
                      onConfirm: () => act(`'${item.name}'을(를) 복구했습니다.`, () => restoreWork(item.kind, item.id)),
                    })
                  }
                >
                  복구
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: `완전히 삭제 — ${item.name}`,
                      effect: [
                        `${item.owner_display_name}의 ${WORK_KIND_LABEL[item.kind]} '${item.name}'이 데이터베이스와 서버에서 사라집니다. 되살릴 수 없습니다.`,
                        item.kind === "builder"
                          ? "파일, 버전 기록, 앱 폴더(apps.ctrlai.my), 앱의 저장 데이터와 동의가 함께 지워집니다."
                          : "모든 버전과 저장된 영상 파일이 함께 지워집니다.",
                        "사용량 기록과 지갑은 그대로입니다 — 이미 쓴 돈은 그대로 남고, 내역에는 이름이 '(삭제됨)'으로 남습니다.",
                        "사유와 함께 감사 기록에 남습니다.",
                      ],
                      confirmLabel: "완전히 삭제",
                      danger: true,
                      reason: { label: "사유", placeholder: "예: 회원이 요청함", required: true },
                      onConfirm: (reason) =>
                        act(`'${item.name}'을(를) 완전히 삭제했습니다.`, () => purgeWork(item.kind, item.id, reason)),
                    })
                  }
                >
                  완전히 삭제
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}
