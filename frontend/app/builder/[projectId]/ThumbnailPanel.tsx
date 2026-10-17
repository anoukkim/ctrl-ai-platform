"use client";

/**
 * 썸네일 (thumbnail-choice, owner 2026-10-17) — 파일 목록 아래, 목록 카드와
 * CtrlAIApps에 보일 그림.
 *
 * 기본은 **자동**(서버가 찍은 첫 화면). **지정하기**를 누르면 미리보기 위에
 * 16:10 틀이 떠서 원하는 장면(게임 중간처럼)을 골라 「이 화면으로」 찍어요.
 * 사진을 붙여 넣거나 올릴 수도 있어요. 지정한 그림은 「자동으로 되돌리기」
 * 전까지 자동 그림이 덮지 않아요.
 */

import { Crop, ImageUp, Loader2, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

import { describeError } from "@/lib/http";
import { builderThumbnailUrl, type BuilderProject } from "@/lib/projects";

import styles from "./thumbnail-choice.module.css";

interface Props {
  project: Pick<BuilderProject, "id" | "draft_thumbnail_at" | "published_thumbnail_at" | "thumbnail_chosen_at">;
  /** 앱을 만들 수 있을 때만(참여 중이고 일하는 중이 아닐 때). */
  disabled: boolean;
  /** 미리보기가 있어야 틀을 띄울 수 있어요. */
  canFrame: boolean;
  /** 지금 틀을 띄운 상태인지. */
  framing: boolean;
  onFrame: () => void;
  onFile: (image: Blob) => Promise<void>;
  onReset: () => Promise<void>;
}

export default function ThumbnailPanel({ project, disabled, canFrame, framing, onFrame, onFile, onReset }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chosen = Boolean(project.thumbnail_chosen_at);
  const url = builderThumbnailUrl(project);

  const run = async (work: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.panel}
      data-testid="thumbnail-panel"
      // 패널에 포커스가 있을 때 ⌘V로 붙여 넣은 사진도 받아요.
      onPaste={(event) => {
        if (disabled) return;
        const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
        if (!file) return;
        event.preventDefault();
        void run(() => onFile(file));
      }}
    >
      <div className={styles.head}>
        <span>썸네일</span>
        <span className={styles.badge}>{chosen ? "직접 지정" : "자동"}</span>
      </div>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- 백엔드가 주는 작은 WebP
        <img className={styles.picture} src={url} alt={chosen ? "직접 지정한 썸네일" : "자동 썸네일 — 앱의 첫 화면"} />
      ) : (
        <div className={styles.empty}>미리보기가 뜨면 첫 화면이 썸네일이 돼요</div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={onFrame}
          disabled={disabled || busy || !canFrame || framing}
          title={canFrame ? "미리보기 위 16:10 틀로 원하는 장면을 골라요" : "미리보기가 있어야 지정할 수 있어요"}
        >
          <Crop size={13} aria-hidden="true" /> 지정하기
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-testid="thumbnail-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void run(() => onFile(file));
          }}
        />
        <button
          type="button"
          className={styles.action}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          title="스크린샷(⌘⇧4)을 올려요 — 여기를 누른 뒤 ⌘V로 붙여 넣어도 돼요"
        >
          {busy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <ImageUp size={13} aria-hidden="true" />} 사진 올리기
        </button>
        {chosen && (
          <button
            type="button"
            className={styles.action}
            onClick={() => void run(onReset)}
            disabled={disabled || busy}
          >
            <RotateCcw size={13} aria-hidden="true" /> 자동으로 되돌리기
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
