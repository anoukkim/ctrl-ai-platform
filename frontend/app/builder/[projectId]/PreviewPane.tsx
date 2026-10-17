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

import { ExternalLink, Info, Maximize2, Minimize2, MoreHorizontal, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import MenuButton from "@/app/components/MenuButton";
import { describeError } from "@/lib/http";
import { PREVIEW_SANDBOX, RUNTIME_SANDBOX, buildSrcdoc } from "@/lib/static-preview";
import { captureFrame, originOf } from "@/lib/thumbnail-capture";


import BuilderRunPanel from "./BuilderRunPanel";
import ThumbnailFrame from "./ThumbnailFrame";
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
  /**
   * 썸네일 (ui-improvements): 프레임이 뜨고 잠시 뒤 찍은 그림, 그리고 ⋯의
   * "썸네일 다시 찍기". 주어지지 않으면 찍지 않습니다. `manual`이면 실패를
   * 화면에 보여 줍니다(자동은 조용히).
   */
  onCapture?: (image: Blob, manual: boolean) => Promise<void>;
  /** running-state-calm: while Claude builds, the run panel covers the preview. */
  working?: React.ComponentProps<typeof BuilderRunPanel> | null;
  /** thumbnail-choice: 지정하기 — the 16:10 frame over the preview. */
  framing?: React.ComponentProps<typeof ThumbnailFrame> | null;
}

/** 프레임이 뜬 뒤 이만큼 기다렸다 찍습니다 — 앱의 첫 그림이 그려질 시간. */
export const CAPTURE_DELAY_MS = 1500;
/** 첫 시도가 실패하면(앱이 아직 그리는 중) 이만큼 뒤에 한 번 더. */
export const CAPTURE_RETRY_MS = 4000;

/** 작업 공간이 미리보기 도구 줄에 끼워 넣는 것 (quality-tuning Q3). */
export interface PreviewToolbarProps {
  /** 맨 앞: 어느 버전을 볼지 (작업 중 vN / 게시된 vN). */
  toolbarStart?: React.ReactNode;
  /** 맨 뒤: 접어 둔 Claude 판을 다시 여는 단추 등. */
  toolbarEnd?: React.ReactNode;
}

/**
 * 안전 안내 — 한 줄로 두고, ⓘ를 누르면 전체 글 (quality-tuning Q3).
 */
function SafetyNote({ full }: { full: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.staticPreviewLabel}>
      <span>앱은 CTRL+AI 계정과 분리된 칸에서 돌아가요.</span>
      <button
        className={styles.infoButton}
        type="button"
        aria-expanded={open}
        aria-label="안전 안내 자세히"
        title="안전 안내 자세히"
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open && <p className={styles.safetyFull}>{full}</p>}
    </div>
  );
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
        <SafetyNote full="Claude가 만든 앱을 이 칸 안에서만 실행합니다. 인터넷 연결과 CTRL+AI 계정에는 닿지 않아요. 여기에 비밀번호나 개인 정보를 입력하지 마세요." />
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
function AppFrame({
  url,
  frameRef,
  onLoaded,
}: {
  url: string;
  frameRef?: (node: HTMLIFrameElement | null) => void;
  onLoaded?: () => void;
}) {
  return (
    <div className={styles.staticPreview}>
      <SafetyNote full="앱 주소(apps.ctrlai.my)에서 실행 중이에요 — CTRL+AI 계정과는 분리되어 있어요. 여기에 비밀번호나 개인 정보를 입력하지 마세요." />
      <iframe
        className={styles.staticPreviewFrame}
        ref={frameRef}
        sandbox={RUNTIME_SANDBOX}
        src={url}
        title="앱 미리보기"
        referrerPolicy="no-referrer"
        onLoad={onLoaded}
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
  toolbarStart,
  toolbarEnd,
  onCapture,
  working = null,
  framing = null,
}: PreviewRuntimeProps & AppRuntimeProps & PreviewToolbarProps) {
  const [fullscreen, setFullscreen] = useState(false);
  // 썸네일 (ui-improvements): 프레임이 뜨고 CAPTURE_DELAY_MS 뒤 한 번, 그리고
  // ⋯의 "썸네일 다시 찍기". 셸이 없는 주소(앱 서버 꺼짐)면 조용히 실패합니다.
  // The frame element is state (a callback ref), so the capture callbacks
  // read no ref during render.
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const captureNow = useCallback(
    async (manual: boolean): Promise<boolean> => {
      const frame = frameEl;
      const origin = originOf(appUrl);
      if (!frame || !origin || !onCapture) return true;
      setCapturing(true);
      if (manual) setCaptureError(null);
      try {
        const image = await captureFrame(frame, origin);
        await onCapture(image, manual);
        setCaptureError(null);
        return true;
      } catch (error) {
        // The capture helper throws plain Errors with a Korean sentence;
        // an upload failure is an ApiError — describeError reads those.
        if (manual) setCaptureError(error instanceof Error && !("status" in error) ? error.message : describeError(error));
        return false;
      } finally {
        setCapturing(false);
      }
    },
    [appUrl, frameEl, onCapture],
  );
  // owner-polish-3 (a): a capture after every load of the frame (a new
  // version's 미리보기 reloads it), and once more a little later when the
  // first try failed — an app that is still drawing at CAPTURE_DELAY_MS
  // used to leave the card without a picture until the next visit.
  const scheduleCapture = useCallback(() => {
    if (!onCapture) return;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(() => {
      void captureNow(false).then((ok) => {
        if (ok) return;
        captureTimer.current = setTimeout(() => void captureNow(false), CAPTURE_RETRY_MS);
      });
    }, CAPTURE_DELAY_MS);
  }, [captureNow, onCapture]);
  useEffect(
    () => () => {
      if (captureTimer.current) clearTimeout(captureTimer.current);
    },
    [],
  );
  // 새로 고침: key를 바꾸면 iframe이 처음부터 다시 실행됩니다.
  const [run, setRun] = useState(0);
  const runtime = runtimeFor(files, entry);
  const Runtime = runtime.Component;
  const hasEntry = files[entry] !== undefined;
  // 올린 때를 주소 뒤에 붙여, 갱신할 때마다 브라우저가 새 파일을 읽게 합니다.
  // 고치기가 끝나면 백엔드가 앱 주소에 다시 올리고 이 값이 바뀌므로,
  // 미리보기는 저절로 새로 읽힙니다 (quality-tuning Q3).
  const frameUrl =
    appUrl && hasEntry ? `${appUrl}?v=${encodeURIComponent(stamp ?? "")}` : null;
  const canUpload = runtimeAvailable && hasEntry && Boolean(onRefreshRuntime);

  // 좁은 칸에서는 자주 쓰지 않는 둘(새 창 · 미리보기 갱신)을 ⋯ 안으로.
  const overflow = [
    ...(frameUrl
      ? [{ label: "새 창에서 열기", onSelect: () => window.open(appUrl ?? "", "_blank", "noopener,noreferrer") }]
      : []),
    ...(canUpload
      ? [{ label: "미리보기 갱신", hint: "지금 파일을 앱 주소에 다시 올려요", onSelect: () => onRefreshRuntime?.(), disabled: refreshing }]
      : []),
    ...(frameUrl && onCapture
      ? [{ label: "썸네일 다시 찍기", hint: "지금 보이는 화면을 목록 카드의 그림으로", onSelect: () => void captureNow(true), disabled: capturing }]
      : []),
  ];

  return (
    <div className={`${styles.preview} ${fullscreen ? styles.previewFullscreen : ""}`}>
      <div className={styles.previewBar} role="toolbar" aria-label="미리보기 도구">
        {toolbarStart}
        <span className={styles.previewBarSpacer} />
        {runtime.available && (
          <button
            className={styles.toolButton}
            type="button"
            onClick={() => setRun((n) => n + 1)}
            aria-label="새로 고침"
            title="새로 고침 — 앱을 처음부터 다시 실행해요"
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        )}
        {frameUrl && (
          <a
            className={`${styles.toolButton} ${styles.toolSecondary}`}
            href={appUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="새 창에서 열기"
            title="새 창에서 열기"
          >
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        )}
        {canUpload && (
          <button
            className={`${styles.toolButton} ${styles.toolSecondary}`}
            type="button"
            onClick={onRefreshRuntime}
            disabled={refreshing}
            aria-label="미리보기 갱신"
            title={refreshing ? "올리는 중…" : "미리보기 갱신 — 지금 파일을 앱 주소에 다시 올려요"}
          >
            <Upload size={15} aria-hidden="true" />
          </button>
        )}
        {overflow.length > 0 && (
          <span className={styles.toolOverflow}>
            <MenuButton className={styles.toolButton} label="미리보기 도구 더 보기" title="더 보기" items={overflow}>
              <MoreHorizontal size={15} aria-hidden="true" />
            </MenuButton>
          </span>
        )}
        <button
          className={styles.toolButton}
          type="button"
          onClick={() => setFullscreen((value) => !value)}
          aria-pressed={fullscreen}
          aria-label={fullscreen ? "작게 보기" : "크게 보기"}
          title={fullscreen ? "작게 보기" : "크게 보기"}
        >
          {fullscreen ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
        </button>
        {toolbarEnd}
      </div>
      {refreshing && (
        <p className="sr-only" role="status">
          미리보기를 올리는 중…
        </p>
      )}
      {captureError && (
        <p className={styles.captureError} role="alert">
          썸네일을 찍지 못했어요: {captureError}
        </p>
      )}

      <div className={styles.previewBody}>
        {frameUrl ? (
          <AppFrame key={`${run}-${frameUrl}`} url={frameUrl} frameRef={setFrameEl} onLoaded={scheduleCapture} />
        ) : (
          <Runtime key={run} files={files} entry={entry} />
        )}
        {working && <BuilderRunPanel {...working} />}
        {framing && !working && <ThumbnailFrame {...framing} />}
      </div>
    </div>
  );
}
