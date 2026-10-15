"use client";

/**
 * Admin › Content › ZIP 미리보기 (project-export-handoff).
 *
 * 예시 앱(관리자가 올린 앱)의 "프로젝트 내려받기" ZIP에 들어가는 파일을
 * 내용까지 그대로 보여 줍니다 — README · CLAUDE.md · 프롬프트가 잘 읽히는지
 * 확인하려고. 회원의 앱은 열 수 없습니다(백엔드가 404).
 */

import { useEffect, useId, useState } from "react";

import DialogShell from "@/app/components/DialogShell";
import dialog from "@/app/components/confirm-dialog.module.css";
import { describeError, getAdminHandoffPreview, type HandoffInfo } from "@/lib/projects";

import styles from "./preview.module.css";

interface Props {
  projectId: number;
  name: string;
  onClose: () => void;
}

export default function HandoffPreview({ projectId, name, onClose }: Props) {
  const id = useId();
  const [info, setInfo] = useState<HandoffInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("README.md");

  useEffect(() => {
    getAdminHandoffPreview(projectId)
      .then(setInfo)
      .catch((caught: unknown) => setError(describeError(caught)));
  }, [projectId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const shown = info?.files.find((file) => file.path === path) ?? info?.files[0] ?? null;

  return (
    <DialogShell onClose={onClose} labelledBy={`${id}-title`} variant="sheet">
      <h2 className={dialog.dialogTitle} id={`${id}-title`}>
        ZIP 미리보기 — {name}
      </h2>
      {error && (
        <p className={dialog.dialogError} role="alert">
          {error}
        </p>
      )}
      {!info && !error && <p className="small muted">불러오는 중…</p>}
      {info && (
        <>
          <p className={dialog.dialogEffect}>
            게시된 v{info.version_number} · <code>{info.filename}</code> · 파일 {info.files.length}개. 회원이
            &lsquo;프로젝트 내려받기&rsquo;로 받는 것과 같아요.
          </p>
          <label className={dialog.dialogField}>
            <span className={dialog.fieldLabel}>파일</span>
            <select
              className="field"
              value={shown?.path ?? ""}
              onChange={(event) => setPath(event.target.value)}
              data-testid="preview-file"
            >
              {info.files.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.path}
                  {file.generated ? " (자동 안내)" : ""}
                </option>
              ))}
            </select>
          </label>
          <pre className={styles.content} tabIndex={0} data-testid="preview-content">
            {shown?.content ?? ""}
          </pre>
        </>
      )}
      <div className={dialog.dialogActions}>
        <button className="btn" type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </DialogShell>
  );
}
