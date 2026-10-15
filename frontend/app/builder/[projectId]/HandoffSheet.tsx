"use client";

/**
 * 프로젝트 내려받기 · 내 Claude로 이어서 만들기 (project-export-handoff).
 *
 * 하나의 시트, 두 가지 얼굴:
 * - `download`: 버전(작업 중 / 게시된 버전)을 고르고, ZIP에 무엇이
 *   들어가는지 보여 준 뒤 내려받습니다.
 * - `claude`: claude.ai와 Claude Code 두 탭. 하는 순서를 ① ② ③으로
 *   보여 주고, 붙여 넣을 글은 복사 단추 하나로.
 *
 * 프롬프트와 파일 목록은 백엔드가 만듭니다(`/handoff`) — ZIP 안의
 * HANDOFF_PROMPT.md와 화면의 글이 같도록. "무엇을 더 하고 싶나요?"는
 * 입력하는 대로 빈칸에 들어가고(`fillExtra`), 내려받는 ZIP에도 같이
 * 들어갑니다.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import DialogShell from "@/app/components/DialogShell";
import dialog from "@/app/components/confirm-dialog.module.css";
import {
  builderProjectDownloadUrl,
  describeError,
  fillExtra,
  getHandoff,
  type HandoffInfo,
  type HandoffVersion,
} from "@/lib/projects";

import styles from "./handoff.module.css";

export type HandoffMode = "download" | "claude";
type Tab = "claude-ai" | "claude-code";

const OUTSIDE_NOTE =
  "CTRL+AI 밖에서 만든 변경은 자동으로 돌아오지 않아요. 다시 올리려면 파일을 Builder에 붙여 넣거나 (나중에) GitHub 연결을 쓰세요.";

/** 복사 단추가 "복사됨"을 보여 주는 시간. */
export const COPIED_MS = 2000;

interface Props {
  projectId: number;
  mode: HandoffMode;
  onClose: () => void;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes}B`;
  return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)}KB`;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 복사 단추 — 누르면 2초 동안 "복사됨". 화면 읽기 프로그램에도 알립니다. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <>
      <button
        className="btn btn-sm"
        type="button"
        aria-label={`${label} 복사`}
        onClick={async () => {
          const ok = await writeClipboard(text);
          setState(ok ? "copied" : "failed");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setState("idle"), COPIED_MS);
        }}
      >
        {state === "copied" ? "복사됨" : "복사"}
      </button>
      <span className={styles.srOnly} role="status" aria-live="polite">
        {state === "copied" ? `${label}을(를) 복사했어요.` : state === "failed" ? "복사하지 못했어요. 직접 선택해서 복사해 주세요." : ""}
      </span>
    </>
  );
}

export default function HandoffSheet({ projectId, mode, onClose }: Props) {
  const id = useId();
  const [version, setVersion] = useState<HandoffVersion>("draft");
  const [info, setInfo] = useState<HandoffInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("claude-ai");
  const [extra, setExtra] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ "claude-ai": null, "claude-code": null });

  useEffect(() => {
    let live = true;
    getHandoff(projectId, version)
      .then((next) => {
        if (!live) return;
        setInfo(next);
        setError(null);
      })
      .catch((reason) => {
        if (live) setError(describeError(reason));
      });
    return () => {
      live = false;
    };
  }, [projectId, version]);

  // 열리면 제목에 초점 — 화면 읽기 프로그램이 무슨 창인지 먼저 읽고,
  // Tab으로 바로 안의 단추로 갑니다. Esc로 닫습니다.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const moveTab = useCallback((event: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: Tab =
      event.key === "Home" ? "claude-ai" : event.key === "End" ? "claude-code" : tab === "claude-ai" ? "claude-code" : "claude-ai";
    setTab(next);
    tabRefs.current[next]?.focus();
  }, [tab]);

  const published = info?.published_version_number ?? null;
  const zipUrl = builderProjectDownloadUrl(projectId, version, mode === "claude" ? extra : "");
  const prompt = info ? fillExtra(info.prompt, info.extra_marker, info.extra_label, extra) : "";
  const title = mode === "download" ? "프로젝트 내려받기" : "내 Claude로 이어서 만들기";

  const versionPicker =
    published !== null && info ? (
      <fieldset className={styles.versions}>
        <legend className={dialog.fieldLabel}>어느 버전을 내려받을까요?</legend>
        <label className={styles.versionOption}>
          <input
            type="radio"
            name={`${id}-version`}
            checked={version === "draft"}
            onChange={() => setVersion("draft")}
          />
          작업 중 v{info.draft_version_number}
        </label>
        <label className={styles.versionOption}>
          <input
            type="radio"
            name={`${id}-version`}
            checked={version === "published"}
            onChange={() => setVersion("published")}
          />
          게시된 버전 v{published}
        </label>
      </fieldset>
    ) : null;

  const downloadLink = (label: string) => (
    <a
      className={`btn ${mode === "download" ? "btn-primary" : "btn-sm"}`}
      href={zipUrl}
      download
      data-testid="handoff-download"
    >
      {label}
    </a>
  );

  return (
    <DialogShell onClose={onClose} labelledBy={`${id}-title`} describedBy={`${id}-lead`} variant="sheet">
      <div className={styles.head}>
        <h2 className={dialog.dialogTitle} id={`${id}-title`} ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        <button className={styles.close} type="button" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <p className={dialog.dialogEffect} id={`${id}-lead`}>
        {mode === "download"
          ? "앱 파일과 함께, 내 Claude가 이어서 만들 수 있게 돕는 안내 파일(README · CLAUDE.md · 프롬프트 · 버전 기록)이 들어 있어요."
          : "ZIP을 내 Claude에게 주면, 이 앱을 이어서 키울 수 있어요. 코딩을 몰라도 아래 순서대로 하면 돼요."}
      </p>

      {error && (
        <p className={dialog.dialogError} role="alert">
          {error}
        </p>
      )}
      {!info && !error && <p className={styles.loading}>준비하는 중…</p>}

      {info && mode === "download" && (
        <>
          {versionPicker}
          <div>
            <p className={dialog.fieldLabel}>ZIP에 들어가는 파일 ({info.files.length}개)</p>
            <ul className={styles.fileList} data-testid="handoff-files">
              {info.files.map((file) => (
                <li key={file.path} className={styles.fileRow}>
                  <code className={styles.filePath}>{file.path}</code>
                  {file.generated && <span className="badge badge-muted">안내</span>}
                  <span className={styles.fileSize}>{sizeLabel(file.bytes)}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className={styles.note}>
            비밀값, 사용량·비용, 다른 회원의 정보는 들어가지 않아요. 파일 이름: <code>{info.filename}</code>
          </p>
          <div className={dialog.dialogActions}>
            <button className="btn" type="button" onClick={onClose}>
              닫기
            </button>
            {downloadLink("ZIP 내려받기")}
          </div>
        </>
      )}

      {info && mode === "claude" && (
        <>
          {versionPicker}
          <div className={styles.tabs} role="tablist" aria-label="어디에서 이어서 만들까요?">
            {(["claude-ai", "claude-code"] as Tab[]).map((name) => (
              <button
                key={name}
                ref={(node) => {
                  tabRefs.current[name] = node;
                }}
                className={`${styles.tab} ${tab === name ? styles.tabActive : ""}`}
                id={`${id}-tab-${name}`}
                role="tab"
                type="button"
                aria-selected={tab === name}
                aria-controls={`${id}-panel-${name}`}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={moveTab}
              >
                {name === "claude-ai" ? "claude.ai" : "Claude Code"}
              </button>
            ))}
          </div>

          {tab === "claude-ai" ? (
            <div role="tabpanel" id={`${id}-panel-claude-ai`} aria-labelledby={`${id}-tab-claude-ai`} className={styles.panel}>
              <ol className={styles.steps}>
                <li>
                  <span>ZIP 내려받기</span> {downloadLink("ZIP 내려받기")}
                </li>
                <li>claude.ai에서 새 대화를 열고, 내려받은 ZIP을 첨부해요.</li>
                <li>아래 프롬프트를 복사해서 붙여 넣어요.</li>
              </ol>
              <div className={dialog.dialogField}>
                <label className={dialog.fieldLabel} htmlFor={`${id}-extra`}>
                  무엇을 더 하고 싶나요? (선택)
                </label>
                <textarea
                  className="field"
                  id={`${id}-extra`}
                  rows={2}
                  maxLength={info.max_extra}
                  value={extra}
                  placeholder="예: 다크 모드를 넣고, 지난 기록을 달력으로 보고 싶어요"
                  onChange={(event) => setExtra(event.target.value)}
                />
              </div>
              <div className={styles.copyBox}>
                <div className={styles.copyHead}>
                  <span className={dialog.fieldLabel} id={`${id}-prompt-label`}>
                    붙여 넣을 프롬프트
                  </span>
                  <CopyButton text={prompt} label="프롬프트" />
                </div>
                <pre className={styles.prompt} aria-labelledby={`${id}-prompt-label`} tabIndex={0} data-testid="handoff-prompt">
                  {prompt}
                </pre>
              </div>
            </div>
          ) : (
            <div role="tabpanel" id={`${id}-panel-claude-code`} aria-labelledby={`${id}-tab-claude-code`} className={styles.panel}>
              <ol className={styles.steps}>
                <li>
                  <span>ZIP을 내려받아 압축을 풀어요.</span> {downloadLink("ZIP 내려받기")}
                </li>
                <li>
                  <span>압축을 푼 폴더에서 터미널을 열고 실행해요.</span>
                  <span className={styles.inlineCopy}>
                    <code className={styles.command}>claude</code>
                    <CopyButton text="claude" label="명령어" />
                  </span>
                </li>
                <li>첫 문장으로 이렇게 말해 보세요.</li>
              </ol>
              <div className={styles.copyBox}>
                <div className={styles.copyHead}>
                  <span className={dialog.fieldLabel}>첫 문장 예시</span>
                  <CopyButton text={info.claude_code_first_line} label="첫 문장" />
                </div>
                <pre className={styles.prompt} tabIndex={0} data-testid="handoff-first-line">
                  {info.claude_code_first_line}
                </pre>
              </div>
            </div>
          )}

          <p className={styles.note}>{OUTSIDE_NOTE}</p>
        </>
      )}
    </DialogShell>
  );
}
