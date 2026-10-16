"use client";

/**
 * 분기 마감 (cost-clarity) — 지갑을 모두 멈추고, 남은 돈을 회원마다 회수로
 * 적고, 고른 비율만큼은 다음 분기 승인 때 그 회원의 새 지갑에 더합니다.
 *
 * 지갑은 지우지 않습니다. 마감한 분기는 다시 열 수 없으므로, 회원별
 * 회수·이월 금액을 미리 보여 준 뒤에만 확인할 수 있습니다. 되살리지 않은
 * Deleted Items는 마감과 함께 완전히 삭제됩니다(ui-improvements B, 오너
 * 확정) — 몇 개인지도 미리 보여 줍니다.
 */

import { useEffect, useState } from "react";

import DialogShell from "@/app/components/DialogShell";
import { closeQuarter, getClosePreview, type ClosePreview } from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import confirmStyles from "@/app/components/confirm-dialog.module.css";
import styles from "../admin.module.css";

export default function CloseQuarterDialog({
  quarterId,
  quarterName,
  onClose,
  onClosed,
}: {
  quarterId: number;
  quarterName: string;
  onClose: () => void;
  onClosed: (preview: ClosePreview) => void;
}) {
  const [percent, setPercent] = useState(0);
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getClosePreview(quarterId, percent)
      .then((loaded) => {
        if (!cancelled) setPreview(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [quarterId, percent]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onClosed(await closeQuarter(quarterId, percent));
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <DialogShell onClose={onClose} labelledBy="close-quarter-title" describedBy="close-quarter-effect">
      <h2 className={confirmStyles.dialogTitle} id="close-quarter-title">
        {quarterName} 분기 마감
      </h2>
      <ul className={`${confirmStyles.dialogEffect} ${confirmStyles.dialogEffectList}`} id="close-quarter-effect">
        <li>모든 회원의 이 분기 지갑이 멈춥니다. 더는 아무것도 차감되지 않습니다.</li>
        <li>남은 지원금은 회원마다 &ldquo;회수&rdquo;로 기록되고 동아리로 돌아갑니다.</li>
        <li>아래 비율만큼은 다음 분기 참여가 승인될 때 그 회원의 새 지갑에 더해집니다.</li>
        <li>
          Deleted Items에 남아 있는(되살리지 않은) 작업물은 마감과 함께 <strong>완전히 삭제</strong>
          됩니다 — 사용량 기록과 지갑은 그대로입니다.
        </li>
        <li>지갑은 지우지 않고, 감사 기록에 남습니다. 마감한 분기는 다시 열 수 없습니다.</li>
      </ul>

      <div className={confirmStyles.dialogField}>
        <label className={confirmStyles.fieldLabel} htmlFor="close-quarter-percent">
          다음 분기로 이월할 비율 (%)
        </label>
        <input
          className="field"
          id="close-quarter-percent"
          type="number"
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(event) =>
            setPercent(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))
          }
        />
        <p className={styles.fieldHint}>기본은 0% — 남은 돈은 모두 회수합니다.</p>
      </div>

      {preview !== null && (
        <div className="table-wrap" style={{ maxHeight: "16rem", overflowY: "auto" }}>
          <table className="table" data-testid="close-preview">
            <thead>
              <tr>
                <th scope="col">회원</th>
                <th scope="col">지급</th>
                <th scope="col">사용</th>
                <th scope="col">회수</th>
                <th scope="col">이월</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => (
                <tr key={line.user_id}>
                  <td>
                    {line.display_name} <span className="small dim">@{line.username}</span>
                  </td>
                  <td className="numeric">{formatKrw(line.budget_krw)}</td>
                  <td className="numeric">{formatKrw(line.consumed_krw)}</td>
                  <td className="numeric">{formatKrw(line.reclaimed_krw)}</td>
                  <td className="numeric">{formatKrw(line.carry_over_krw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small" style={{ marginTop: "0.5rem" }} data-testid="close-total">
            지갑 {preview.lines.length}개 · 회수 {formatKrw(preview.reclaimed_krw)} · 그중 이월{" "}
            {formatKrw(preview.carry_over_krw)}
          </p>
          <p
            className={preview.purge_count > 0 ? "notice" : "small dim"}
            style={{ marginTop: "0.4rem" }}
            data-testid="close-purge"
          >
            {preview.purge_count > 0
              ? `삭제된 작업물 ${preview.purge_count}개가 함께 완전히 삭제됩니다. 되살릴 것이 있으면 먼저 Deleted Items에서 되살려 주세요.`
              : "완전히 삭제될 작업물은 없습니다 (Deleted Items가 비어 있습니다)."}
          </p>
        </div>
      )}

      {error && (
        <p className={confirmStyles.dialogError} role="alert">
          {error}
        </p>
      )}

      <div className={confirmStyles.dialogActions}>
        <button className="btn" type="button" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button
          className="btn btn-danger"
          type="button"
          onClick={() => void confirm()}
          disabled={busy || preview === null}
        >
          {busy ? "처리 중…" : "분기 마감"}
        </button>
      </div>
    </DialogShell>
  );
}
