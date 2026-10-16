"use client";

/**
 * 의견 보내기 — 어느 화면에서든 짧은 글을 남기는 단추와 창.
 *
 * 베타에는 더 가벼운 길이 필요해서, 몇 줄을 적으면 데이터베이스에 저장되고
 * 관리자가 Admin › Feedback에서 읽습니다(prep-beta-launch).
 *
 * 스크린샷을 최대 3장 붙일 수 있습니다(feedback-screenshots): 파일 고르기,
 * 끌어다 놓기, 붙여넣기(⌘V — 맥에서 화면을 클립보드로 찍는 사람이 많습니다).
 * 사진은 글보다 먼저 하나씩 올라가고(`POST /feedback/images`), 보내기가
 * 그 번호들을 글과 함께 보냅니다. 창을 보내지 않고 닫으면 올린 사진은
 * 지웁니다. 운영진만 봅니다.
 *
 * 단추는 두 군데에 놓입니다: 사이드바 아래(모든 화면)와 베타 배너. 둘 다
 * 같은 `FeedbackDialog`를 열고, 창은 `DialogShell`이 `document.body`에
 * 그리므로 어느 단추로 열어도 모양이 같습니다.
 */

import { CheckCircle2, ImagePlus, MessageSquarePlus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { describeError } from "@/lib/http";
import {
  FEEDBACK_IMAGE_ACCEPT,
  FEEDBACK_IMAGE_PRIVACY_NOTE,
  FEEDBACK_IMAGES_TOO_MANY,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_LENGTH,
  deleteFeedbackImage,
  feedbackImageName,
  precheckFeedbackImage,
  sendFeedback,
  uploadFeedbackImage,
} from "@/lib/site";

import DialogShell from "./DialogShell";
import dialogStyles from "./confirm-dialog.module.css";
import styles from "./feedback.module.css";

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

/** 창에 붙은 스크린샷 하나. `id`는 서버가 받아 준 뒤에 생깁니다. */
interface Shot {
  key: number;
  id: number | null;
  name: string;
  /** 브라우저 안에서만 쓰는 미리보기 주소. 회원은 저장본을 볼 길이 없습니다. */
  previewUrl: string;
}

function previewUrlFor(file: File): string {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
}

function revoke(url: string): void {
  if (url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

/** 클립보드나 끌어다 놓은 것에서 이미지 파일만 — 글을 붙여넣을 때는 비어 있습니다. */
function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length > 0) return files.filter((file) => file.type.startsWith("image/") || !file.type);
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotError, setShotError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shotsRef = useRef<Shot[]>([]);
  const sentRef = useRef(false);
  const nextKey = useRef(1);
  const titleId = useId();
  const fieldId = useId();

  // 닫기와 올리기는 이벤트 안에서 최신 목록을 봐야 합니다(렌더 밖에서 갱신).
  useEffect(() => {
    shotsRef.current = shots;
    sentRef.current = sent;
  }, [shots, sent]);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  /**
   * 닫기 — 보내지 않은 사진은 서버에서도 지웁니다(✕를 누르지 않고 창을
   * 닫는 경우). 보낸 뒤에는 의견에 붙었으므로 건드리지 않습니다.
   */
  const close = useCallback(() => {
    if (!sentRef.current) {
      for (const shot of shotsRef.current) {
        if (shot.id !== null) void deleteFeedbackImage(shot.id).catch(() => undefined);
      }
    }
    for (const shot of shotsRef.current) revoke(shot.previewUrl);
    onClose();
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const uploading = shots.some((shot) => shot.id === null);

  /**
   * 사진을 하나씩 올립니다. 서버가 바이트로 종류를 보고, 크기·개수를 확인한
   * 뒤에만 저장합니다. 거절되면 그 한국어 문장을 보여 주고 그 사진만 뺍니다.
   */
  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setShotError(null);
    const room = FEEDBACK_MAX_IMAGES - shotsRef.current.length;
    if (files.length > room) {
      setShotError(FEEDBACK_IMAGES_TOO_MANY);
      files = files.slice(0, Math.max(0, room));
      if (files.length === 0) return;
    }
    for (const [index, file] of files.entries()) {
      const name = feedbackImageName(file, shotsRef.current.length + index);
      const refused = precheckFeedbackImage(file);
      if (refused) {
        setShotError(refused);
        continue;
      }
      const key = nextKey.current++;
      const previewUrl = previewUrlFor(file);
      setShots((rows) => [...rows, { key, id: null, name, previewUrl }]);
      try {
        const uploaded = await uploadFeedbackImage(file, name);
        setShots((rows) => rows.map((row) => (row.key === key ? { ...row, id: uploaded.id } : row)));
      } catch (caught) {
        revoke(previewUrl);
        setShots((rows) => rows.filter((row) => row.key !== key));
        setShotError(describeError(caught));
      }
    }
  }, []);

  const removeShot = useCallback((shot: Shot) => {
    revoke(shot.previewUrl);
    setShots((rows) => rows.filter((row) => row.key !== shot.key));
    if (shot.id !== null) void deleteFeedbackImage(shot.id).catch(() => undefined);
  }, []);

  const trimmed = body.trim();
  const tooLong = trimmed.length > FEEDBACK_MAX_LENGTH;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !trimmed || tooLong || uploading) return;
    setBusy(true);
    setError(null);
    try {
      const ids = shots.map((shot) => shot.id).filter((id): id is number => id !== null);
      await sendFeedback(trimmed, pathname, ids);
      setSent(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell onClose={close} labelledBy={titleId}>
      <h2 className={dialogStyles.dialogTitle} id={titleId}>
        의견 보내기
      </h2>

      {sent ? (
        <>
          <p className={dialogStyles.dialogEffect} role="status">
            <CheckCircle2
              className="success-pop"
              size={18}
              aria-hidden="true"
              style={{ verticalAlign: "-3px", marginRight: "0.35rem", color: "var(--ok-text)" }}
            />
            고맙습니다. 운영진에게 잘 전달했어요.
          </p>
          <div className={dialogStyles.dialogActions}>
            <button className="btn btn-primary" type="button" onClick={close}>
              닫기
            </button>
          </div>
        </>
      ) : (
        <form
          className={`${dialogStyles.dialogField} ${styles.dropzone} ${dragging ? styles.dragging : ""}`}
          onSubmit={submit}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(imageFilesOf(event.dataTransfer));
          }}
          onPaste={(event) => {
            const files = imageFilesOf(event.clipboardData);
            if (files.length === 0) return; // 글 붙여넣기는 그대로 둡니다
            event.preventDefault();
            void addFiles(files);
          }}
          data-testid="feedback-form"
        >
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

          {shots.length > 0 && (
            <ul className={styles.shots} aria-label="붙인 사진" data-testid="feedback-shots">
              {shots.map((shot) => (
                <li
                  className={`${styles.shot} ${shot.id === null ? styles.shotUploading : ""}`}
                  key={shot.key}
                >
                  {shot.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 브라우저 안의 미리보기 주소
                    <img src={shot.previewUrl} alt={shot.name} />
                  ) : (
                    <span className="sr-only">{shot.name}</span>
                  )}
                  {shot.id === null && (
                    <span className={styles.shotStatus} role="status">
                      올리는 중…
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.shotRemove}
                    aria-label={`${shot.name} 빼기`}
                    onClick={() => removeShot(shot)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.attachRow}>
            <input
              ref={fileInputRef}
              type="file"
              accept={FEEDBACK_IMAGE_ACCEPT}
              multiple
              hidden
              data-testid="feedback-file-input"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);
                event.target.value = "";
                void addFiles(picked);
              }}
            />
            <button
              className="btn btn-sm"
              type="button"
              disabled={busy || shots.length >= FEEDBACK_MAX_IMAGES}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={15} aria-hidden="true" />
              스크린샷 붙이기
            </button>
            <span className="small muted">
              {shots.length}/{FEEDBACK_MAX_IMAGES}장 · 붙여넣기(⌘V)나 끌어다 놓기도 돼요
            </span>
          </div>
          <p className={styles.hint}>{FEEDBACK_IMAGE_PRIVACY_NOTE}</p>
          {shotError && (
            <p className={dialogStyles.dialogError} role="alert" data-testid="feedback-shot-error">
              {shotError}
            </p>
          )}
          {error && (
            <p className={dialogStyles.dialogError} role="alert">
              {error}
            </p>
          )}
          <div className={dialogStyles.dialogActions}>
            <button className="btn" type="button" onClick={close} disabled={busy}>
              취소
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy || !trimmed || tooLong || uploading}
            >
              {busy ? "보내는 중…" : uploading ? "사진 올리는 중…" : "보내기"}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}
