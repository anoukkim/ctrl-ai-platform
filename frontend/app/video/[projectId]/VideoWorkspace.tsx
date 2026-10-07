"use client";

/**
 * Video Generator 작업 공간 — 영상 프로젝트 하나.
 *
 * 한 번 만들고 끝나는 화면이 아닙니다:
 *   아이디어 → 생성 → 확인 → 수정하거나 이어서 만들기 → 버전 비교 →
 *   최종본 선택 → YouTube에 게시
 *
 * 영상은 전부 Higgsfield를 거칩니다(지금은 mock이 예시 영상을 만듭니다).
 * 생성·수정·이어서 만들기는 Video 지원금에서 차감되고, 버튼 옆에 예상
 * 비용이 원으로 나옵니다. 길이·비율·화질·소리는 고른 모델의 카탈로그를
 * 따릅니다(`lib/video-settings.ts`).
 *
 * 오른쪽의 Claude 칸(프롬프트 도움받기)은 선택 사항이고 접혀서 시작합니다.
 * 글만 고쳐 주며 영상은 만들지 않습니다.
 */

import { ArrowLeft, Lock, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useMayCreate, useMyQuarter } from "@/app/components/MyQuarterProvider";
import NotParticipatingBanner from "@/app/components/NotParticipatingBanner";
import WorkspaceTitle from "@/app/components/WorkspaceTitle";
import ws from "@/app/components/workspace.module.css";
import {
  VIDEO_STATUS_BADGE,
  VIDEO_STATUS_LABEL,
  createVideoVersion,
  deleteVideoProject,
  describeError,
  editVideoVersion,
  extendVideoVersion,
  getVideoProject,
  listVideoModels,
  listVideoProjects,
  updateVideoProject,
  type VideoModel,
  type VideoProject,
  type VideoProjectDetail,
  type VideoVersion,
} from "@/lib/projects";
import { NOT_PARTICIPATING_HINT } from "@/lib/quarters";
import {
  VERSION_KIND_LABEL,
  costLabel,
  estimateCostKrw,
  reconcile,
  settingsNotice,
  type VideoChoice,
} from "@/lib/video-settings";

import PromptHelper from "./PromptHelper";
import VersionActionPanel, { type VersionAction } from "./VersionActionPanel";
import VersionDownload from "./VersionDownload";
import VideoSettings, { ASPECT_LABEL, ASPECT_RATIO_CSS, type Aspect } from "./VideoSettings";
import styles from "./workspace.module.css";

/** 재생 눈금의 간격(ms). 실제 영상이 아니라 재생 느낌만 흉내 냅니다. */
const TICK_MS = 150;

/** 버전의 길이를 모를 때 쓰는 값(초).
 *
 *  길이 칸이 생기기 전에 만들어진 버전에만 해당합니다. 예전에는 모든
 *  버전을 15초로 재생했고, 그래서 10초로 만든 버전이 0:15로 보였습니다. */
const UNKNOWN_DURATION_SECONDS = 15;

function isAspect(value: string | null): value is Aspect {
  return value === "9:16" || value === "16:9" || value === "1:1";
}

/** 모델 이름을 모를 때라도 provider의 날 id는 보여 주지 않습니다.
 *  `kling-3.0-pro` → `Kling 3.0 Pro`. 관리자가 모델을 목록에서 내리면
 *  지난 버전이 가리키는 모델이 목록에 없을 수 있습니다. */
function prettyModelId(modelId: string): string {
  return modelId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** 버전마다 다른 색을 주어 목록에서 구분되게 합니다. 색 자체는
 *  globals.css의 토큰이고, 여기에는 토큰 이름만 둡니다. */
const VERSION_ARTWORK = [
  "var(--video-art-1)",
  "var(--video-art-2)",
  "var(--video-art-3)",
  "var(--video-art-4)",
];

function artworkFor(index: number): string {
  return VERSION_ARTWORK[index % VERSION_ARTWORK.length];
}

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "10초 · 9:16 · 720p" — 버전이 기록한 설정. 모르는 값은 빼고 적습니다. */
function settingsLine(version: VideoVersion): string {
  return [
    version.duration_seconds != null ? `${version.duration_seconds}초` : null,
    version.aspect_ratio,
    version.resolution,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 수정·이어서 만들기를 할 수 있을 만큼 설정이 기록된 버전인지. */
function hasRecordedSettings(version: VideoVersion): boolean {
  return Boolean(
    version.has_asset && version.duration_seconds && version.aspect_ratio && version.resolution,
  );
}

type State =
  | { phase: "loading" }
  | { phase: "ready"; project: VideoProjectDetail }
  | { phase: "error"; message: string };

type Mode = { kind: "generate" } | { kind: VersionAction; sourceId: number };

export default function VideoWorkspace({ projectId }: { projectId: string }) {
  // 참여하지 않는 분기에도 이 화면은 열리고, 지난 버전은 모두 볼 수
  // 있습니다. 막히는 것은 저장·생성·최종본 선택처럼 바꾸는 쪽입니다.
  // 실제 거절은 백엔드가 합니다 — 아래 잠금은 설명일 뿐입니다.
  const mayCreate = useMayCreate();
  const { refresh: refreshQuarter } = useMyQuarter();
  const router = useRouter();

  const [state, setState] = useState<State>({ phase: "loading" });
  const [siblings, setSiblings] = useState<VideoProject[]>([]);
  const [models, setModels] = useState<VideoModel[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);

  const [mode, setMode] = useState<Mode>({ kind: "generate" });
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | "saving" | "saved">(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // 회원이 고른 생성 설정. null이면 아직 아무것도 고르지 않은 것이고,
  // 그때는 모델의 기본값을 씁니다. 모델을 바꾸면 chooseModel이 새 모델에
  // 맞춰 고쳐 두고, 무엇을 바꿨는지 `notice`로 알립니다.
  const [chosen, setChosen] = useState<VideoChoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(true);

  /* ---------- 불러오기 ---------- */

  /** 받아온 프로젝트를 화면 상태에 반영합니다. */
  const applyProject = useCallback((project: VideoProjectDetail) => {
    setState({ phase: "ready", project });
    setPrompt(project.prompt);
    setSelectedVersionId((current) => {
      if (current && project.versions.some((v) => v.id === current)) return current;
      return project.final_version_id ?? project.versions.at(-1)?.id ?? null;
    });
  }, []);

  // 효과가 두 번 도는 일은 흔합니다 — 개발 모드의 StrictMode가 그렇고,
  // 작업 공간을 빠르게 갈아타도 그렇습니다. 예전에는 뒷정리에서 "이
  // 실행은 밀려났다"고 표시하고 먼저 도착한 응답을 버렸는데, 뒤에 선
  // 요청이 끝내 도착하지 않으면 화면을 "불러오는 중"에서 꺼내 줄 것이
  // 아무것도 남지 않았습니다. 멀쩡히 받아 둔 200 응답을 버린 셈입니다.
  //
  // 그래서 지금은 도착한 응답을 그대로 씁니다. 한 인스턴스가 보는
  // 프로젝트는 처음부터 끝까지 하나이므로(page.tsx가 projectId마다 다른
  // key를 줍니다) 늦게 온 응답이 다른 프로젝트의 것일 수는 없습니다.
  useEffect(() => {
    getVideoProject(projectId)
      .then(applyProject)
      .catch((error: unknown) => {
        // 이미 프로젝트를 받아 둔 뒤라면 — 두 번째 요청만 실패한
        // 경우입니다 — 잘 보이던 화면을 오류로 덮지 않습니다.
        setState((current) =>
          current.phase === "ready"
            ? current
            : { phase: "error", message: describeError(error) },
        );
      });
  }, [applyProject, projectId]);

  // 위와 같은 이유로 밀려난 실행의 응답도 버리지 않습니다.
  useEffect(() => {
    // 모델 목록은 백엔드가 정합니다. 프런트엔드에 모델 이름을 적어 두지
    // 않으므로, 관리자가 목록을 바꾸면 여기에 그대로 반영됩니다.
    listVideoModels()
      .then(setModels)
      .catch(() => {
        /* 모델을 못 받으면 설정 칸이 비어 있게 둡니다 */
      });

    listVideoProjects()
      .then(setSiblings)
      .catch(() => {
        /* 전환 메뉴만 비어 있게 둡니다 */
      });
  }, []);

  /* ---------- 지금 보고 있는 버전 ---------- */

  // 아래의 재생 타이머가 이 버전의 길이를 써야 하므로, 화면을 그리기 전에
  // 먼저 구합니다.
  const readyProject = state.phase === "ready" ? state.project : null;
  const versions = readyProject?.versions ?? [];
  const selectedIndex = versions.findIndex((v) => v.id === selectedVersionId);
  const selected = selectedIndex >= 0 ? versions[selectedIndex] : null;

  // 이 버전을 만든 길이. 모르는 버전(칸이 생기기 전에 만들어진 것)만
  // 기본값으로 재생합니다 — 지금 고른 길이로 메우지 않습니다. 그것이
  // 10초로 만든 버전을 0:15로 재생하던 이유였습니다.
  const previewSeconds = selected?.duration_seconds ?? UNKNOWN_DURATION_SECONDS;

  /* ---------- 재생 ---------- */

  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setProgress((current) => {
        const next = current + (TICK_MS / 1000 / previewSeconds) * 100;
        if (next >= 100) {
          setIsPlaying(false);
          return 100;
        }
        return next;
      });
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [isPlaying, previewSeconds]);

  /* ---------- 모델이 정하는 설정 ---------- */

  // Auto는 백엔드와 같은 규칙으로 목록의 첫 모델이 됩니다. 그래야 화면에
  // 보이는 선택지와 예상 비용이 실제로 쓰일 모델의 것과 같습니다.
  const activeModel = readyProject?.selected_model ?? models[0] ?? null;
  const caps = activeModel?.capabilities ?? null;
  const choice = useMemo(() => (caps ? reconcile(chosen, caps).choice : null), [caps, chosen]);
  const generateCost =
    caps && choice ? estimateCostKrw(caps, choice.resolution, choice.duration_seconds) : null;

  /** 버전을 만든 모델. 수정·이어서 만들기는 이 모델로 합니다. */
  const modelOf = useCallback(
    (version: VideoVersion) =>
      models.find((m) => m.provider === version.provider && m.model_id === version.model_id) ??
      null,
    [models],
  );

  /* ---------- 이름 바꾸기 · 삭제 ---------- */

  // Builder의 작업 공간과 같은 모양입니다 — 제목·메뉴·확인 창은
  // WorkspaceTitle과 ConfirmDialog에 한 번만 적혀 있습니다.
  const rename = useCallback(
    async (name: string) => {
      const updated = await updateVideoProject(projectId, { name });
      applyProject(updated);
      setSiblings((list) =>
        list.map((item) => (item.id === updated.id ? { ...item, name: updated.name } : item)),
      );
    },
    [applyProject, projectId],
  );

  const remove = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVideoProject(projectId);
      router.push("/video");
      router.refresh();
    } catch (error) {
      setDeleteError(describeError(error));
    } finally {
      setDeleting(false);
    }
  }, [projectId, router]);

  const askToDelete = useCallback((name: string) => {
    setDeleteError(null);
    setConfirm({
      title: "영상 프로젝트 삭제",
      effect: `'${name}' 영상 프로젝트를 삭제합니다. 만든 버전도 함께 사라지지만 관리자가 되살릴 수 있고, 사용량 기록은 그대로 남습니다.`,
      confirmLabel: "삭제",
      danger: true,
      onConfirm: () => remove(),
    });
  }, [remove]);

  /* ---------- 저장 ---------- */

  const savePrompt = useCallback(async () => {
    if (!mayCreate) return;
    if (state.phase !== "ready" || prompt === state.project.prompt) return;

    setSaving("saving");
    try {
      const updated = await updateVideoProject(projectId, { prompt });
      setState({ phase: "ready", project: updated });
      setSaving("saved");
      setTimeout(() => setSaving(null), 1500);
    } catch {
      setSaving(null);
    }
  }, [mayCreate, prompt, projectId, state]);

  const chooseModel = useCallback(
    async (value: string) => {
      if (!mayCreate) return;

      const selected_model_id = value === "auto" ? null : Number(value);
      // 새 모델에도 있는 선택은 그대로 두고, 없는 것만 그 모델의
      // 기본값으로 바꿉니다. 무엇이 바뀌었는지는 한 줄로 알립니다.
      const next =
        selected_model_id === null
          ? models[0]
          : models.find((model) => model.id === selected_model_id);
      if (next) {
        const fitted = reconcile(choice, next.capabilities);
        setChosen(fitted.choice);
        setNotice(settingsNotice(fitted.changes));
      }
      try {
        const updated = await updateVideoProject(projectId, { selected_model_id });
        setState({ phase: "ready", project: updated });
      } catch (error) {
        setState({ phase: "error", message: describeError(error) });
      }
    },
    [choice, mayCreate, models, projectId],
  );

  const changeChoice = useCallback((next: VideoChoice) => {
    setChosen(next);
    setNotice(null);
  }, []);

  /**
   * 돈이 드는 작업 하나를 실행합니다 — 생성, 수정, 이어서 만들기.
   *
   * 실패하면 화면 전체를 오류로 덮지 않고 버튼 아래에 이유를 적습니다.
   * 지원금이 모자란 것은 작업 공간이 깨진 것이 아니기 때문입니다.
   */
  const runPaid = useCallback(
    async (work: () => Promise<VideoVersion>) => {
      if (!mayCreate || working) return;
      setWorking(true);
      setActionError(null);
      setIsPlaying(false);
      setProgress(0);
      try {
        const version = await work();
        applyProject(await getVideoProject(projectId));
        setSelectedVersionId(version.id);
        setMode({ kind: "generate" });
        void refreshQuarter();
      } catch (error) {
        setActionError(describeError(error));
      } finally {
        setWorking(false);
      }
    },
    [applyProject, mayCreate, projectId, refreshQuarter, working],
  );

  const generate = useCallback(
    () =>
      runPaid(async () => {
        // 프롬프트를 먼저 저장해야 버전에 지금 내용이 기록됩니다.
        await updateVideoProject(projectId, { prompt });
        // 설정은 프로젝트가 아니라 이 화면의 조작부에 있으므로 함께
        // 보냅니다. 백엔드가 버전에 그대로 적어 둡니다.
        return createVideoVersion(projectId, choice ?? undefined);
      }),
    [choice, projectId, prompt, runPaid],
  );

  const markFinal = useCallback(async () => {
    if (!mayCreate || !selectedVersionId) return;
    try {
      const updated = await updateVideoProject(projectId, {
        final_version_id: selectedVersionId,
      });
      setState({ phase: "ready", project: updated });
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    }
  }, [mayCreate, projectId, selectedVersionId]);

  const openAction = useCallback((kind: VersionAction, sourceId: number) => {
    setActionError(null);
    setMode({ kind, sourceId });
  }, []);

  /* ---------- 화면 ---------- */

  if (state.phase === "loading") {
    return (
      <div className={ws.shell}>
        <div className={ws.loading}>
          <p className="muted">영상 프로젝트를 불러오는 중…</p>
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className={ws.shell}>
        <div className={ws.notFound}>
          <p className={ws.notFoundTitle}>영상 프로젝트를 열 수 없습니다</p>
          <p className={ws.notFoundText}>
            {state.message}. 주소가 맞는지, 백엔드가 실행 중인지 확인해 주세요.
          </p>
          <Link className="btn btn-sm" href="/video">
            ← 영상 프로젝트 목록으로
          </Link>
        </div>
      </div>
    );
  }

  const { project } = state;
  const artwork = artworkFor(selectedIndex >= 0 ? selectedIndex : 0);
  const elapsed = (progress / 100) * previewSeconds;
  const isFinal = selected !== null && project.final_version_id === selected.id;
  const lockedReason = mayCreate ? undefined : NOT_PARTICIPATING_HINT;

  // 미리보기 틀의 비율. 버전이 자기 비율을 들고 있으면 그것을 쓰고,
  // 모르는 버전이면 지금 고른 비율로 그립니다.
  const savedAspect = selected?.aspect_ratio ?? null;
  const fallbackAspect = choice?.aspect_ratio ?? "9:16";
  const previewAspect: Aspect = isAspect(savedAspect)
    ? savedAspect
    : isAspect(fallbackAspect)
      ? fallbackAspect
      : "9:16";

  /**
   * 한 버전이 실제로 쓴 모델의 이름.
   *
   * 버전에는 provider의 id(`kling-3.0-pro`)가 남습니다. 회원에게 보여 줄
   * 것은 이름(`Kling 3.0 Pro`)이므로 모델 목록에서 찾아 바꿉니다.
   * Auto가 고른 것이면 무엇으로 이어졌는지까지 보여 줍니다.
   */
  const modelNameFor = (version: VideoVersion): string => {
    const known =
      modelOf(version) ??
      (project.selected_model?.model_id === version.model_id ? project.selected_model : null);
    const name = known?.display_name ?? prettyModelId(version.model_id);
    return version.auto_selected ? `Auto → ${name}` : name;
  };

  const labelOf = (id: number | null): string | null =>
    versions.find((version) => version.id === id)?.label ?? null;

  // 고른 버전으로 수정·이어서 만들기를 할 수 있는지, 없으면 왜인지.
  const selectedModel = selected ? modelOf(selected) : null;
  const recorded = selected ? hasRecordedSettings(selected) : false;
  const canEdit = Boolean(recorded && selectedModel?.capabilities.supports_edit);
  const canExtend = Boolean(recorded && selectedModel?.capabilities.supports_extend);
  let actionNote: string | null = null;
  if (selected && !(canEdit && canExtend)) {
    if (!selectedModel) actionNote = "이 버전을 만든 모델은 지금 쓸 수 없어 수정·이어서 만들기가 안 됩니다.";
    else if (!recorded) actionNote = "설정이 기록되지 않은 버전은 수정하거나 이어서 만들 수 없습니다.";
    else if (!canEdit && !canExtend)
      actionNote = `${selectedModel.display_name} 모델은 수정과 이어서 만들기를 지원하지 않습니다.`;
    else if (!canEdit) actionNote = `${selectedModel.display_name} 모델은 수정을 지원하지 않습니다.`;
    else actionNote = `${selectedModel.display_name} 모델은 이어서 만들기를 지원하지 않습니다.`;
  }

  const actionSource =
    mode.kind === "generate" ? null : (versions.find((v) => v.id === mode.sourceId) ?? null);
  const actionModel = actionSource ? modelOf(actionSource) : null;

  return (
    <div className={ws.shell}>
      {/* 위쪽 막대 */}
      <div className={ws.topbar}>
        {/* 돌아가는 곳은 Video Generator 목록입니다. Project Builder의
            작업 공간과 같은 자리·같은 아이콘·같은 짜임으로 둡니다. */}
        <Link className={ws.backLink} href="/video">
          <ArrowLeft size={14} aria-hidden="true" />
          Video Generator
        </Link>
        <span className={ws.topbarDivider} aria-hidden="true" />

        <WorkspaceTitle
          currentId={project.id}
          emptyLabel="다른 프로젝트가 없습니다"
          lockedHint={NOT_PARTICIPATING_HINT}
          mayEdit={mayCreate}
          name={project.name}
          onDelete={() => askToDelete(project.name)}
          onRename={rename}
          siblings={siblings.map((item) => ({
            id: item.id,
            name: item.name,
            href: `/video/${item.id}`,
            meta: VIDEO_STATUS_LABEL[item.status],
          }))}
        />

        <span className={`badge ${VIDEO_STATUS_BADGE[project.status]}`}>
          {VIDEO_STATUS_LABEL[project.status]}
        </span>

        <span className={ws.topbarSpacer} />
      </div>

      <NotParticipatingBanner inWorkspace />

      <div className={ws.body}>
        {/* 왼쪽 — 프롬프트와 설정, 또는 수정·이어서 만들기 */}
        <aside className={`${ws.pane} ${styles.left}`}>
          <div className={ws.paneHead}>
            <span className={ws.paneHeadTitle}>
              {mode.kind === "generate" ? "프롬프트 · 설정" : "버전에서 이어 작업하기"}
            </span>
            {saving && (
              <span className={styles.savingHint}>
                {saving === "saving" ? "저장 중…" : "저장됨"}
              </span>
            )}
          </div>
          <div className={ws.paneBody}>
            {mode.kind !== "generate" && actionSource && actionModel ? (
              <VersionActionPanel
                key={`${mode.kind}-${actionSource.id}`}
                action={mode.kind}
                source={actionSource}
                model={actionModel}
                busy={working}
                error={actionError}
                lockedReason={lockedReason}
                onEdit={(instruction) =>
                  void runPaid(() => editVideoVersion(projectId, actionSource.id, instruction))
                }
                onExtend={(seconds) =>
                  void runPaid(() => extendVideoVersion(projectId, actionSource.id, seconds))
                }
                onCancel={() => {
                  setActionError(null);
                  setMode({ kind: "generate" });
                }}
              />
            ) : (
              <>
                <p className="section-title">어떤 영상을 만들까요?</p>
                {/* readOnly이지 disabled가 아닙니다. 참여하지 않는 회원도
                    자기가 쓴 프롬프트를 읽고 복사할 수 있어야 합니다. */}
                <textarea
                  className={`field ${styles.promptArea}`}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onBlur={() => void savePrompt()}
                  placeholder={
                    mayCreate
                      ? "영상 아이디어를 자유롭게 적어주세요"
                      : "이번 분기에는 고칠 수 없습니다"
                  }
                  readOnly={!mayCreate}
                  title={lockedReason}
                  aria-label="영상 프롬프트"
                />
                <div className={styles.promptMeta}>
                  <span>한국어로 적으면 됩니다</span>
                  <span>{prompt.length}자</span>
                </div>

                <div className={styles.settings}>
                  <div className={styles.settingRow}>
                    <label className={styles.settingLabel} htmlFor="video-model">
                      Model
                    </label>
                    <select
                      className="field"
                      id="video-model"
                      value={project.selected_model_id ?? "auto"}
                      onChange={(event) => void chooseModel(event.target.value)}
                      disabled={!mayCreate}
                      title={lockedReason}
                    >
                      {/* Auto는 CTRL+AI의 선택지이지 Higgsfield 모델이 아닙니다. */}
                      <option value="auto">
                        Auto — 추천{models[0] ? ` (${models[0].display_name})` : ""}
                      </option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.display_name}
                        </option>
                      ))}
                    </select>
                    <p className={styles.settingHint}>
                      {project.selected_model
                        ? project.selected_model.description
                        : "CTRL+AI가 알맞은 모델을 고릅니다."}
                    </p>
                  </div>

                  {caps && choice ? (
                    <VideoSettings
                      caps={caps}
                      choice={choice}
                      onChange={changeChoice}
                      lockedReason={lockedReason}
                    />
                  ) : (
                    <p className={styles.settingHint}>모델 정보를 불러오는 중…</p>
                  )}

                  {notice && (
                    <p className={styles.settingNotice} role="status">
                      {notice}
                    </p>
                  )}
                </div>

                {/* 생성 전에 무엇으로 만드는지 한 줄로 확인합니다. */}
                {choice && (
                  <p className={styles.summary} data-testid="video-summary">
                    <span className={styles.summaryModel}>
                      {activeModel?.display_name ?? "Auto"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{choice.duration_seconds}초</span>
                    <span aria-hidden="true">·</span>
                    <span>{ASPECT_LABEL[choice.aspect_ratio as Aspect] ?? choice.aspect_ratio}</span>
                    <span aria-hidden="true">·</span>
                    <span>{choice.resolution}</span>
                    <span aria-hidden="true">·</span>
                    <span>{caps?.sound ? (choice.sound ? "소리 켬" : "소리 끔") : "소리 없음"}</span>
                  </p>
                )}

                <div className={styles.actions}>
                  <span className={styles.costRow}>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => void generate()}
                      disabled={!mayCreate || working || !choice}
                      title={lockedReason}
                    >
                      {!mayCreate && <Lock size={13} aria-hidden="true" />}{" "}
                      {working ? "생성 중…" : "Higgsfield로 생성"}
                    </button>
                    <span className={styles.cost} data-testid="generate-cost">
                      {costLabel(generateCost)}
                    </span>
                  </span>
                  <p className="small dim">
                    {mayCreate ? "만들 때마다 Video 지원금에서 차감됩니다." : NOT_PARTICIPATING_HINT}
                  </p>
                  {actionError && (
                    <p className={styles.actionError} role="alert">
                      {actionError}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* 가운데 — 미리보기 */}
        <section className={`${ws.pane} ${ws.paneCenter}`}>
          <div className={ws.paneHead}>
            <span className={ws.paneHeadTitle}>
              미리보기
              {selected && <span className="badge badge-muted">{selected.label}</span>}
              {/* 이 버전을 만든 설정. 버전에 적혀 있는 값이므로 새로고침
                  뒤에도, 설정을 바꾼 뒤에도 그대로입니다. */}
              {selected && selected.duration_seconds != null && (
                <span className={styles.previewSettings}>
                  {selected.duration_seconds}초
                  {isAspect(selected.aspect_ratio)
                    ? ` · ${ASPECT_LABEL[selected.aspect_ratio]}`
                    : ""}
                  {selected.resolution ? ` · ${selected.resolution}` : ""}
                  {selected.sound == null ? "" : selected.sound ? " · 소리 켬" : " · 소리 끔"}
                </span>
              )}
              {isFinal && <span className="badge badge-ok">최종본</span>}
            </span>
            {/* 모델은 이름으로 보여 줍니다. provider의 날 id를 그대로 띄우면
                설정의 "Auto — 추천"과 같은 것을 가리키는지 알 수 없습니다. */}
            <span className={styles.previewHeadEnd}>
              <span>{selected ? modelNameFor(selected) : "버전 없음"}</span>
              {/* 지금 보고 있는 버전을 받습니다. 최종본이 아니어도 됩니다. */}
              {selected && <VersionDownload projectId={projectId} version={selected} />}
            </span>
          </div>

          <div className={styles.stage}>
            {versions.length === 0 ? (
              <div className={styles.noVersions}>
                <p className={styles.noVersionsTitle}>아직 만든 버전이 없습니다</p>
                <p className={styles.noVersionsText}>
                  왼쪽에 아이디어를 적고 <strong>Higgsfield로 생성</strong>을 누르면 첫 번째
                  버전이 만들어집니다.
                </p>
              </div>
            ) : (
              <>
                <div className={styles.playerFrame}>
                  <div
                    className={styles.player}
                    style={
                      {
                        // 비율 하나로 두 가지를 정합니다: 틀의 aspect-ratio와,
                        // 높이를 너비로 환산할 때 쓰는 배수. 자세한 것은
                        // workspace.module.css의 .player에 적어 두었습니다.
                        "--player-ar": ASPECT_RATIO_CSS[previewAspect],
                      } as React.CSSProperties
                    }
                  >
                  <div
                    className={`${styles.playerArt} ${isPlaying ? styles.playerArtPlaying : ""}`}
                    style={{
                      background: artwork,
                    }}
                  >
                    <div>
                      <p className={styles.playerLabel}>{project.name}</p>
                      <p className={styles.playerSub}>
                        {selected ? `${selected.label} · ${formatClock(selected.created_at)}` : ""}
                      </p>
                    </div>
                  </div>

                  {!isPlaying && !working && (
                    <button
                      className={styles.playOverlay}
                      type="button"
                      onClick={() => {
                        if (progress >= 100) setProgress(0);
                        setIsPlaying(true);
                      }}
                    >
                      <span className={styles.playOverlayGlyph} aria-hidden="true">
                        <Play size={16} aria-hidden="true" />
                      </span>
                      <span className="sr-only">재생</span>
                    </button>
                  )}

                  {working && (
                    <div className={styles.generating}>
                      <div>
                        <div className={styles.spinner} aria-hidden="true" />
                        Higgsfield로 만드는 중…
                        <p className="small dim">잠시만 기다려 주세요</p>
                      </div>
                    </div>
                  )}

                  <div className={styles.controls}>
                    <div
                      className={styles.timeline}
                      role="progressbar"
                      aria-valuenow={Math.round(progress)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="재생 위치"
                    >
                      <div className={styles.timelineFill} style={{ width: `${progress}%` }} />
                    </div>
                    <div className={styles.controlRow}>
                      <button
                        className={styles.controlBtn}
                        type="button"
                        onClick={() => {
                          if (!isPlaying && progress >= 100) setProgress(0);
                          setIsPlaying((p) => !p);
                        }}
                        aria-label={isPlaying ? "일시정지" : "재생"}
                      >
                        {isPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                      </button>
                      <button
                        className={styles.controlBtn}
                        type="button"
                        onClick={() => {
                          setProgress(0);
                          setIsPlaying(true);
                        }}
                        aria-label="처음부터 다시 재생"
                      >
                        ↻
                      </button>
                      <span className={styles.time}>
                        {formatTime(elapsed)} / {formatTime(previewSeconds)}
                      </span>
                      <span className={styles.controlSpacer} />
                      <button
                        className={styles.controlBtn}
                        type="button"
                        onClick={() => setMuted((v) => !v)}
                        aria-label={muted ? "소리 켜기" : "소리 끄기"}
                      >
                        {muted ? "🔇" : "🔊"}
                      </button>
                    </div>
                    </div>
                  </div>
                </div>

                <p className={styles.stageMeta}>
                  <span>{selected?.provider ?? "Higgsfield"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{selected ? formatClock(selected.created_at) : ""}</span>
                  {selected?.instruction && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>수정 요청: {selected.instruction}</span>
                    </>
                  )}
                </p>
              </>
            )}
          </div>
        </section>

        {/* 오른쪽 — 프롬프트 도움받기(선택). 접혀서 시작합니다. */}
        <PromptHelper
          projectId={projectId}
          prompt={prompt}
          mayCreate={mayCreate}
          onApply={setPrompt}
          onCharged={() => void refreshQuarter()}
        />
      </div>

      {/* 아래 — 버전 */}
      <div className={ws.bottom}>
        <div className={styles.versionBar}>
          <span className="section-title" style={{ margin: 0 }}>
            버전
          </span>

          {versions.length === 0 ? (
            <span className="small dim">생성하면 여기에 쌓입니다</span>
          ) : (
            <ul className={styles.versionList}>
              {versions.map((version, index) => {
                const source = labelOf(version.source_version_id);
                return (
                  <li className={styles.versionItem} key={version.id}>
                    <button
                      className={`${styles.version} ${
                        version.id === selectedVersionId ? styles.versionActive : ""
                      }`}
                      type="button"
                      onClick={() => {
                        setSelectedVersionId(version.id);
                        setProgress(0);
                        setIsPlaying(false);
                      }}
                      aria-pressed={version.id === selectedVersionId}
                    >
                      <span
                        className={styles.versionThumb}
                        style={{
                          background: artworkFor(index),
                        }}
                        aria-hidden="true"
                      />
                      <span className={styles.versionMeta}>
                        <span>
                          {version.label}{" "}
                          <span className={styles.versionKind}>
                            {VERSION_KIND_LABEL[version.kind]}
                            {source ? ` ← ${source}` : ""}
                          </span>
                        </span>
                        {/* 버전이 자기 설정을 들고 있으면 그것을, 모르면
                            만든 시각을 보여 줍니다. */}
                        <span className={styles.versionTime}>
                          {settingsLine(version) || formatClock(version.created_at)}
                        </span>
                        <span className={styles.versionModel}>{modelNameFor(version)}</span>
                      </span>
                      {project.final_version_id === version.id && (
                        <span className="badge badge-ok">최종</span>
                      )}
                    </button>
                    {/* 버전마다 따로 받을 수 있습니다. 조각 단추 밖에 두는 것은
                        단추 안에 링크를 넣을 수 없기 때문입니다. */}
                    <VersionDownload compact projectId={projectId} version={version} />
                  </li>
                );
              })}
            </ul>
          )}

          <span className={styles.versionSpacer} />

          <span className={styles.versionActions}>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => void generate()}
              disabled={!mayCreate || working || !choice}
              title={lockedReason}
            >
              {!mayCreate && <Lock size={12} aria-hidden="true" />} 다시 생성
            </button>
            {selected && canEdit && (
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => openAction("edit", selected.id)}
                disabled={!mayCreate || working}
                title={lockedReason}
              >
                {!mayCreate && <Lock size={12} aria-hidden="true" />} 이 영상 수정하기
              </button>
            )}
            {selected && canExtend && (
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => openAction("extend", selected.id)}
                disabled={!mayCreate || working}
                title={lockedReason}
              >
                {!mayCreate && <Lock size={12} aria-hidden="true" />} 이어서 만들기
              </button>
            )}
            {actionNote && <span className={styles.actionNote}>{actionNote}</span>}
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => void markFinal()}
              disabled={!mayCreate || !selected || isFinal}
              title={lockedReason}
            >
              {!mayCreate && <Lock size={12} aria-hidden="true" />}{" "}
              {isFinal ? "최종본으로 지정됨" : "최종본으로 선택"}
            </button>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              disabled
              title={
                project.final_version_id
                  ? "YouTube 게시는 Phase 7에서 제공됩니다"
                  : "먼저 최종본을 선택해 주세요"
              }
            >
              YouTube에 게시
            </button>
          </span>
        </div>
      </div>

      <ConfirmDialog
        busy={deleting}
        error={deleteError}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
