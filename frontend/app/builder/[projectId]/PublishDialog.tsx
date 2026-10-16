"use client";

/**
 * CtrlAIApps에 게시 / 업데이트 게시 (ctrlaiapps-publish).
 *
 * 처음 게시: 이름 · CtrlAIApps에 보일 짧은 설명 · (선택) 업데이트 메모.
 * 업데이트 게시: 무엇이 무엇으로 바뀌는지(v3 → v5)를 먼저 보여 줍니다.
 * 어느 쪽이든 만든 앱이 할 수 있는 일을 솔직하게 한 번 더 말합니다(F3).
 *
 * publish-summary: 창이 열리면 Claude가 쓴 설명(과 업데이트 게시면 메모)을
 * 받아 **비어 있는 칸만** 채웁니다 — 회원이 이미 적은 글은 두고, 이미
 * 타이핑을 시작한 칸은 늦게 온 요약이 덮지 않습니다. 설명이 이미 있으면
 * "Claude 요약으로 바꾸기"로 바꿀 수 있어요. 못 받으면 빈 칸 그대로 —
 * 게시는 막히지 않습니다. 회원 지갑에서는 나가지 않아요.
 */

import { useEffect, useId, useRef, useState } from "react";

import DialogShell from "@/app/components/DialogShell";
import styles from "@/app/components/confirm-dialog.module.css";
import { APP_LIMITS_NOTE, getPublishSummary, type PublishSummary } from "@/lib/projects";

export interface PublishValues {
  name: string;
  description: string;
  note: string;
}

interface Props {
  /** 요약을 받아 올 프로젝트. */
  projectId: number;
  /** 지금 게시된 버전. 처음 게시면 null. */
  publishedVersion: number | null;
  /** 게시될 버전(작업 중 최신). */
  nextVersion: number | null;
  initial: PublishValues;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (values: PublishValues) => void;
}

type SummaryState =
  | { phase: "loading" }
  | { phase: "ready"; summary: PublishSummary }
  | { phase: "failed" };

export default function PublishDialog({
  projectId,
  publishedVersion,
  nextVersion,
  initial,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) {
  const [values, setValues] = useState<PublishValues>(initial);
  // 회원이 손댄 칸은 요약이 덮지 않습니다 — 효과의 닫힘이 아니라 ref로 읽어, 늦게 온 요약도 지켜요.
  const touched = useRef({ description: false, note: false });
  const [summary, setSummary] = useState<SummaryState>({ phase: "loading" });
  const id = useId();
  const update = publishedVersion !== null;
  const same = update && nextVersion === publishedVersion;

  useEffect(() => {
    let cancelled = false;
    getPublishSummary(projectId)
      .then((result) => {
        if (cancelled) return;
        setSummary({ phase: "ready", summary: result });
        setValues((current) => {
          const next = { ...current };
          // 빈 칸만 채웁니다 — 적어 둔 설명과 타이핑 중인 글은 그대로.
          if (!touched.current.description && !current.description.trim() && result.description) next.description = result.description;
          if (update && !touched.current.note && !current.note.trim() && result.note) next.note = result.note;
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setSummary({ phase: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, update]);

  const suggested = summary.phase === "ready" ? summary.summary.description : "";
  const canReplace = Boolean(suggested) && values.description.trim() !== "" && values.description !== suggested;

  return (
    <DialogShell onClose={onClose} labelledBy={`${id}-title`} describedBy={`${id}-effect`}>
      <h2 className={styles.dialogTitle} id={`${id}-title`}>
        {update ? "업데이트 게시" : "CtrlAIApps에 게시"}
      </h2>
      <ul className={`${styles.dialogEffect} ${styles.dialogEffectList}`} id={`${id}-effect`}>
        {update ? (
          <li data-testid="publish-change">
            {same
              ? `지금 게시된 것이 최신(v${publishedVersion})이에요. 설명과 메모만 바뀝니다.`
              : `게시된 버전: v${publishedVersion} → v${nextVersion}. 누르기 전까지 방문한 사람은 v${publishedVersion} 그대로 봐요.`}
          </li>
        ) : (
          <li>
            작업 중인 버전 v{nextVersion} — CtrlAIApps에 올라가요. 게시한 뒤에 고쳐도
            &lsquo;업데이트 게시&rsquo;를 누르기 전까지 공개된 앱은 바뀌지 않아요.
          </li>
        )}
        <li>{APP_LIMITS_NOTE}</li>
        <li>설명은 Claude가 미리 써 줘요 (무료) — 고쳐도 돼요. 게시는 비용이 들지 않고, 언제든 취소할 수 있어요. 버전 기록은 그대로 남아요.</li>
        {/* 보안 검토(ui-improvements-a)의 한 줄: 첫 화면이 사진이 되니, 내 자료가 보이면 알고 게시하도록. */}
        <li>게시하면 앱의 첫 화면을 사진으로 찍어 CtrlAIApps 카드에 보여 줘요 — 첫 화면에 내 자료가 보이면 그 사진에도 들어가요.</li>
      </ul>

      <div className={styles.dialogField}>
        <label className={styles.fieldLabel} htmlFor={`${id}-name`}>
          앱 이름
        </label>
        <input
          className="field"
          id={`${id}-name`}
          value={values.name}
          maxLength={120}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
        />
      </div>
      <div className={styles.dialogField}>
        <label className={styles.fieldLabel} htmlFor={`${id}-description`}>
          CtrlAIApps에 보일 설명<span className={styles.required}> *</span>
        </label>
        <textarea
          className="field"
          id={`${id}-description`}
          rows={3}
          maxLength={2000}
          value={values.description}
          placeholder={summary.phase === "loading" ? "Claude가 설명을 쓰는 중…" : "예: 오늘 할 일을 적고, 끝낸 일은 눌러서 지우는 앱이에요."}
          onChange={(event) => {
            touched.current.description = true;
            setValues({ ...values, description: event.target.value });
          }}
        />
        <p className={styles.fieldHint} data-testid="summary-state" aria-live="polite">
          {summary.phase === "loading" && "Claude가 설명을 요약하는 중… (무료)"}
          {summary.phase === "ready" && suggested && values.description === suggested && "Claude가 쓴 설명이에요 — 마음에 안 들면 고치세요."}
          {summary.phase === "ready" && canReplace && (
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => {
                touched.current.description = true;
                setValues({ ...values, description: suggested });
              }}
            >
              Claude 요약으로 바꾸기
            </button>
          )}
          {summary.phase === "ready" && !suggested && "요약을 받지 못했어요 — 직접 적어 주세요."}
          {summary.phase === "failed" && "요약을 받지 못했어요 — 직접 적어 주세요."}
        </p>
      </div>
      <div className={styles.dialogField}>
        <label className={styles.fieldLabel} htmlFor={`${id}-note`}>
          업데이트 메모 (선택, 목록에 한 줄로 보여요)
        </label>
        <input
          className="field"
          id={`${id}-note`}
          value={values.note}
          maxLength={200}
          placeholder={update && summary.phase === "loading" ? "Claude가 바뀐 점을 요약하는 중…" : "예: 메모 기능을 추가했어요"}
          onChange={(event) => {
            touched.current.note = true;
            setValues({ ...values, note: event.target.value });
          }}
        />
      </div>

      {error && (
        <p className={styles.dialogError} role="alert">
          {error}
        </p>
      )}

      <div className={styles.dialogActions}>
        <button className="btn" type="button" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => onConfirm(values)}
          disabled={busy || !values.description.trim()}
        >
          {busy ? "게시하는 중…" : update ? "업데이트 게시" : "게시하기"}
        </button>
      </div>
    </DialogShell>
  );
}
