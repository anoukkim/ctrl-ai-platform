"use client";

/**
 * Builder 미리보기 영역.
 *
 * 만든 앱이 돌아가는 자리입니다. 정적 앱(HTML·CSS·JS)은 샌드박스 iframe
 * 안에서 실행하고(StaticRuntime), 파일이 없으면 안내를 보여 줍니다.
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
 * 절대 지켜야 할 것: 회원이 만든 코드를 CTRL+AI 백엔드에서 실행하지
 * 않습니다. 미리보기는 브라우저 안에서만 격리되어 돌아갑니다.
 */

import { useState } from "react";

import { PREVIEW_SANDBOX, RUNTIME_SANDBOX, buildSrcdoc } from "@/lib/static-preview";

import styles from "./workspace.module.css";

/** 미리보기에 넘길 프로젝트 파일. 경로 → 내용. */
export type PreviewFiles = Record<string, string>;

export interface PreviewRuntimeProps {
  files: PreviewFiles;
  /** 앱의 시작 파일. Sandpack이라면 활성 파일이 됩니다. */
  entry: string;
}

/** builder-static-runtime: 앱 주소(apps.ctrlai.my)에서 돌리기. */
export interface AppRuntimeProps {
  /** 이 프로젝트의 앱 주소. 아직 올린 적이 없거나 앱 서버가 꺼져 있으면 null. */
  appUrl?: string | null;
  /** 앱 서버가 켜져 있으면 미리보기 갱신을 보여 줍니다. */
  runtimeAvailable?: boolean;
  /** 미리보기 갱신: 지금 파일을 앱 주소에 올립니다. */
  onRefreshRuntime?: () => void;
  refreshing?: boolean;
  /** 앱 주소에 마지막으로 올린 때 — 바뀌면 프레임을 다시 읽습니다. */
  stamp?: string | null;
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
        안전하게 실행되며, 회원이 만든 코드가 CTRL+AI 서버에서 돌아가는 일은 없습니다.
      </p>
      <p className={styles.previewMeta}>
        시작 파일 <code>{entry}</code> · 파일 {Object.keys(files).length}개 준비됨
      </p>
    </div>
  ),
};

/**
 * 정적 앱 실행기 (chat-builder-starter): index.html과 그 CSS·JS를 한 문서로
 * 묶어 샌드박스 iframe에서 돌립니다. 울타리는 `lib/static-preview.ts`에.
 * 네트워크도, CTRL+AI의 쿠키도, 다른 창을 여는 것도 막혀 있습니다.
 */
const StaticRuntime: PreviewRuntime = {
  id: "static",
  label: "안전한 미리보기",
  available: true,
  Component: function StaticPreview({ files, entry }) {
    const srcdoc = buildSrcdoc(files, entry);
    if (srcdoc === null) {
      const Placeholder = MockRuntime.Component;
      return <Placeholder files={files} entry={entry} />;
    }
    return (
      <div className={styles.staticPreview}>
        <p className={styles.staticPreviewLabel}>
          Claude가 만든 앱을 이 칸 안에서만 실행합니다. 인터넷 연결과 CTRL+AI 계정에는 닿지
          않아요. 여기에 비밀번호나 개인 정보를 입력하지 마세요.
        </p>
        <iframe
          className={styles.staticPreviewFrame}
          sandbox={PREVIEW_SANDBOX}
          srcDoc={srcdoc}
          title="앱 미리보기"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  },
};

/**
 * 앱 주소 실행기 (builder-static-runtime): apps.ctrlai.my에 올린 파일을
 * 그 주소 그대로 띄웁니다. 다른 출처라서 CTRL+AI의 쿠키·화면에 닿지 않고,
 * sandbox도 그대로 둡니다(`RUNTIME_SANDBOX`).
 */
function AppFrame({ url }: { url: string }) {
  return (
    <div className={styles.staticPreview}>
      <p className={styles.staticPreviewLabel}>
        앱 주소에서 실행 중이에요 — CTRL+AI 계정과는 분리되어 있어요. 여기에 비밀번호나 개인
        정보를 입력하지 마세요.
      </p>
      <iframe
        className={styles.staticPreviewFrame}
        sandbox={RUNTIME_SANDBOX}
        src={url}
        title="앱 미리보기"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

/** 파일이 있으면 정적 실행기, 없으면 안내. */
function runtimeFor(files: PreviewFiles, entry: string): PreviewRuntime {
  return files[entry] !== undefined ? StaticRuntime : MockRuntime;
}

export default function PreviewPane({
  files,
  entry,
  appUrl = null,
  runtimeAvailable = false,
  onRefreshRuntime,
  refreshing = false,
  stamp = null,
}: PreviewRuntimeProps & AppRuntimeProps) {
  const [fullscreen, setFullscreen] = useState(false);
  // 새로 고침: key를 바꾸면 iframe이 처음부터 다시 실행됩니다.
  const [run, setRun] = useState(0);
  const runtime = runtimeFor(files, entry);
  const Runtime = runtime.Component;
  const hasEntry = files[entry] !== undefined;
  // 올린 때를 주소 뒤에 붙여, 갱신할 때마다 브라우저가 새 파일을 읽게 합니다.
  const frameUrl =
    appUrl && hasEntry ? `${appUrl}?v=${encodeURIComponent(stamp ?? "")}` : null;

  return (
    <div className={`${styles.preview} ${fullscreen ? styles.previewFullscreen : ""}`}>
      <div className={styles.previewBar}>
        <span className={styles.previewBarTitle}>
          미리보기
          <span className={`badge ${runtime.available ? "badge-ok" : "badge-mock"}`}>
            {frameUrl ? "앱 주소" : runtime.label}
          </span>
        </span>
        <span style={{ flex: "1 1 auto" }} />
        {runtimeAvailable && hasEntry && onRefreshRuntime && (
          <button
            className="btn btn-sm"
            type="button"
            onClick={onRefreshRuntime}
            disabled={refreshing}
            title="지금 파일을 앱 주소에 올립니다"
          >
            {refreshing ? "올리는 중…" : "미리보기 갱신"}
          </button>
        )}
        {frameUrl && (
          <a
            className="btn btn-sm"
            href={appUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            새 창에서 열기
          </a>
        )}
        {runtime.available && (
          <button className="btn btn-sm" type="button" onClick={() => setRun((n) => n + 1)}>
            새로 고침
          </button>
        )}
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
        {frameUrl ? (
          <AppFrame key={`${run}-${frameUrl}`} url={frameUrl} />
        ) : (
          <Runtime key={run} files={files} entry={entry} />
        )}
      </div>
    </div>
  );
}
