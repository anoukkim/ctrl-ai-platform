"use client";

/**
 * 분기 마감 (admin-consolidation v3, owner 2026-10-17) — 다섯 단계.
 *
 * 신청 마감 → 정산 확인 → 휴지통 비우기 → 앱 보관 → 다음 분기 열기. 지금
 * 할 단계 하나에 설명과 단추, 그리고 세 가지 숫자(동결할 지갑, 회수 예정,
 * 휴지통). 돈이 움직이는 일은 **기존 흐름을 그대로** 써요: 2단계의 단추가
 * 예전 「분기 마감」 확인창을 열고, 그 마감이 지갑 동결 · 회수 · 이월과
 * 휴지통 비우기(3단계)를 한 트랜잭션으로 해요 — 여기서 새로 계산하지 않아요.
 * 되돌릴 수 없는 단계는 확인창이 한 번 더 묻고, 모두 감사 기록에 남아요.
 * 4단계(앱 보관)는 Community › 앱에서 하고 "확인했어요"로 넘어가요 — 그
 * 확인도 감사 기록에 남고, 다른 관리자에게도 끝난 단계로 보여요. 단계는
 * 차례로만 끝나요(앞 단계가 끝나야 뒤 단계가 끝난 것으로 보여요).
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { confirmAppsArchived, getClosePreview, getCloseSteps, type ClosePreview } from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { WORK_KIND_LABEL, listDeletedItems, type DeletedItem } from "@/lib/projects";
import { formatDate, formatKrw, updateQuarter, type Quarter } from "@/lib/quarters";

import { tabHref } from "../sections";
import CloseQuarterDialog from "./CloseQuarterDialog";

import styles from "../admin.module.css";

export const STEPS = ["신청 마감", "정산 확인", "휴지통 비우기", "앱 보관", "다음 분기 열기"] as const;
/** Which steps are done (0–4), from the quarters and the audit log — in order. */
export function stepsDone(quarter: Quarter, quarters: Quarter[], archived: boolean): boolean[] {
  const closed = quarter.status === "closed";
  const next = quarters.some(
    (other) => other.id !== quarter.id && other.starts_at > quarter.ends_at && other.status !== "draft",
  );
  const applicationsClosed = quarter.status === "active" || closed;
  const appsPutAway = closed && archived;
  return [applicationsClosed, closed, closed, appsPutAway, appsPutAway && next];
}

/** Days until the quarter's last day, by KST calendar dates (0 on the day). */
export function daysLeft(quarter: Quarter, now = Date.now()): number {
  const today = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(quarter.ends_at) - Date.parse(today)) / 86_400_000);
}

export default function CloseStepper({
  quarter,
  quarters,
  onChanged,
}: {
  quarter: Quarter;
  quarters: Quarter[];
  onChanged: (message: string) => void;
}) {
  const [archived, setArchived] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [deleted, setDeleted] = useState<DeletedItem[] | null>(null);
  const [preview, setPreview] = useState<{ id: number; value: ClosePreview } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = stepsDone(quarter, quarters, archived);
  const current = done.findIndex((value) => !value);
  const closed = quarter.status === "closed";

  useEffect(() => {
    let cancelled = false;
    getCloseSteps(quarter.id)
      .then((steps) => {
        if (!cancelled) setArchived(Boolean(steps.apps_archived_at));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [quarter.id]);

  useEffect(() => {
    if (closed || quarter.status === "draft") return;
    let cancelled = false;
    getClosePreview(quarter.id, 0)
      .then((value) => {
        if (!cancelled) setPreview({ id: quarter.id, value });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [quarter.id, quarter.status, closed]);
  const facts = preview?.id === quarter.id ? preview.value : null;
  const days = daysLeft(quarter);

  const closeApplications = () =>
    setConfirm({
      title: `${quarter.display_name} 신청 마감`,
      effect: "회원이 더 이상 이 분기에 신청할 수 없습니다. 분기는 진행 중으로 바뀌고, 승인된 지갑은 그대로 씁니다.",
      confirmLabel: "신청 마감",
      onConfirm: async () => {
        setBusy(true);
        try {
          await updateQuarter(quarter.id, { status: "active" });
          setConfirm(null);
          onChanged(`${quarter.display_name}의 신청을 마감했습니다.`);
        } catch (caught) {
          // Shown in the dialog, which stays open.
          setError(describeError(caught));
        } finally {
          setBusy(false);
        }
      },
    });

  const confirmArchived = async () => {
    setBusy(true);
    setError(null);
    try {
      const steps = await confirmAppsArchived(quarter.id);
      setArchived(Boolean(steps.apps_archived_at));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleDeleted = async () => {
    const opening = !deletedOpen;
    setDeletedOpen(opening);
    if (opening && deleted === null) {
      try {
        setDeleted(await listDeletedItems());
      } catch (caught) {
        setError(describeError(caught));
      }
    }
  };

  const explain: Record<number, { text: string; action: React.ReactNode }> = {
    0: {
      text:
        quarter.status === "draft"
          ? "이 분기는 아직 준비 중이에요. 위 분기 목록의 관리 메뉴에서 신청을 먼저 열어요."
          : "회원이 더 이상 신청하지 못하게 해요. 이미 올라온 신청은 Members의 승인 대기에서 계속 심사할 수 있어요.",
      action: (
        quarter.status === "draft" ? null : (
          <button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={closeApplications}>
            신청 마감…
          </button>
        )
      ),
    },
    1: {
      text: "남은 지원금을 동결하고, 다음 분기로 넘길 몫을 정해요. 마감과 함께 휴지통도 비워져요(3단계).",
      action: (
        <button className="btn btn-sm btn-primary" type="button" onClick={() => setClosing(true)}>
          정산 확인 시작…
        </button>
      ),
    },
    3: {
      text: "AI를 쓰는 앱을 데모만으로 돌려 둘지 Community › 앱에서 정해요. 끝나면 확인을 눌러요.",
      action: (
        <span className={styles.rowButtons}>
          <Link className="btn btn-sm" href={tabHref("community", "apps")}>
            Community › 앱
          </Link>
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => void confirmArchived()}>
            확인했어요
          </button>
        </span>
      ),
    },
    4: {
      text: "다음 분기를 만들고 신청을 열어요.",
      action: (
        <a className="btn btn-sm btn-primary" href="#quarter-new">
          다음 분기 만들기
        </a>
      ),
    },
  };
  const now = current === -1 ? null : explain[current] ?? explain[1];

  return (
    <section className="card" aria-labelledby="close-steps-title" data-testid="close-stepper">
      <h2 className="section-title" id="close-steps-title">
        분기 마감
        <span className={styles.sectionNote}>
          {quarter.display_name} · 마감 {formatDate(quarter.ends_at)}
          {days >= 0 ? ` · D-${days}` : ""}
        </span>
      </h2>
      <ol className={styles.steps}>
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={styles.step}
            data-state={done[index] ? "done" : index === current ? "now" : "todo"}
            aria-current={index === current ? "step" : undefined}
          >
            <span className={styles.stepMark} aria-hidden="true">
              {done[index] ? "✓" : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      {now ? (
        <div className={styles.stepNow}>
          <p style={{ margin: 0 }}>
            <strong>
              지금 할 단계 · {current + 1} {STEPS[current]}
            </strong>{" "}
            — {now.text}
          </p>
          {now.action}
        </div>
      ) : (
        <p className="small muted">이 분기의 마감이 모두 끝났어요.</p>
      )}
      {facts && !closed && (
        <dl className={styles.stepFacts}>
          <div>
            <dt>동결할 지갑</dt>
            <dd className="numeric">{facts.lines.length}개</dd>
          </div>
          <div>
            <dt>회수 예정</dt>
            <dd className="numeric">{formatKrw(facts.reclaimed_krw)}</dd>
          </div>
          <div>
            <dt>휴지통</dt>
            <dd className="numeric">
              {facts.purge_count}개{" "}
              {facts.purge_count > 0 && (
                <button className={styles.linkButton} type="button" aria-expanded={deletedOpen} onClick={() => void toggleDeleted()}>
                  {deletedOpen ? "접기" : "무엇이 사라지나"}
                </button>
              )}
            </dd>
          </div>
        </dl>
      )}
      {deletedOpen && deleted && (
        // Every member's deleted work the close will remove — 복구 is in each
        // member's panel (Members), before the close.
        <ul className={styles.deletedList} data-testid="close-deleted">
          {deleted.map((item) => (
            <li key={`${item.kind}-${item.id}`} className={styles.deletedRow}>
              <span>
                <strong>{item.name}</strong> <span className="small dim">@{item.owner_username} · {WORK_KIND_LABEL[item.kind]}</span>
              </span>
              <Link className="btn btn-sm" href={`/admin/members?member=${item.owner_user_id}`}>
                회원 열기
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="small dim" style={{ margin: 0 }}>
        되돌릴 수 없는 단계(2·3)는 누를 때 한 번 더 물어요. 단계마다 감사 기록이 남아요.
      </p>
      {error && !confirm && (
        <p className="small" role="alert" style={{ color: "var(--error-text)" }}>
          {error}
        </p>
      )}
      <ConfirmDialog busy={busy} request={confirm} error={confirm ? error : null} onClose={() => setConfirm(null)} />
      {closing && (
        <CloseQuarterDialog
          quarterId={quarter.id}
          quarterName={quarter.display_name}
          onClose={() => setClosing(false)}
          onClosed={(result) => {
            setClosing(false);
            onChanged(
              `${result.quarter_name}를 마감했습니다. 회수 ${formatKrw(result.reclaimed_krw)}, 그중 이월 ${formatKrw(result.carry_over_krw)}.`,
            );
          }}
        />
      )}
    </section>
  );
}
