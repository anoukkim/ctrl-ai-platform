"use client";

/**
 * CtrlAIApps에 게시 / 업데이트 게시 (ctrlaiapps-publish).
 *
 * 처음 게시: 이름 · CtrlAIApps에 보일 짧은 설명 · (선택) 업데이트 메모.
 * 업데이트 게시: 무엇이 무엇으로 바뀌는지(v3 → v5)를 먼저 보여 줍니다.
 * 어느 쪽이든 만든 앱이 할 수 있는 일을 솔직하게 한 번 더 말합니다(F3).
 */

import { useId, useState } from "react";

import DialogShell from "@/app/components/DialogShell";
import styles from "@/app/components/confirm-dialog.module.css";
import { APP_LIMITS_NOTE } from "@/lib/projects";

export interface PublishValues {
  name: string;
  description: string;
  note: string;
}

interface Props {
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

export default function PublishDialog({
  publishedVersion,
  nextVersion,
  initial,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) {
  const [values, setValues] = useState<PublishValues>(initial);
  const id = useId();
  const update = publishedVersion !== null;
  const same = update && nextVersion === publishedVersion;

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
        <li>비용은 들지 않고, 언제든 게시를 취소할 수 있어요. 버전 기록은 그대로 남아요.</li>
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
          placeholder="예: 오늘 할 일을 적고, 끝낸 일은 눌러서 지우는 앱이에요."
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
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
          placeholder="예: 메모 기능을 추가했어요"
          onChange={(event) => setValues({ ...values, note: event.target.value })}
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
