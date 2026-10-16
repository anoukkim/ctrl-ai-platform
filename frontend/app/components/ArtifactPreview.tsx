"use client";

/**
 * 답장 속 `html`·`svg` 블록의 미리보기 (chat-plus-artifacts).
 *
 * 보안이 이 기능의 전부입니다. 아래는 **협상하지 않는** 규칙이고, 테스트가
 * 하나하나 확인합니다 — 나중의 "작은 수정"이 몰래 넓히지 못하게:
 *
 * - `<iframe srcdoc>`에 `sandbox="allow-scripts"` **하나만**. 절대
 *   `allow-same-origin`(allow-scripts와 함께면 액자가 스스로 샌드박스를
 *   벗길 수 있음), `allow-forms`, `allow-popups`, `allow-top-navigation`,
 *   `allow-modals`, `allow-downloads`를 붙이지 않습니다. 그래서 액자는
 *   **출처가 없는**(opaque) 문서이고, CTRL+AI의 쿠키·저장소·/api에 닿을 수
 *   없습니다.
 * - srcdoc의 **맨 앞**은 CSP 메타 태그: 네트워크가 없습니다(fetch, 바깥
 *   이미지, 비컨 모두 실패).
 * - SVG를 `innerHTML`로 화면에 넣지 않습니다 — SVG에도 `<script>`와 이벤트
 *   처리기가 들어갈 수 있으니 같은 액자 안에서만 그립니다.
 * - **미리보기 열기를 눌러야** 돌아갑니다(멈추지 않는 반복문이 탭을 얼릴 수
 *   있으니 회원의 선택으로). 새로 고침과 닫기가 있습니다.
 * - 액자 위에 고정 문구: 가짜 로그인 창을 그릴 수 있으니 비밀번호를 넣지
 *   말라고.
 * - 200KB가 넘는 블록은 코드만 보여 줍니다.
 *
 * 다운로드는 액자가 아니라 CTRL+AI 화면이 Blob으로 만듭니다(액자에는 내려받기
 * 권한이 없습니다). Builder로 보내기(HTML만)는 Builder 경로로 프로젝트를 만들고
 * 엽니다 — Claude를 부르지 않으니 무료입니다.
 */

import { Code2, Download, ExternalLink, Play, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";

import { createProjectFromChat } from "@/lib/projects";
import { describeError } from "@/lib/http";

import styles from "./ArtifactPreview.module.css";

/** 액자 안 문서의 맨 앞에 붙는 CSP — 네트워크 없음, 인라인만. */
export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
/** 액자의 샌드박스 — 정확히 이것 하나. */
export const PREVIEW_SANDBOX = "allow-scripts";
/** 이보다 큰 블록은 코드만. */
export const PREVIEW_MAX_BYTES = 200 * 1024;
export const PREVIEW_LABEL = "Claude가 만든 미리보기입니다. 여기에 비밀번호나 개인 정보를 입력하지 마세요.";
export const CUT_OFF_NOTE = '답장이 길어 미리보기를 만들 수 없습니다 — "계속"이라고 보내 주세요.';

/** 미리보기에 필요한 답장의 사정. ChatWorkspace가 답장마다 줍니다. */
export interface ArtifactContextValue {
  /** 아직 오는 중이면 미리보기를 만들지 않습니다(끝난 답장만). */
  streaming: boolean;
  /** 잘린 답장의 마지막, 닫히지 않은 블록의 내용. 그 블록은 미리보기 대신 안내. */
  cutOffCode: string | null;
  conversationId: number | null;
  /** 다운로드 파일 이름의 번호 — 답장의 메시지 번호. */
  replyNumber: number | null;
  /** Builder로 보내기: 프로젝트 이름(대화 제목)과 설명(회원의 질문). */
  conversationTitle: string;
  memberMessage: string;
  mayCreate: boolean;
}

export const ArtifactContext = createContext<ArtifactContextValue | null>(null);

export function isPreviewLanguage(language: string): language is "html" | "svg" {
  return language === "html" || language === "svg";
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 액자에 넣을 문서. **반드시 CSP 메타 태그로 시작합니다.** */
export function buildSrcdoc(code: string, language: "html" | "svg"): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (language === "svg") {
    return (
      `${csp}<style>html,body{margin:0;height:100%;}body{display:grid;place-items:center;background:#fff;}` +
      `svg{max-width:100%;height:auto;}</style>${code}`
    );
  }
  return `${csp}${code}`;
}

export function downloadName(
  conversationId: number | null,
  replyNumber: number | null,
  language: "html" | "svg",
): string {
  return `ctrlai-${conversationId ?? "chat"}-${replyNumber ?? 1}.${language}`;
}

export default function ArtifactPreview({
  code,
  language,
  codeView,
}: {
  code: string;
  language: "html" | "svg";
  /** 코드 보기 — 원래의 코드 블록(복사 단추 포함). */
  codeView: React.ReactNode;
}) {
  const context = useContext(ArtifactContext);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 미리보기가 없는 곳(답장이 아직 오는 중, 다른 화면)에서는 코드 그대로.
  if (context === null || context.streaming) return <>{codeView}</>;
  if (context.cutOffCode !== null && context.cutOffCode.trim() === code.trim()) {
    return (
      <>
        {codeView}
        <p className={styles.cutOff} data-testid="artifact-cut-off">
          {CUT_OFF_NOTE}
        </p>
      </>
    );
  }
  if (byteLength(code) > PREVIEW_MAX_BYTES) {
    return (
      <>
        {codeView}
        <p className={styles.note} data-testid="artifact-too-big">
          200KB가 넘는 블록이라 코드만 보여 드려요.
        </p>
      </>
    );
  }

  function download() {
    const blob = new Blob([code], {
      type: language === "svg" ? "image/svg+xml" : "text/html;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName(context!.conversationId, context!.replyNumber, language);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function sendToBuilder() {
    setBusy(true);
    setError(null);
    try {
      const project = await createProjectFromChat({
        name: context!.conversationTitle.slice(0, 40) || "채팅에서 만든 페이지",
        // The member's chat sentence is a request, not the project's
        // description (owner, 2026-10-16): 게시 writes the real one.
        description: "",
        html: code,
      });
      router.push(`/builder/${project.id}`);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <div className={styles.card} data-testid="artifact">
      <div className={styles.head}>
        <span className={styles.title}>미리보기 · {language.toUpperCase()}</span>
        <span className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => setShowCode((v) => !v)}>
            <Code2 size={13} aria-hidden="true" />
            {showCode ? "코드 숨기기" : "코드 보기"}
          </button>
          <button type="button" className={styles.button} onClick={download}>
            <Download size={13} aria-hidden="true" />
            다운로드
          </button>
          {language === "html" && (
            <button
              type="button"
              className={styles.button}
              onClick={() => void sendToBuilder()}
              disabled={busy || !context.mayCreate}
              title={context.mayCreate ? undefined : "이번 분기에 참여해야 프로젝트를 만들 수 있습니다"}
            >
              <ExternalLink size={13} aria-hidden="true" />
              Builder로 보내기
            </button>
          )}
        </span>
      </div>

      {showCode && <div className={styles.code}>{codeView}</div>}

      {!open ? (
        <button
          type="button"
          className={styles.open}
          onClick={() => setOpen(true)}
          data-testid="artifact-open"
        >
          <Play size={15} aria-hidden="true" />
          미리보기 열기
        </button>
      ) : (
        <div className={styles.frameWrap}>
          <p className={styles.label}>{PREVIEW_LABEL}</p>
          <iframe
            key={version}
            className={styles.frame}
            title="Claude가 만든 미리보기"
            sandbox={PREVIEW_SANDBOX}
            srcDoc={buildSrcdoc(code, language)}
            referrerPolicy="no-referrer"
            data-testid="artifact-frame"
          />
          <div className={styles.frameActions}>
            <button type="button" className={styles.button} onClick={() => setVersion((v) => v + 1)}>
              <RotateCcw size={13} aria-hidden="true" />
              새로 고침
            </button>
            <button type="button" className={styles.button} onClick={() => setOpen(false)}>
              <X size={13} aria-hidden="true" />
              닫기
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
