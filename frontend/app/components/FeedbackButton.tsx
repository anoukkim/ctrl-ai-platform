"use client";

/**
 * 의견 보내기 — 어느 화면에서든 짧은 글을 남기는 단추와 창.
 *
 * Report Issue는 GitHub으로 보냅니다. 계정이 필요하고 글이 공개됩니다.
 * 베타에는 더 가벼운 길이 필요해서, 몇 줄을 적으면 데이터베이스에 저장되고
 * 관리자가 Admin › Feedback에서 읽습니다(prep-beta-launch).
 *
 * 단추는 세 군데에 놓입니다: 사이드바 아래(모든 화면), 베타 배너, Report
 * Issue 화면. 각각 자기 창을 들고 있습니다 — 같은 창을 한 곳에서 여는
 * 장치를 두는 것보다 단순합니다.
 *
 * 창의 모양은 확인창(ConfirmDialog)의 것을 그대로 씁니다.
 */

import { MessageSquarePlus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { describeError } from "@/lib/http";
import { FEEDBACK_MAX_LENGTH, sendFeedback } from "@/lib/site";

import dialogStyles from "./confirm-dialog.module.css";

type Variant = "icon" | "link" | "button";

export default function FeedbackButton({
  variant = "button",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === "icon" ? (
        <button
          className={className}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="의견 보내기"
          title="의견 보내기"
        >
          <MessageSquarePlus size={16} aria-hidden="true" />
        </button>
      ) : (
        <button
          className={className ?? (variant === "button" ? "btn btn-primary" : undefined)}
          type="button"
          onClick={() => setOpen(true)}
        >
          {variant === "button" && <MessageSquarePlus size={16} aria-hidden="true" />}
          의견 보내기
        </button>
      )}
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const fieldId = useId();

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const trimmed = body.trim();
  const tooLong = trimmed.length > FEEDBACK_MAX_LENGTH;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !trimmed || tooLong) return;
    setBusy(true);
    setError(null);
    try {
      await sendFeedback(trimmed, pathname);
      setSent(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={dialogStyles.dialogBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={dialogStyles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className={dialogStyles.dialogTitle} id={titleId}>
          의견 보내기
        </h2>

        {sent ? (
          <>
            <p className={dialogStyles.dialogEffect} role="status">
              고맙습니다. 운영진에게 잘 전달했어요.
            </p>
            <div className={dialogStyles.dialogActions}>
              <button className="btn btn-primary" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <form className={dialogStyles.dialogField} onSubmit={submit}>
            <p className={dialogStyles.dialogEffect}>
              불편했던 점, 헷갈렸던 점, 있었으면 하는 기능을 편하게 적어 주세요. 운영진만
              읽습니다.
            </p>
            <label className={dialogStyles.fieldLabel} htmlFor={fieldId}>
              내용
            </label>
            <textarea
              className="field"
              id={fieldId}
              ref={fieldRef}
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={FEEDBACK_MAX_LENGTH + 200}
            />
            <span className="small muted">
              {trimmed.length.toLocaleString("ko-KR")} / {FEEDBACK_MAX_LENGTH.toLocaleString("ko-KR")}자
              {tooLong && " — 조금 줄여 주세요."}
            </span>
            {error && (
              <p className={dialogStyles.dialogError} role="alert">
                {error}
              </p>
            )}
            <div className={dialogStyles.dialogActions}>
              <button className="btn" type="button" onClick={onClose} disabled={busy}>
                취소
              </button>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || !trimmed || tooLong}
              >
                {busy ? "보내는 중…" : "보내기"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
