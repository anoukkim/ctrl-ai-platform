"use client";

/**
 * Video Generator 작업 공간 — 영상 프로젝트 하나.
 *
 * 한 번 만들고 끝나는 화면이 아닙니다:
 *   아이디어 → 생성 → 확인 → Claude와 상의 → 프롬프트 수정 →
 *   다시 생성 → 버전 비교 → 최종본 선택 → YouTube에 게시
 *
 * Phase 1에서 달라진 점: 프로젝트, 프롬프트, 버전, 선택한 모델이 이제
 * 데이터베이스에 남습니다. 새로고침해도 사라지지 않습니다.
 *
 * 아직 목업인 것: Claude 대화(미리 준비한 문장 중에서 고릅니다)와 영상
 * 재생. Higgsfield는 호출하지 않으며, "생성"은 시도를 기록만 합니다.
 */

import { ArrowLeft, Lock, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useMayCreate } from "@/app/components/MyQuarterProvider";
import NotParticipatingBanner from "@/app/components/NotParticipatingBanner";
import WorkspaceTitle from "@/app/components/WorkspaceTitle";
import ws from "@/app/components/workspace.module.css";
import {
  VIDEO_STATUS_BADGE,
  VIDEO_STATUS_LABEL,
  createVideoVersion,
  deleteVideoProject,
  describeError,
  getVideoProject,
  listVideoModels,
  listVideoProjects,
  updateVideoProject,
  type VideoModel,
  type VideoProject,
  type VideoProjectDetail,
  type VideoVersion,
} from "@/lib/projects";
import {
  MOCK_VIDEO_FALLBACK_REPLY,
  MOCK_VIDEO_REVISIONS,
  type VideoChatMessage,
} from "@/lib/mock-data";

import { NOT_PARTICIPATING_HINT } from "@/lib/quarters";

import VideoSettings, {
  ALL_ASPECTS,
  ALL_DURATIONS,
  ASPECT_LABEL,
  ASPECT_RATIO_CSS,
  type Aspect,
} from "./VideoSettings";
import styles from "./workspace.module.css";

/** 재생 눈금의 간격(ms). 실제 영상이 아니라 재생 느낌만 흉내 냅니다. */
const TICK_MS = 150;

/** 버전의 길이를 모를 때 쓰는 값(초).
 *
 *  길이 칸이 생기기 전에 만들어진 버전에만 해당합니다. 예전에는 모든
 *  버전을 15초로 재생했고, 그래서 10초로 만든 버전이 0:15로 보였습니다. */
const UNKNOWN_DURATION_SECONDS = 15;

/** 모델 이름을 모를 때라도 provider의 날 id는 보여 주지 않습니다.
 *  `kling-3.0-pro` → `Kling 3.0 Pro`. 관리자가 모델을 목록에서 내리면
 *  지난 버전이 가리키는 모델이 목록에 없을 수 있습니다. */
function isAspect(value: string | null): value is Aspect {
  return value === "9:16" || value === "16:9" || value === "1:1";
}

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
  return `0:${String(Math.floor(seconds)).padStart(2, "0")}`;
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

type State =
  | { phase: "loading" }
  | { phase: "ready"; project: VideoProjectDetail }
  | { phase: "error"; message: string };

export default function VideoWorkspace({ projectId }: { projectId: string }) {
  // 참여하지 않는 분기에도 이 화면은 열리고, 지난 버전은 모두 볼 수
  // 있습니다. 막히는 것은 저장·생성·최종본 선택처럼 바꾸는 쪽입니다.
  // 실제 거절은 백엔드가 합니다 — 아래 잠금은 설명일 뿐입니다.
  const mayCreate = useMayCreate();
  const router = useRouter();

  const [state, setState] = useState<State>({ phase: "loading" });
  const [siblings, setSiblings] = useState<VideoProject[]>([]);
  const [models, setModels] = useState<VideoModel[]>([]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  // 빈 대화로 시작합니다. 예전에는 미리 적어 둔 예시 대화가 들어 있어,
  // 새로 만든 프로젝트가 이미 Claude와 이야기를 나눈 것처럼 보였습니다.
  const [messages, setMessages] = useState<VideoChatMessage[]>([]);
  const [draft, setDraft] = useState("");

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState<null | "saving" | "saved">(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // 생성 설정. 기본값은 모델이 지원하는 것 중 첫 번째로, 아래 효과가
  // 모델이 바뀔 때마다 다시 맞춥니다.
  const [duration, setDuration] = useState(10);
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [sound, setSound] = useState(true);
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

  /** 생성 뒤처럼 이벤트에서 다시 불러올 때 씁니다. */
  const load = useCallback(async () => {
    try {
      applyProject(await getVideoProject(projectId));
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    }
  }, [applyProject, projectId]);

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
        /* 모델을 못 받으면 Auto만 남습니다 */
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

  /* ---------- 모델에 맞춘 실제 설정 ---------- */

  // 고친 값을 저장하지 않고 그때그때 계산합니다. 회원이 고른 값은 그대로
  // 두고, 지금 모델이 지원하지 않을 때만 가장 가까운 값으로 바꿔서 씁니다.
  // 그래서 지원하는 모델로 되돌리면 원래 고른 값이 그대로 돌아옵니다.
  const capabilities =
    state.phase === "ready" ? (state.project.selected_model?.capabilities ?? null) : null;
  const capDurations = capabilities?.durations ?? [];
  const capAspects = capabilities?.aspect_ratios ?? [];
  const capSound = capabilities?.sound ?? true;

  const durations = capDurations.length > 0 ? capDurations : ALL_DURATIONS;
  const aspects = capAspects.length > 0 ? capAspects : ALL_ASPECTS;

  const effectiveDuration = durations.includes(duration)
    ? duration
    : durations.reduce((best, value) =>
        Math.abs(value - duration) < Math.abs(best - duration) ? value : best,
      );
  const effectiveAspect: Aspect = aspects.includes(aspect) ? aspect : (aspects[0] as Aspect);
  const effectiveSound = capSound ? sound : false;

  // 바뀐 것이 있으면 왜 바뀌었는지 한 줄로 알려 줍니다. 조용히 바꾸면
  // 생성 결과가 예상과 달라집니다.
  const adjustments: string[] = [];
  if (effectiveDuration !== duration) adjustments.push(`길이를 ${effectiveDuration}초로`);
  if (effectiveAspect !== aspect) adjustments.push(`비율을 ${ASPECT_LABEL[effectiveAspect]}로`);
  if (effectiveSound !== sound) adjustments.push("소리를 끔으로");
  const settingNotice =
    adjustments.length > 0 ? `이 모델에 맞춰 ${adjustments.join(", ")} 바꿨습니다.` : null;

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
      try {
        const updated = await updateVideoProject(projectId, { selected_model_id });
        setState({ phase: "ready", project: updated });
      } catch (error) {
        setState({ phase: "error", message: describeError(error) });
      }
    },
    [mayCreate, projectId],
  );

  const generate = useCallback(async () => {
    if (!mayCreate || generating) return;

    setGenerating(true);
    setIsPlaying(false);
    setProgress(0);
    try {
      // 프롬프트를 먼저 저장해야 버전에 지금 내용이 기록됩니다.
      await updateVideoProject(projectId, { prompt });
      // 길이·비율·소리는 프로젝트가 아니라 이 화면의 조작부에 있으므로
      // 함께 보냅니다. 백엔드가 버전에 적어 두면, 나중에 설정을 바꿔도
      // 이 버전은 자기를 만든 값을 그대로 보여 줍니다.
      const version = await createVideoVersion(projectId, {
        duration_seconds: effectiveDuration,
        aspect_ratio: effectiveAspect,
        sound: effectiveSound,
      });
      await load();
      setSelectedVersionId(version.id);
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    } finally {
      setGenerating(false);
    }
  }, [
    effectiveAspect,
    effectiveDuration,
    effectiveSound,
    generating,
    load,
    mayCreate,
    projectId,
    prompt,
  ]);

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

  /* ---------- Claude (목업) ---------- */

  const askClaude = useCallback(() => {
    if (!mayCreate) return;

    const trimmed = draft.trim();
    if (!trimmed) return;

    const rule = MOCK_VIDEO_REVISIONS.find((item) => item.match.test(trimmed));
    setMessages((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: "user", body: trimmed },
      rule
        ? {
            id: `a-${Date.now()}`,
            role: "assistant",
            body: rule.reply,
            revisedPrompt: rule.revise(prompt),
          }
        : { id: `a-${Date.now()}`, role: "assistant", body: MOCK_VIDEO_FALLBACK_REPLY },
    ]);
    setDraft("");
  }, [draft, mayCreate, prompt]);

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

  // 미리보기 틀의 비율. 버전이 자기 비율을 들고 있으면 그것을 쓰고,
  // 모르는 버전이면 지금 고른 비율로 그립니다.
  const savedAspect = selected?.aspect_ratio ?? null;
  const previewAspect: Aspect = isAspect(savedAspect) ? savedAspect : effectiveAspect;

  /**
   * 한 버전이 실제로 쓴 모델의 이름.
   *
   * 버전에는 provider의 id(`kling-3.0-pro`)가 남습니다. 회원에게 보여 줄
   * 것은 이름(`Kling 3.0 Pro`)이므로 모델 목록에서 찾아 바꿉니다.
   * Auto가 고른 것이면 무엇으로 이어졌는지까지 보여 줍니다 — 설정에는
   * "Auto"라고 적혀 있는데 미리보기에는 모르는 id가 떠 있으면, 둘이
   * 같은 것을 가리키는지 알 수 없습니다.
   */
  const modelNameFor = (version: VideoVersion): string => {
    const known =
      models.find((model) => model.model_id === version.model_id) ??
      (project.selected_model?.model_id === version.model_id
        ? project.selected_model
        : undefined);
    const name = known?.display_name ?? prettyModelId(version.model_id);
    return version.auto_selected ? `Auto → ${name}` : name;
  };

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
        {/* 왼쪽 — 프롬프트와 설정 */}
        <aside className={`${ws.pane} ${styles.left}`}>
          <div className={ws.paneHead}>
            <span className={ws.paneHeadTitle}>프롬프트 · 설정</span>
            {saving && (
              <span className={styles.savingHint}>
                {saving === "saving" ? "저장 중…" : "저장됨"}
              </span>
            )}
          </div>
          <div className={ws.paneBody}>
            <p className="section-title">어떤 영상을 만들까요?</p>
            {/* readOnly이지 disabled가 아닙니다. 참여하지 않는 회원도 자기가
                쓴 프롬프트를 읽고 복사할 수 있어야 합니다. disabled면 글자를
                고를 수조차 없습니다. */}
            <textarea
              className={`field ${styles.promptArea}`}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onBlur={() => void savePrompt()}
              placeholder={
                mayCreate ? "영상 아이디어를 자유롭게 적어주세요" : "이번 분기에는 고칠 수 없습니다"
              }
              readOnly={!mayCreate}
              title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
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
                  title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                >
                  {/* Auto는 CTRL+AI의 선택지이지 Higgsfield 모델이 아닙니다. */}
                  <option value="auto">Auto — 추천</option>
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

              <VideoSettings
                duration={effectiveDuration}
                aspect={effectiveAspect}
                sound={effectiveSound}
                supportedDurations={capDurations}
                supportedAspects={capAspects}
                supportsSound={capSound}
                onDuration={setDuration}
                onAspect={setAspect}
                onSound={setSound}
                lockedReason={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
              />

              {settingNotice && (
                <p className={styles.settingNotice} role="status">
                  {settingNotice}
                </p>
              )}
            </div>

            {/* 생성 전에 무엇으로 만드는지 한 줄로 확인합니다. */}
            <p className={styles.summary}>
              <span className={styles.summaryModel}>
                {project.selected_model?.display_name ?? "Auto"}
              </span>
              <span aria-hidden="true">·</span>
              <span>{effectiveDuration}초</span>
              <span aria-hidden="true">·</span>
              <span>{ASPECT_LABEL[effectiveAspect]}</span>
              <span aria-hidden="true">·</span>
              <span>{capSound ? (effectiveSound ? "소리 켬" : "소리 끔") : "소리 없음"}</span>
            </p>

            <div className={styles.actions}>
              <button
                className="btn"
                type="button"
                onClick={() => setDraft("조금 더 어두운 분위기로 바꿔줘.")}
                disabled={!mayCreate}
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
              >
                {!mayCreate && <Lock size={13} aria-hidden="true" />} Claude로 다듬기
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void generate()}
                disabled={!mayCreate || generating}
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
              >
                {!mayCreate && <Lock size={13} aria-hidden="true" />}{" "}
                {generating ? "생성 중…" : "Higgsfield로 생성"}
              </button>
              <p className="small dim">
                {mayCreate
                  ? "아직 실제로 영상을 만들지는 않습니다. 시도만 버전으로 기록됩니다."
                  : NOT_PARTICIPATING_HINT}
              </p>
            </div>
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
                  {selected.sound == null ? "" : selected.sound ? " · 소리 켬" : " · 소리 끔"}
                </span>
              )}
              {isFinal && <span className="badge badge-ok">최종본</span>}
            </span>
            {/* 모델은 이름으로 보여 줍니다. provider의 날 id를 그대로 띄우면
                설정의 "Auto — 추천"과 같은 것을 가리키는지 알 수 없습니다. */}
            <span>{selected ? modelNameFor(selected) : "버전 없음"}</span>
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

                  {!isPlaying && !generating && (
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

                  {generating && (
                    <div className={styles.generating}>
                      <div>
                        <div className={styles.spinner} aria-hidden="true" />
                        Higgsfield로 생성 중…
                        <p className="small dim">시도를 기록하고 있습니다</p>
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
                </p>
              </>
            )}
          </div>
        </section>

        {/* 오른쪽 — Claude */}
        <aside className={`${ws.pane} ${ws.paneLast} ${styles.right}`}>
          <div className={styles.rightInner}>
            <div className={ws.paneHead}>
              <span className={ws.paneHeadTitle}>Claude</span>
              <span className="badge badge-mock">준비 중</span>
            </div>
            <div className={ws.paneBody}>
              <div className={ws.chatThread}>
                {/* 아직 아무 말도 주고받지 않은 상태. 예시 대화를 미리 채워
                    두면 새 프로젝트가 이미 상의를 마친 것처럼 보입니다. */}
                {messages.length === 0 && (
                  <p className={styles.chatEmpty}>
                    영상 아이디어를 Claude와 다듬어 보세요. 분위기, 길이, 장면 순서처럼
                    바꾸고 싶은 것을 한국어로 적으면 됩니다.
                  </p>
                )}
                {messages.map((message) => (
                  <div
                    className={`${ws.chatMessage} ${
                      message.role === "user" ? ws.chatUser : ws.chatAssistant
                    }`}
                    key={message.id}
                  >
                    <span className={ws.chatRole}>
                      {message.role === "user" ? "나" : "Claude"}
                    </span>
                    {message.body}
                    {message.revisedPrompt && (
                      <button
                        className={`btn btn-sm ${styles.applyBtn}`}
                        type="button"
                        onClick={() => setPrompt(message.revisedPrompt as string)}
                        disabled={!mayCreate}
                        title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                      >
                        {!mayCreate && <Lock size={12} aria-hidden="true" />} 수정된 프롬프트 적용
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className={ws.chatComposer}>
              <input
                className="field"
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // 한글 조합 중 Enter는 무시합니다.
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    askClaude();
                  }
                }}
                placeholder={mayCreate ? "어떻게 바꿀까요?" : "이번 분기에는 사용할 수 없습니다"}
                disabled={!mayCreate}
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                aria-label="Claude에게 수정 요청하기"
              />
              <button
                className="btn btn-sm"
                type="button"
                onClick={askClaude}
                disabled={!mayCreate || !draft.trim()}
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
              >
                {mayCreate ? "보내기" : <Lock size={13} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </aside>
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
              {versions.map((version, index) => (
                <li key={version.id}>
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
                      <span>{version.label}</span>
                      {/* 버전이 자기 설정을 들고 있으면 그것을, 모르면
                          만든 시각을 보여 줍니다. */}
                      <span className={styles.versionTime}>
                        {version.duration_seconds != null
                          ? `${version.duration_seconds}초${
                              version.aspect_ratio ? ` · ${version.aspect_ratio}` : ""
                            }`
                          : formatClock(version.created_at)}
                      </span>
                      <span className={styles.versionModel}>{modelNameFor(version)}</span>
                    </span>
                    {project.final_version_id === version.id && (
                      <span className="badge badge-ok">최종</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <span className={styles.versionSpacer} />

          <span className={styles.versionActions}>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => void generate()}
              disabled={!mayCreate || generating}
              title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
            >
              {!mayCreate && <Lock size={12} aria-hidden="true" />} 다시 생성
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => void markFinal()}
              disabled={!mayCreate || !selected || isFinal}
              title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
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
