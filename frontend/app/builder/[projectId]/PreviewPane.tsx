"use client";

/**
 * Builder 미리보기 영역.
 *
 * 여기는 앞으로 실제로 만든 앱이 돌아갈 자리입니다. 지금은 아무것도
 * 실행하지 않지만, 실행기를 끼워 넣을 자리를 미리 정해 두었습니다.
 *
 * ── 실행기 교체 지점 ────────────────────────────────────────────────
 * `PreviewRuntime`이 경계입니다. 이 인터페이스만 지키면 미리보기 구현을
 * 바꿔도 작업 공간 코드는 손대지 않아도 됩니다.
 *
 * 다음 단계(권장): CodeSandbox Sandpack
 *   1. `npm i @codesandbox/sandpack-react`
 *   2. 이 파일에 SandpackRuntime을 추가해 `files`를 Sandpack의 파일 맵
 *      으로 넘기고, template은 "react-ts"를 씁니다.
 *   3. 아래 `ACTIVE_RUNTIME`을 바꿉니다.
 *
 * Sandpack을 고른 이유와 한계는 README의 "Builder 미리보기" 절에 적어
 * 두었습니다. 요약하면: 브라우저 안 iframe에서 번들링하므로 서버에서
 * 회원 코드를 실행하지 않아도 되고, WebContainers와 달리 COOP/COEP 헤더가
 * 필요 없어 Vercel 배포를 건드리지 않습니다. 대신 Node가 없어 Next.js 같은
 * 서버 앱은 미리볼 수 없습니다.
 *
 * 절대 지켜야 할 것: 회원이 만든 코드를 Ctrl AI 백엔드에서 실행하지
 * 않습니다. 미리보기는 브라우저 안에서만 격리되어 돌아갑니다.
 */

import { useState } from "react";

import styles from "./workspace.module.css";

/** 미리보기에 넘길 프로젝트 파일. 경로 → 내용. */
export type PreviewFiles = Record<string, string>;

export interface PreviewRuntimeProps {
  files: PreviewFiles;
  /** 앱의 시작 파일. Sandpack이라면 활성 파일이 됩니다. */
  entry: string;
}

/**
 * 미리보기 구현이 지켜야 할 모양.
 *
 * `available`이 false면 작업 공간은 안내 문구를 대신 보여 줍니다.
 */
export interface PreviewRuntime {
  id: string;
  label: string;
  available: boolean;
  Component: (props: PreviewRuntimeProps) => React.ReactElement;
}

/**
 * 지금 쓰는 구현: 아무것도 실행하지 않는 자리 표시.
 *
 * 실행기를 붙이기 전까지 무엇이 준비되어 있고 무엇이 없는지 사용자에게
 * 솔직하게 보여 주는 편이 빈 상자보다 낫습니다.
 */
const MockRuntime: PreviewRuntime = {
  id: "mock",
  label: "준비 중",
  available: false,
  Component: ({ files, entry }) => (
    <div className={styles.previewPlaceholder}>
      <p className={styles.previewTitle}>미리보기는 아직 실행되지 않습니다</p>
      <p className={styles.previewText}>
        만든 앱을 이 자리에서 바로 확인할 수 있게 준비하고 있습니다. 브라우저 안에서만
        안전하게 실행되며, 회원이 만든 코드가 Ctrl AI 서버에서 돌아가는 일은 없습니다.
      </p>
      <p className={styles.previewMeta}>
        시작 파일 <code>{entry}</code> · 파일 {Object.keys(files).length}개 준비됨
      </p>
    </div>
  ),
};

/** 실행기를 붙이면 이 한 줄만 바꿉니다. */
const ACTIVE_RUNTIME: PreviewRuntime = MockRuntime;

export default function PreviewPane({ files, entry }: PreviewRuntimeProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const Runtime = ACTIVE_RUNTIME.Component;

  return (
    <div className={`${styles.preview} ${fullscreen ? styles.previewFullscreen : ""}`}>
      <div className={styles.previewBar}>
        <span className={styles.previewBarTitle}>
          미리보기
          <span className="badge badge-mock">{ACTIVE_RUNTIME.label}</span>
        </span>
        <span style={{ flex: "1 1 auto" }} />
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => setFullscreen((value) => !value)}
          aria-pressed={fullscreen}
        >
          {fullscreen ? "작게 보기" : "크게 보기"}
        </button>
      </div>

      <div className={styles.previewBody}>
        <Runtime files={files} entry={entry} />
      </div>
    </div>
  );
}
