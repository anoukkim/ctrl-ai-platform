"use client";

/**
 * 결과물 패널 (chat-artifact-panel).
 *
 * 답장 속 `html`·`svg` 블록은 대화 안에서 작은 카드가 되고, 카드를 누르면
 * 대화 오른쪽에 이 패널이 열립니다 — 미리보기와 코드, 복사·다운로드·
 * Builder로 보내기·전체 화면. 좁은 화면에서는 대화 위를 덮는 시트입니다.
 *
 * 액자는 ArtifactPreview와 **똑같은** 규칙을 따릅니다: `buildSrcdoc`(CSP가
 * 맨 앞)과 `PREVIEW_SANDBOX`(allow-scripts 하나)를 그대로 씁니다. 회원이
 * 카드를 눌러야 열리므로 "누르기 전에는 아무것도 돌지 않는다"도 그대로입니다.
 */

import { Check, Code2, Copy, Download, ExternalLink, Eye, Maximize2, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { OpenArtifact } from "./artifact-panel-context";
import { PREVIEW_LABEL, PREVIEW_SANDBOX, buildSrcdoc, useArtifactActions } from "./ArtifactPreview";
import PreviewFullscreen from "./PreviewFullscreen";
import styles from "./ArtifactPanel.module.css";

export default function ArtifactPanel({ artifact, onClose }: { artifact: OpenArtifact; onClose: () => void }) {
  const { code, language, title, context } = artifact;
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [version, setVersion] = useState(0);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const { download, sendToBuilder, busy, error } = useArtifactActions(code, language, context);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 다른 결과물로 바뀌면 미리보기 탭부터.
  const [shown, setShown] = useState(artifact);
  if (shown !== artifact) {
    setShown(artifact);
    setTab("preview");
    setCopied("idle");
  }

  useEffect(() => {
    closeRef.current?.focus();
  }, [artifact]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    let ok = true;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      ok = false;
    }
    setCopied(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied("idle"), 2000);
  }

  const srcDoc = buildSrcdoc(code, language);
  const kind = language === "svg" ? "SVG 그림" : "HTML 페이지";

  return (
    <aside
      className={styles.panel}
      aria-label={`결과물: ${title}`}
      data-testid="artifact-panel"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !full) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Code2 size={16} />
        </span>
        <span className={styles.names}>
          <span className={styles.title}>{title}</span>
          <span className={styles.kind}>{kind}</span>
        </span>
        <button
          ref={closeRef}
          type="button"
          className={styles.iconButton}
          onClick={onClose}
          aria-label="패널 닫기"
          title="패널 닫기"
          data-testid="artifact-panel-close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="보기">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "preview"}
          className={`${styles.tab} ${tab === "preview" ? styles.tabOn : ""}`}
          onClick={() => setTab("preview")}
        >
          <Eye size={13} aria-hidden="true" /> 미리보기
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "code"}
          className={`${styles.tab} ${tab === "code" ? styles.tabOn : ""}`}
          onClick={() => setTab("code")}
          data-testid="artifact-panel-code-tab"
        >
          <Code2 size={13} aria-hidden="true" /> 코드
        </button>
        {tab === "preview" && (
          <button
            type="button"
            className={`${styles.iconButton} ${styles.tabsEnd}`}
            onClick={() => setVersion((v) => v + 1)}
            aria-label="새로 고침"
            title="새로 고침"
          >
            <RotateCcw size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={`${styles.iconButton} ${tab === "preview" ? "" : styles.tabsEnd}`}
          onClick={() => setFull(true)}
          aria-label="전체 화면"
          title="전체 화면"
          data-testid="artifact-panel-fullscreen"
        >
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.body}>
        {tab === "preview" ? (
          <div className={styles.frameWrap}>
            <p className={styles.label}>{PREVIEW_LABEL}</p>
            <iframe
              key={`${version}-${code.length}`}
              className={styles.frame}
              title="Claude가 만든 미리보기"
              sandbox={PREVIEW_SANDBOX}
              srcDoc={srcDoc}
              referrerPolicy="no-referrer"
              data-testid="artifact-panel-frame"
            />
          </div>
        ) : (
          <pre className={styles.code} data-testid="artifact-panel-code">
            <code>{code}</code>
          </pre>
        )}
      </div>

      <footer className={styles.foot}>
        <button type="button" className={styles.button} onClick={() => void copy()}>
          {copied === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span aria-live="polite">
            {copied === "copied" ? "복사됨" : copied === "failed" ? "복사하지 못했어요" : "복사"}
          </span>
        </button>
        <button type="button" className={styles.button} onClick={download}>
          <Download size={13} aria-hidden="true" /> 다운로드
        </button>
        {language === "html" && (
          <span className={styles.builder}>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => void sendToBuilder()}
              disabled={busy || !context.mayCreate}
              title={context.mayCreate ? undefined : "이번 분기에 참여해야 프로젝트를 만들 수 있습니다"}
            >
              <ExternalLink size={13} aria-hidden="true" /> Builder로 보내기
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => void sendToBuilder(true)}
              disabled={busy || !context.mayCreate}
              title={
                context.mayCreate
                  ? "CSS와 JavaScript를 style.css, app.js로 나눠서 보내요"
                  : "이번 분기에 참여해야 프로젝트를 만들 수 있습니다"
              }
            >
              파일로 나누기
            </button>
          </span>
        )}
      </footer>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {full && (
        <PreviewFullscreen
          title={title}
          srcDoc={srcDoc}
          sandbox={PREVIEW_SANDBOX}
          label={PREVIEW_LABEL}
          onClose={() => setFull(false)}
        />
      )}
    </aside>
  );
}
