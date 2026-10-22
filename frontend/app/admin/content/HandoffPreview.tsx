"use client";

/**
 * Admin › Community › 앱 › ZIP 미리보기 (project-export-handoff).
 *
 * 예시 앱(관리자가 올린 앱)의 "프로젝트 내려받기" ZIP에 들어가는 파일을
 * 내용까지 그대로 보여 줍니다 — README · CLAUDE.md · 프롬프트가 잘 읽히는지
 * 확인하려고. 회원의 앱은 열 수 없습니다(백엔드가 404). admin-ui-unify:
 * 오른쪽 판(`SidePanel`)에서 — Esc · 바깥 · ✕로 닫힙니다.
 */

import { useEffect, useState } from "react";

import { describeError, getAdminHandoffPreview, type HandoffInfo } from "@/lib/projects";

import { Mono, PanelSection, SidePanel } from "../components/AdminUI";

import styles from "./preview.module.css";

interface Props {
  projectId: number;
  name: string;
  onClose: () => void;
}

export default function HandoffPreview({ projectId, name, onClose }: Props) {
  const [info, setInfo] = useState<HandoffInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("README.md");

  useEffect(() => {
    getAdminHandoffPreview(projectId)
      .then(setInfo)
      .catch((caught: unknown) => setError(describeError(caught)));
  }, [projectId]);

  const shown = info?.files.find((file) => file.path === path) ?? info?.files[0] ?? null;

  return (
    <SidePanel
      title={`ZIP 미리보기 — ${name}`}
      subtitle={
        info ? (
          <>
            게시된 v{info.version_number} · <Mono>{info.filename}</Mono> · 파일 {info.files.length}개
          </>
        ) : undefined
      }
      onClose={onClose}
      width="wide"
      testId="handoff-preview"
      footer={
        <button className="btn btn-sm" type="button" onClick={onClose}>
          닫기
        </button>
      }
    >
      {error && (
        <p className="small" role="alert" style={{ color: "var(--error-text)", margin: 0 }}>
          {error}
        </p>
      )}
      {!info && !error && <p className="small muted">불러오는 중…</p>}
      {info && (
        <PanelSection title="파일">
          <p className="small muted" style={{ margin: 0 }}>
            회원이 &lsquo;프로젝트 내려받기&rsquo;로 받는 것과 같아요.
          </p>
          <select
            className="field"
            aria-label="파일"
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
          <pre className={styles.content} tabIndex={0} data-testid="preview-content">
            {shown?.content ?? ""}
          </pre>
        </PanelSection>
      )}
    </SidePanel>
  );
}
