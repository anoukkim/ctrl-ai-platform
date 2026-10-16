"use client";

/**
 * Project Builder 작업 공간 — 프로젝트 하나.
 *
 * 구성: 왼쪽에 이 프로젝트의 파일만, 가운데에 코드 또는 미리보기,
 * 오른쪽에 Claude. 프로젝트 목록은 위쪽 막대의 전환 메뉴에 있습니다.
 *
 * 배치 (quality-tuning Q3): 가운데는 코드 / 미리보기 두 탭(나란히는
 * 없앴습니다)이고 마지막 탭을 프로젝트마다 기억합니다. 왼쪽 파일 목록과
 * 오른쪽 Claude 판은 접을 수 있고(기억), 1100px 아래에서는 파일 목록이
 * 서랍, Claude 판이 아래에서 올라오는 시트가 됩니다. 안내 문서(README ·
 * CLAUDE.md …)는 "안내 문서" 폴더로 따로 묶습니다.
 *
 * 프로젝트 정보와 파일은 백엔드에서 가져옵니다. 빈 프로젝트에서는 Claude가
 * 작은 예시 앱(HTML·CSS·JS)을 만들어 줄 수 있고(chat-builder-starter),
 * 오른쪽에서 말로 만들고 고칠 수 있습니다(builder-static-runtime). 바뀔
 * 때마다 버전이 남아 되돌릴 수 있고, 앱은 앱 주소(apps.ctrlai.my)에 올라가
 * 미리보기 프레임 안에서 돌아갑니다. GitHub 연동은 다음 단계입니다.
 */

import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Tag,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import MenuButton from "@/app/components/MenuButton";
import { useMayCreate } from "@/app/components/MyQuarterProvider";
import NotParticipatingBanner from "@/app/components/NotParticipatingBanner";
import WorkspaceTitle from "@/app/components/WorkspaceTitle";
import ws from "@/app/components/workspace.module.css";
import {
  BUILDER_STATUS_LABEL,
  deleteBuilderProject,
  appUrl,
  describeError,
  APP_LIMITS_NOTE,
  labelVersion,
  publicUrl,
  chooseThumbnail,
  publishProject,
  setAiAccess,
  unpublishProject,
  uploadThumbnail,
  getBuilderProject,
  getGenerateEstimate,
  getVersionFiles,
  isGuideDoc,
  listBuilderFiles,
  listBuilderProjects,
  listVersions,
  refreshAppRuntime,
  restoreVersion,
  updateBuilderProject,
  builderPickerModel,
  type BuilderFile,
  type BuilderProject,
  type BuilderVersion,
  type GenerateEstimate,
} from "@/lib/projects";
import { useSite } from "@/app/components/SiteProvider";
import { relativeTime } from "@/lib/relative-time";
import ProjectStatusBadge from "@/app/components/ProjectStatusBadge";
import WalletCheck from "@/app/components/WalletCheck";
import TestModeNotice from "@/app/components/TestModeNotice";
import { useMyQuarter } from "@/app/components/MyQuarterProvider";
import { useSpendFeedback } from "@/app/components/SpendFeedbackProvider";
import { NOT_PARTICIPATING_HINT, formatKrw } from "@/lib/quarters";
import ModelDepthPicker from "@/app/components/ModelDepthPicker";
import {
  cancelGeneration,
  getOpenGeneration,
  planGeneration,
  runGeneration,
  type Generation,
  type PlanInput,
} from "@/lib/generation";
import { NO_PROGRESS, PlanCard, StartForm, type Progress } from "./StagedGeneration";
import type { DepthLevel, PickerModel } from "@/lib/depth";
import { usePref, useMediaQuery, writePref } from "@/lib/layout-prefs";

import ClaudeHistory, { particleRo } from "./ClaudeHistory";
import CodeView from "./CodeView";
import { blobToDataUrl, captureFrame } from "@/lib/thumbnail-capture";

import HiddenCapture from "./HiddenCapture";
import ThumbnailDialog from "./ThumbnailDialog";
import { type CandidateKind } from "./ThumbnailPicker";
import PreviewPane from "./PreviewPane";
import HandoffSheet, { type HandoffMode } from "./HandoffSheet";
import PublishDialog, { type PublishValues } from "./PublishDialog";
import styles from "./workspace.module.css";
import Skeleton from "@/app/components/Skeleton";
import { useToast } from "@/app/components/ToastProvider";

type Mode = "code" | "preview";

type State =
  | { phase: "loading" }
  | { phase: "ready"; project: BuilderProject }
  | { phase: "error"; message: string };

const ENTRY_FILE = "index.html";

/** 이 폭 아래에서 파일 목록은 서랍, Claude 판은 시트 (1100px). */
const NARROW_QUERY = "(max-width: 68.74rem)";

/** Claude 판 입력칸의 예시 — 몇 초마다 바뀝니다. */
export const ASK_EXAMPLES = [
  "버튼 색을 주황색으로 바꿔 줘",
  "다크 모드 버튼 만들어 줘",
  "지도에 맛집 표시 추가해 줘",
  "점수가 저장되게 해 줘",
  "글씨를 조금 더 크게 해 줘",
];
const EXAMPLE_MS = 4000;

/** 파일 목록을 왼쪽 나무로: 맨 위 파일, 그다음 폴더별 파일. */
function fileTree(files: BuilderFile[]): { name: string; path: string; depth: number; folder: boolean }[] {
  const rows: { name: string; path: string; depth: number; folder: boolean }[] = [];
  const top = files.filter((file) => !file.path.includes("/"));
  const nested = files.filter((file) => file.path.includes("/"));
  for (const file of top) rows.push({ name: file.path, path: file.path, depth: 0, folder: false });
  const folders = Array.from(new Set(nested.map((file) => file.path.split("/")[0]))).sort();
  for (const folder of folders) {
    rows.push({ name: folder, path: folder, depth: 0, folder: true });
    for (const file of nested.filter((item) => item.path.startsWith(`${folder}/`))) {
      rows.push({ name: file.path.slice(folder.length + 1), path: file.path, depth: 1, folder: false });
    }
  }
  return rows;
}

export default function BuilderWorkspace({ projectId }: { projectId: string }) {
  const toast = useToast();
  // 참여하지 않는 분기에도 이 화면은 열립니다 — 내 작업물은 언제든 볼 수
  // 있어야 하니까요. 막히는 것은 바꾸는 쪽뿐입니다.
  const mayCreate = useMayCreate();

  const router = useRouter();

  const [state, setState] = useState<State>({ phase: "loading" });
  const [siblings, setSiblings] = useState<BuilderProject[]>([]);
  const [activeFile, setActiveFile] = useState(ENTRY_FILE);
  const [files, setFiles] = useState<BuilderFile[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const { refresh: refreshWallet } = useMyQuarter();
  const { reportCharge } = useSpendFeedback();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 말로 만들기 / 고치기 (builder-static-runtime).
  const { apps_base_url: appsBase } = useSite();
  const [ask, setAsk] = useState("");
  // 단계별 만들기(quality-tuning Q2): 끝나지 않은 작업, 진행, 계획 중.
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [planning, setPlanning] = useState(false);
  const [genRunning, setGenRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>(NO_PROGRESS);
  const generating = planning || genRunning;
  /** 마지막으로 보낸 요청 — 실패하면 "다시 시도"가 그대로 보냅니다. */
  const [lastInput, setLastInput] = useState<PlanInput | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateEstimate, setGenerateEstimate] = useState<GenerateEstimate | null>(null);
  const [thread, setThread] = useState<{ role: "member" | "claude"; text: string }[]>([]);
  const [versions, setVersions] = useState<BuilderVersion[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // ctrlaiapps-publish
  const [publishOpen, setPublishOpen] = useState(false);
  const [handoff, setHandoff] = useState<HandoffMode | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [previewWhich, setPreviewWhich] = useState<"draft" | "published">("draft");
  // 게시 직후 게시본의 썸네일을 찍을 숨은 프레임의 주소 (ui-improvements).
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  // owner-polish-3 (a2): the preview frame the 게시 dialog photographs its
  // candidates from, and the 게시 menu's 썸네일 바꾸기.
  const previewFrame = useRef<{ frame: HTMLIFrameElement | null; origin: string | null }>({ frame: null, origin: null });
  const onFrameReady = useCallback((frame: HTMLIFrameElement | null, origin: string | null) => {
    previewFrame.current = { frame, origin };
  }, []);
  const captureCandidate = useCallback(async (kind: CandidateKind): Promise<Blob> => {
    const { frame, origin } = previewFrame.current;
    if (!frame || !origin) throw new Error("미리보기가 아직 없어요.");
    if (kind === "first") return captureFrame(frame, origin, { width: 1280, height: 800 });
    if (kind === "scrolled") return captureFrame(frame, origin, { width: 1280, height: 800, offset: 600 });
    if (kind === "phone") return captureFrame(frame, origin, { width: 390, height: 844 });
    return captureFrame(frame, origin);
  }, []);
  const [thumbnailOpen, setThumbnailOpen] = useState(false);
  const [thumbnailBusy, setThumbnailBusy] = useState(false);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const saveChosenThumbnail = useCallback(
    async (image: Blob) => {
      setThumbnailBusy(true);
      setThumbnailError(null);
      try {
        const updated = await chooseThumbnail(projectId, await blobToDataUrl(image));
        setState({ phase: "ready", project: updated });
        setThumbnailOpen(false);
        toast.show("썸네일을 바꿨어요.");
      } catch (error) {
        setThumbnailError(describeError(error));
      } finally {
        setThumbnailBusy(false);
      }
    },
    [projectId, toast],
  );
  const [labelling, setLabelling] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  // 배치 (quality-tuning Q3). 넓은 화면에서는 접어 둔 판을 기억하고,
  // 좁은 화면에서는 서랍·시트가 닫힌 채로 시작합니다.
  const { github_enabled: githubEnabled } = useSite();
  const narrow = useMediaQuery(NARROW_QUERY);
  const filesHidden = usePref("files-hidden") === "1";
  const claudeHidden = usePref("claude-hidden") === "1";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  /** 이 버전 보기: 미리보기에 띄운 지난 버전의 파일. */
  const [viewing, setViewing] = useState<{ number: number; files: Record<string, string> } | null>(null);
  const [exampleIndex, setExampleIndex] = useState(0);
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ code: null, preview: null });

  // 마지막 탭은 프로젝트마다. 기억이 없으면 미리보기 — 초보 회원에게는
  // 코드보다 만든 결과가 먼저입니다.
  const savedTab = usePref(`tab.${projectId}`);
  const mode: Mode = savedTab === "code" ? "code" : "preview";

  const chooseMode = useCallback(
    (next: Mode) => writePref(`tab.${projectId}`, next),
    [projectId],
  );

  const filesShown = narrow ? drawerOpen : !filesHidden;
  const claudeShown = narrow ? sheetOpen : !claudeHidden;

  const showFiles = useCallback(
    (show: boolean) => {
      if (narrow) setDrawerOpen(show);
      else writePref("files-hidden", show ? "0" : "1");
    },
    [narrow],
  );

  const showClaude = useCallback(
    (show: boolean) => {
      if (narrow) {
        setSheetOpen(show);
        if (show) setDrawerOpen(false);
      } else {
        writePref("claude-hidden", show ? "0" : "1");
      }
    },
    [narrow],
  );

  // 서랍·시트는 Esc로 닫힙니다.
  useEffect(() => {
    if (!narrow || (!drawerOpen && !sheetOpen)) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDrawerOpen(false);
      setSheetOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [narrow, drawerOpen, sheetOpen]);

  // 입력칸의 예시가 몇 초마다 바뀝니다. 움직임을 줄인 설정이면 그대로 둡니다.
  useEffect(() => {
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = setInterval(() => setExampleIndex((n) => (n + 1) % ASK_EXAMPLES.length), EXAMPLE_MS);
    return () => clearInterval(timer);
  }, []);

  /** 이 버전 보기 — 지난 버전의 파일을 받아 미리보기에 띄웁니다(읽기만, 무료). */
  const viewVersion = useCallback(
    async (version: BuilderVersion) => {
      try {
        const list = await getVersionFiles(projectId, version.number);
        setViewing({ number: version.number, files: Object.fromEntries(list.map((f) => [f.path, f.content])) });
        chooseMode("preview");
        if (narrow) setSheetOpen(false);
      } catch (error) {
        toast.show(describeError(error));
      }
    },
    [projectId, chooseMode, narrow, toast],
  );

  // 효과가 두 번 도는 일은 흔합니다 — 개발 모드의 StrictMode가 그렇고,
  // 작업 공간을 빠르게 갈아타도 그렇습니다. 예전에는 뒷정리에서 "이
  // 실행은 밀려났다"고 표시하고 먼저 도착한 응답을 버렸는데, 뒤에 선
  // 요청이 끝내 도착하지 않으면 화면을 "불러오는 중"에서 꺼내 줄 것이
  // 아무것도 남지 않았습니다. Video 작업 공간에서 실제로 그렇게 멈췄고,
  // 같은 모양이 여기에도 있었습니다.
  //
  // 한 인스턴스가 보는 프로젝트는 처음부터 끝까지 하나이므로
  // (page.tsx가 projectId마다 다른 key를 줍니다) 도착한 응답을 그대로
  // 씁니다.
  useEffect(() => {
    getBuilderProject(projectId)
      .then((project) => setState({ phase: "ready", project }))
      .catch((error: unknown) => {
        // 이미 받아 둔 뒤라면 잘 보이던 화면을 오류로 덮지 않습니다.
        setState((current) =>
          current.phase === "ready"
            ? current
            : { phase: "error", message: describeError(error) },
        );
      });
  }, [projectId]);

  // 이 프로젝트의 파일. 비어 있으면 예시 앱을 만들 수 있으니 비용 어림도
  // 함께 받아 둡니다.
  useEffect(() => {
    listBuilderFiles(projectId)
      .then((list) => {
        setFiles(list);
        if (list.length > 0 && !list.some((file) => file.path === ENTRY_FILE)) {
          setActiveFile(list[0].path);
        }
      })
      .catch((error: unknown) => setFilesError(describeError(error)));
  }, [projectId]);

  // 버전 기록과 만들기 비용 어림. 실패해도 작업 공간은 그대로 씁니다.
  const loadVersions = useCallback(() => {
    listVersions(projectId)
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [projectId]);

  useEffect(() => {
    loadVersions();
    getGenerateEstimate(projectId)
      .then(setGenerateEstimate)
      .catch(() => setGenerateEstimate(null));
    // 중간에 멈춘 만들기가 있으면 이어서 만들기를 보여 줍니다.
    getOpenGeneration(projectId)
      .then(setGeneration)
      .catch(() => setGeneration(null));
  }, [projectId, loadVersions]);

  /**
   * Claude 판의 모델·생각 깊이(quality-tuning Q1). 프로젝트에 저장하고
   * 값을 다시 읽습니다 — 이름만 보내고 숫자는 서버가 정합니다.
   */
  const chooseBuildModel = useCallback(
    async (model: PickerModel, level: DepthLevel) => {
      setGenerateEstimate((current) =>
        current ? { ...current, chat_model_id: model.id, depth: level } : current,
      );
      try {
        await updateBuilderProject(projectId, { chat_model_id: model.id, depth: level });
        setGenerateEstimate(await getGenerateEstimate(projectId));
      } catch (error) {
        setGenerateError(describeError(error));
        getGenerateEstimate(projectId).then(setGenerateEstimate).catch(() => undefined);
      }
    },
    [projectId],
  );

  // 예시 앱을 만든 뒤에는 백엔드가 앱 주소에도 올렸으므로 프로젝트를 다시 읽습니다.
  const reloadProject = useCallback(() => {
    getBuilderProject(projectId)
      .then((project) => setState({ phase: "ready", project }))
      .catch(() => {
        /* 잘 보이던 화면을 그대로 둡니다 */
      });
  }, [projectId]);

  /** 만든 뒤(또는 멈춘 뒤) 파일·버전·프로젝트·지갑을 새로 읽습니다. */
  const reloadAfterRun = useCallback(() => {
    listBuilderFiles(projectId)
      .then(setFiles)
      .catch(() => undefined);
    loadVersions();
    reloadProject();
    void refreshWallet();
    getGenerateEstimate(projectId).then(setGenerateEstimate).catch(() => undefined);
  }, [projectId, loadVersions, reloadProject, refreshWallet]);

  /**
   * 시작 / 이어서 만들기 (quality-tuning Q2). 파일을 하나씩 쓰고, 다 쓴
   * 파일은 바로 저장됩니다. 멈추면 이유와 이어서 만들기가 남습니다.
   */
  const runPlan = useCallback(
    async (plan: Generation) => {
      setGenRunning(true);
      setGenerateError(null);
      setProgress(NO_PROGRESS);
      let spent = 0;
      try {
        const outcome = await runGeneration(projectId, plan.id, {
          onFileStart: (path) => setProgress((current) => ({ ...current, current: path })),
          onFileDone: (path, krw) => {
            spent += krw;
            setProgress((current) => ({
              ...current,
              current: null,
              charged: { ...current.charged, [path]: krw },
            }));
          },
          onCheckStart: () => setProgress((current) => ({ ...current, check: "running" })),
          onCheckDone: (fixed, summary, krw) => {
            spent += krw;
            setProgress((current) => ({ ...current, check: "done", checkFixed: fixed, checkSummary: summary }));
          },
        });
        if (outcome.kind === "done") {
          setGeneration(null);
          setAsk("");
          // 끝나면 새 버전을 미리보기로 — 앱 주소도 백엔드가 이미 다시 올렸습니다.
          setViewing(null);
          chooseMode("preview");
          // 방금 한 부탁과 Claude의 답은 이제 버전 기록(대화)에 있습니다.
          setThread([]);
          reportCharge({ chargedKrw: spent, label: plan.kind === "create" ? "빌더 · 만들기" : "빌더 · 고치기" });
        } else {
          const label = plan.kind === "create" ? "빌더 · 만들기" : "빌더 · 고치기";
          if (spent > 0) reportCharge({ chargedKrw: spent, label });
          const fresh = await getOpenGeneration(projectId).catch(() => null);
          setGeneration(
            fresh ?? {
              ...plan,
              status: "partial",
              error: outcome.detail,
            },
          );
        }
      } catch (error) {
        setGenerateError(describeError(error));
        getOpenGeneration(projectId).then(setGeneration).catch(() => undefined);
      } finally {
        setGenRunning(false);
        setProgress((current) => ({ ...current, current: null }));
        reloadAfterRun();
      }
    },
    [projectId, reportCharge, reloadAfterRun, chooseMode],
  );

  /** 계획 세우기. 고치기는 계획이 나오면 바로 시작합니다. */
  const makePlan = useCallback(
    async (input: PlanInput) => {
      setPlanning(true);
      setGenerateError(null);
      setLastInput(input);
      if (files !== null && files.length > 0) setThread((list) => [...list, { role: "member", text: input.request }]);
      try {
        const plan = await planGeneration(projectId, input);
        setGeneration(plan);
        void refreshWallet();
        reportCharge({ chargedKrw: plan.charged_krw, label: "빌더 · 계획" });
        if (plan.kind === "edit") {
          setPlanning(false);
          await runPlan(plan);
        }
      } catch (error) {
        setGenerateError(describeError(error));
      } finally {
        setPlanning(false);
      }
    },
    [projectId, refreshWallet, reportCharge, runPlan, files],
  );

  const dropPlan = useCallback(async () => {
    if (!generation) return;
    try {
      await cancelGeneration(projectId, generation.id);
    } catch {
      /* 이미 끝났거나 없어졌으면 그대로 비웁니다 */
    }
    setGeneration(null);
    setProgress(NO_PROGRESS);
  }, [generation, projectId]);

  // 게시 / 업데이트 게시 (ctrlaiapps-publish). 무료 — 고른 버전을 올릴 뿐.
  const publish = useCallback(
    async (values: PublishValues) => {
      setPublishing(true);
      setPublishError(null);
      try {
        const updated = await publishProject(projectId, {
          name: values.name,
          description: values.description,
          note: values.note,
          ...(values.ai_access ? { ai_access: values.ai_access } : {}),
        });
        setState({ phase: "ready", project: updated });
        setPublishOpen(false);
        listVersions(projectId).then(setVersions).catch(() => undefined);
        toast.show(`CtrlAIApps에 v${updated.published_version_number}을(를) 게시했어요.`);
        if (values.thumbnail) {
          // owner-polish-3 (a2): the picture the maker picked in the dialog.
          try {
            setState({ phase: "ready", project: await chooseThumbnail(projectId, await blobToDataUrl(values.thumbnail)) });
          } catch {
            /* 카드는 표지로 남고, 게시 메뉴의 썸네일 바꾸기가 있어요 */
          }
        } else {
          // No pick (or no preview to pick from): taken from the public address
          // in a hidden frame, in this browser (owner-polish 4).
          const publicAddress = publicUrl(updated, appsBase);
          if (publicAddress) setCaptureUrl(`${publicAddress}?v=${encodeURIComponent(updated.published_at ?? "")}`);
        }
      } catch (error) {
        setPublishError(describeError(error));
      } finally {
        setPublishing(false);
      }
    },
    [appsBase, projectId, toast],
  );

  /** 썸네일 하나 저장 — 미리보기가 보여 주는 쪽(작업 중 / 게시본)에. */
  const storeThumbnail = useCallback(
    async (image: Blob, manual: boolean, which: "draft" | "published" = previewWhich) => {
      const updated = await uploadThumbnail(projectId, which, image);
      setState((current) =>
        current.phase === "ready"
          ? {
              phase: "ready",
              project: {
                ...current.project,
                draft_thumbnail_at: updated.draft_thumbnail_at,
                published_thumbnail_at: updated.published_thumbnail_at,
              },
            }
          : current,
      );
      if (manual) toast.show("썸네일을 다시 찍었어요.");
    },
    [previewWhich, projectId, toast],
  );

  // app-ai-access: 게시 메뉴의 스위치 — 데모만 ↔ 전체 기능, 언제든.
  const askToSwitchAiAccess = useCallback(() => {
    if (state.phase !== "ready") return;
    const next = state.project.ai_access === "full" ? "demo" : "full";
    setDeleteError(null);
    setConfirm({
      title: next === "full" ? "AI 기능을 전체 기능으로 열기" : "AI 기능을 데모만으로",
      effect:
        next === "full"
          ? "로그인한 회원이 이 앱에서 AI 버튼을 누르면 자기 동아리 지원금에서 나가요. 방문자는 앱 맨 위 CTRL+AI 줄의 스위치로 언제든 데모로 볼 수 있어요."
          : "방문자에게는 데모 답변만 보여요. AI를 부르지 않고, 누구의 지원금도 나가지 않아요. 미리보기에서는 내가 계속 실제 AI를 쓸 수 있어요.",
      confirmLabel: next === "full" ? "전체 기능으로 열기" : "데모만으로",
      onConfirm: async () => {
        setDeleting(true);
        try {
          const updated = await setAiAccess(projectId, next);
          setState({ phase: "ready", project: updated });
          setConfirm(null);
          toast.show(next === "full" ? "AI 기능을 전체 기능으로 열었어요." : "AI 기능을 데모만으로 바꿨어요.");
        } catch (error) {
          setDeleteError(describeError(error));
        } finally {
          setDeleting(false);
        }
      },
    });
  }, [projectId, state, toast]);

  const askToUnpublish = useCallback(() => {
    setDeleteError(null);
    setConfirm({
      title: "게시 취소",
      effect:
        "CtrlAIApps 목록과 앱 주소에서 내려요. 만든 파일과 버전 기록은 모두 남고, 언제든 다시 게시할 수 있어요.",
      confirmLabel: "게시 취소",
      danger: true,
      onConfirm: async () => {
        setDeleting(true);
        try {
          const updated = await unpublishProject(projectId);
          setState({ phase: "ready", project: updated });
          setPreviewWhich("draft");
          listVersions(projectId).then(setVersions).catch(() => undefined);
          setConfirm(null);
          toast.show("게시를 취소했어요.");
        } catch (error) {
          setDeleteError(describeError(error));
        } finally {
          setDeleting(false);
        }
      },
    });
  }, [projectId, toast]);

  // 버전 저장: 이름 붙이기 / 고정하기.
  const saveVersionLabel = useCallback(
    async (version: BuilderVersion, change: { label?: string; pinned?: boolean }) => {
      try {
        const updated = await labelVersion(projectId, version.number, change);
        setVersions((list) => list.map((item) => (item.number === updated.number ? updated : item)));
      } catch (error) {
        toast.show(describeError(error));
      }
    },
    [projectId, toast],
  );

  // 확인 창은 스스로 닫히지 않습니다. 성공하면 닫고, 실패하면 창 안에 이유를.
  const restore = useCallback(
    async (number: number) => {
      setDeleting(true);
      setDeleteError(null);
      try {
        const result = await restoreVersion(projectId, number);
        setFiles(result.files);
        setState({ phase: "ready", project: result.project });
        setViewing(null);
        setVersions((list) => [result.version, ...list]);
        setConfirm(null);
        toast.show(`v${number}의 파일로 되돌렸어요. 되돌리기 전 상태도 버전으로 남아 있어요.`);
      } catch (error) {
        setDeleteError(describeError(error));
      } finally {
        setDeleting(false);
      }
    },
    [projectId, toast],
  );

  const askToRestore = useCallback(
    (version: BuilderVersion) => {
      setDeleteError(null);
      setConfirm({
        title: `v${version.number}${particleRo(version.number)} 되돌리기`,
        effect: `파일을 v${version.number} 때로 되돌립니다(${version.note}). 비용은 들지 않고, 지금 상태도 새 버전으로 남아 언제든 다시 돌아올 수 있어요.`,
        confirmLabel: "되돌리기",
        onConfirm: () => restore(version.number),
      });
    },
    [restore],
  );

  const refreshRuntime = useCallback(async () => {
    setRefreshing(true);
    setRuntimeError(null);
    try {
      const project = await refreshAppRuntime(projectId);
      setState({ phase: "ready", project });
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);

  // 전환 메뉴에 쓸 목록. 실패해도 작업 공간은 그대로 쓸 수 있어야 하므로
  // 조용히 넘어갑니다.
  useEffect(() => {
    listBuilderProjects()
      .then(setSiblings)
      .catch(() => {
        /* 전환 메뉴만 비어 있게 둡니다 */
      });
  }, []);

  // 이름을 바꿉니다. 거절 사유는 그대로 올려 보내 WorkspaceTitle이
  // 제목 옆에 보여 줍니다 — 백엔드가 이미 한국어 문장을 돌려줍니다.
  const rename = useCallback(
    async (name: string) => {
      const updated = await updateBuilderProject(projectId, { name });
      toast.show("이름을 바꿨어요.");
      setState({ phase: "ready", project: updated });
      // 건너가기 메뉴에도 새 이름이 보이도록.
      setSiblings((list) =>
        list.map((item) => (item.id === updated.id ? { ...item, name: updated.name } : item)),
      );
    },
    [toast, projectId],
  );

  // 지운 뒤에는 이 화면이 가리킬 것이 없으므로 목록으로 돌아갑니다.
  // `refresh`까지 부르는 것은 목록이 캐시된 채로 지워진 프로젝트를
  // 계속 보여 주지 않도록 하기 위해서입니다.
  //
  // 실패하면 창을 닫지 않고 그 안에 이유를 보여 줍니다 — 작업 공간에는
  // 달리 알릴 자리가 없습니다.
  const remove = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBuilderProject(projectId);
      toast.show("삭제했어요. 실수였다면 관리자가 되살릴 수 있어요.");
      router.push("/builder");
      router.refresh();
    } catch (error) {
      setDeleteError(describeError(error));
    } finally {
      setDeleting(false);
    }
  }, [toast, projectId, router]);

  const askToDelete = useCallback((name: string) => {
    setDeleteError(null);
    setConfirm({
      title: "프로젝트 삭제",
      effect: `'${name}' 프로젝트를 삭제합니다. 목록에서 사라지지만 관리자가 되살릴 수 있고, 지금까지 쓴 사용량 기록은 그대로 남습니다.`,
      confirmLabel: "삭제",
      danger: true,
      onConfirm: () => remove(),
    });
  }, [remove]);

  if (state.phase === "loading") {
    return (
      <div className={ws.shell}>
        <div className={ws.loading}>
          <Skeleton label="프로젝트를 불러오는 중…" />
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className={ws.shell}>
        <div className={ws.notFound}>
          <p className={ws.notFoundTitle}>프로젝트를 열 수 없습니다</p>
          <p className={ws.notFoundText}>
            {state.message}. 주소가 맞는지, 백엔드가 실행 중인지 확인해 주세요.
          </p>
          <Link className="btn btn-sm" href="/builder">
            ← 프로젝트 목록으로
          </Link>
        </div>
      </div>
    );
  }

  const { project } = state;
  const fileMap: Record<string, string> = Object.fromEntries(
    (files ?? []).map((file) => [file.path, file.content]),
  );
  const appFileList = (files ?? []).filter((file) => !isGuideDoc(file.path));
  const guideFileList = (files ?? []).filter((file) => isGuideDoc(file.path));
  const empty = files !== null && files.length === 0;
  const draftUrl = appUrl(project, appsBase);
  const publishedUrl = publicUrl(project, appsBase);
  const liveUrl = previewWhich === "published" && publishedUrl ? publishedUrl : draftUrl;
  const latestVersion = versions.length > 0 ? versions[0].number : null;
  /** owner-polish 13: at least one version Claude made (has a request). */
  const hasClaudeHistory = versions.some((version) => Boolean(version.request));
  const published = project.published_version_number ?? null;
  // 작업 중인 버전이 이미 게시된 버전이면 업데이트 게시는 할 일이 없습니다.
  const sameAsPublished = published !== null && latestVersion !== null && latestVersion === published;
  const guideOpen = guidesOpen || isGuideDoc(activeFile);

  const openFile = (path: string) => {
    setActiveFile(path);
    chooseMode("code");
    if (narrow) setDrawerOpen(false);
  };

  const fileButton = (path: string, name: string, depth: number) => (
    <li key={path}>
      <button
        className={`${styles.fileRow} ${mode === "code" && path === activeFile ? styles.fileRowActive : ""}`}
        style={{ paddingLeft: `${0.4 + depth * 0.75}rem` }}
        type="button"
        aria-current={mode === "code" && path === activeFile ? "true" : undefined}
        onClick={() => openFile(path)}
      >
        <span className={styles.fileGlyph} aria-hidden="true">
          ·
        </span>
        {name}
      </button>
    </li>
  );

  const openPublish = () => {
    setPublishError(null);
    setPublishOpen(true);
  };

  /** 탭은 ←→·Home·End로도 움직입니다. */
  const moveTab = (event: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: Mode =
      event.key === "Home" ? "code" : event.key === "End" ? "preview" : mode === "code" ? "preview" : "code";
    chooseMode(next);
    tabRefs.current[next]?.focus();
  };

  const versionSelect = latestVersion !== null && (
    <label className={styles.versionSelect}>
      <span className="sr-only">미리볼 버전</span>
      <select
        className={styles.versionSelectField}
        value={viewing ? `v${viewing.number}` : previewWhich}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "draft" || value === "published") {
            setViewing(null);
            setPreviewWhich(value);
          }
        }}
      >
        <option value="draft">작업 중 v{latestVersion}</option>
        {publishedUrl && published !== null && <option value="published">게시된 v{published}</option>}
        {viewing && <option value={`v${viewing.number}`}>v{viewing.number} 보는 중</option>}
      </select>
    </label>
  );

  const claudeOpener = !claudeShown && (
    <button
      className={styles.reopenButton}
      type="button"
      onClick={() => showClaude(true)}
      aria-label="Claude 판 열기"
      title="Claude 판 열기"
    >
      <MessageSquare size={14} aria-hidden="true" />
      Claude
    </button>
  );

  return (
    <div className={ws.shell}>
      {/* 위쪽 막대 — 낮게 유지하고, 프로젝트 이동은 여기에서 */}
      <div className={ws.topbar}>
        {/* Video Generator의 작업 공간과 같은 자리·같은 아이콘·같은 짜임. */}
        <Link className={ws.backLink} href="/builder">
          <ArrowLeft size={14} aria-hidden="true" />
          Project Builder
        </Link>
        <span className={ws.topbarDivider} aria-hidden="true" />

        <WorkspaceTitle
          currentId={project.id}
          emptyLabel="다른 프로젝트가 없습니다"
          lockedHint={NOT_PARTICIPATING_HINT}
          mayEdit={mayCreate}
          name={project.name}
          // 다운로드는 참여 여부와 무관합니다 — 내가 만든 것을 꺼내
          // 오는 일이고, 백엔드도 같은 이유로 열어 두었습니다.
          extraActions={[
            {
              label: "프로젝트 내려받기",
              onSelect: () => setHandoff("download"),
              title: "앱 파일과 안내(README · CLAUDE.md · 프롬프트)를 ZIP으로 받습니다",
            },
          ]}
          onDelete={() => askToDelete(project.name)}
          onRename={rename}
          siblings={siblings.map((item) => ({
            id: item.id,
            name: item.name,
            href: `/builder/${item.id}`,
            meta: BUILDER_STATUS_LABEL[item.status],
          }))}
        />

        <ProjectStatusBadge status={project.status} />
        {(published || latestVersion) && (
          <span className="badge badge-muted" data-testid="version-status">
            {sameAsPublished
              ? `게시됨 v${published} · 게시된 버전과 같아요`
              : [published ? `게시됨 v${published}` : null, latestVersion ? `작업 중 v${latestVersion}` : null]
                  .filter(Boolean)
                  .join(" · ")}
          </span>
        )}
        <TestModeNotice area="builder" />
        {/* GitHub은 Phase 4가 들어오기 전까지 보이지 않습니다 — 누를 수 없는 단추를 두지 않아요. */}
        {githubEnabled && (
          <span className="badge badge-muted">
            {project.github_repo ? `GitHub: ${project.github_repo}` : "GitHub 미연결"}
          </span>
        )}

        <span className={ws.topbarSpacer} />
        <span className={ws.topbarActions}>
          {/* 내보내기는 참여 여부와 무관합니다 — 내가 만든 것을 꺼내 오는
              일이고, 백엔드도 같은 이유로 열어 두었습니다. */}
          <MenuButton
            disabled={files === null}
            items={[
              {
                label: "내려받기",
                hint: "앱 파일과 안내 문서를 ZIP으로 받아요",
                onSelect: () => setHandoff("download"),
              },
              {
                label: "내 Claude로 이어서 만들기",
                hint: "claude.ai나 Claude Code에서 이어서 만드는 방법",
                onSelect: () => setHandoff("claude"),
              },
            ]}
          >
            내보내기 ▾
          </MenuButton>
          {published !== null && (
            <MenuButton
              className={`btn btn-sm ${styles.iconOnly}`}
              label="게시 메뉴 더 보기"
              title="더 보기"
              items={[
                // app-ai-access: offered for every published app — the
                // "uses AI" flag can miss an app that reaches ctrlai.ai
                // through an alias, and the server refuses visitors'
                // calls while the setting is 데모만 whatever the flag says.
                ...(project.published_uses_ai || project.ai_access === "full" || published !== null
                  ? [
                      {
                        label: project.ai_access === "full" ? "AI 기능: 전체 기능 → 데모만으로" : "AI 기능: 데모만 → 전체 기능으로 열기",
                        hint:
                          project.ai_access === "full"
                            ? "방문자의 AI 호출을 멈춰요 (0원). 데모 답변만 보여요."
                            : "로그인한 회원이 자기 지원금으로 이 앱의 AI를 쓸 수 있게 해요.",
                        onSelect: askToSwitchAiAccess,
                      },
                    ]
                  : []),
                {
                  label: "썸네일 바꾸기…",
                  hint: "미리보기에서 찍은 후보 가운데 고르거나 지금 화면을 찍어요",
                  onSelect: () => {
                    setThumbnailError(null);
                    setThumbnailOpen(true);
                  },
                },
                {
                  label: "게시 취소",
                  hint: "CtrlAIApps에서 내려요. 버전은 모두 남아요.",
                  danger: true,
                  onSelect: askToUnpublish,
                },
              ]}
            >
              <MoreHorizontal size={15} aria-hidden="true" />
            </MenuButton>
          )}
          {published !== null ? (
            <button
              className={`btn btn-sm btn-primary ${sameAsPublished ? styles.inactive : ""}`}
              type="button"
              // 같은 버전이면 눌러도 아무 일이 없다는 것을 말로 알려 줍니다.
              aria-disabled={sameAsPublished || undefined}
              onClick={() => {
                if (!sameAsPublished) openPublish();
              }}
              disabled={!mayCreate || empty}
              title={
                !mayCreate
                  ? NOT_PARTICIPATING_HINT
                  : sameAsPublished
                    ? "게시된 버전과 같아요. 고친 뒤에 업데이트 게시할 수 있어요."
                    : undefined
              }
            >
              업데이트 게시
            </button>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              type="button"
              onClick={openPublish}
              disabled={!mayCreate || empty || files === null}
              title={empty ? "앱을 먼저 만들어 주세요" : mayCreate ? undefined : NOT_PARTICIPATING_HINT}
            >
              CtrlAIApps에 게시
            </button>
          )}
        </span>
      </div>

      <NotParticipatingBanner inWorkspace />

      <div className={`${ws.body} ${styles.body}`}>
        {/* 좁은 화면: 서랍·시트 뒤를 누르면 닫힙니다. */}
        {narrow && (drawerOpen || sheetOpen) && (
          <button
            className={styles.scrim}
            type="button"
            aria-label="닫기"
            tabIndex={-1}
            onClick={() => {
              setDrawerOpen(false);
              setSheetOpen(false);
            }}
          />
        )}

        {/* 왼쪽 — 이 프로젝트의 파일만 */}
        {filesShown && (
          <aside
            className={`${ws.pane} ${styles.left} ${narrow ? styles.drawer : ""}`}
            aria-label="파일"
          >
            <div className={ws.paneHead}>
              <span className={ws.paneHeadTitle}>
                파일
                {files !== null && (
                  <span className="badge badge-muted" data-testid="file-count">
                    {`파일 ${appFileList.length}개`}
                    {guideFileList.length > 0 ? ` · 안내 문서 ${guideFileList.length}개` : ""}
                  </span>
                )}
              </span>
              <button
                className={styles.collapseButton}
                type="button"
                onClick={() => showFiles(false)}
                aria-label={narrow ? "파일 목록 닫기" : "파일 목록 접기"}
                title={narrow ? "파일 목록 닫기" : "파일 목록 접기"}
              >
                <ChevronsLeft size={15} aria-hidden="true" />
              </button>
            </div>
            <div className={ws.paneBody}>
              {filesError !== null && <p className={styles.hint}>파일을 불러오지 못했습니다. {filesError}.</p>}
              {empty && <p className={styles.hint}>아직 파일이 없어요. 가운데에서 앱을 만들 수 있어요.</p>}
              <ul className={styles.fileList}>
                {fileTree(appFileList).map((node) =>
                  node.folder ? (
                    <li key={`folder-${node.path}`}>
                      <span className={`${styles.fileRow} ${styles.folderRow}`}>
                        <span className={styles.fileGlyph} aria-hidden="true">
                          ▾
                        </span>
                        {node.name}
                      </span>
                    </li>
                  ) : (
                    fileButton(node.path, node.name, node.depth)
                  ),
                )}
              </ul>
              {guideFileList.length > 0 && (
                <div className={styles.guideFolder}>
                  <button
                    className={`${styles.fileRow} ${styles.folderButton}`}
                    type="button"
                    aria-expanded={guideOpen}
                    onClick={() => setGuidesOpen(!guideOpen)}
                    title="내 Claude가 읽을 안내 — 앱 주소에는 올라가지 않아요"
                  >
                    <span className={styles.fileGlyph} aria-hidden="true">
                      {guideOpen ? "▾" : "▸"}
                    </span>
                    안내 문서
                  </button>
                  {guideOpen && (
                    <ul className={styles.fileList} aria-label="안내 문서">
                      {guideFileList.map((file) => fileButton(file.path, file.path, 1))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* 가운데 — 코드 / 미리보기 */}
        <section className={`${ws.pane} ${ws.paneCenter} ${styles.center}`}>
          <div className={styles.modeTabs}>
            {!filesShown && (
              <button
                className={styles.reopenButton}
                type="button"
                onClick={() => showFiles(true)}
                aria-label="파일 목록 열기"
                title="파일 목록 열기"
              >
                <FolderOpen size={14} aria-hidden="true" />
                <span className={styles.reopenLabel}>파일</span>
              </button>
            )}
            {!empty && (
              <div className={styles.tabGroup} role="tablist" aria-label="보기">
                {(
                  [
                    ["code", "코드"],
                    ["preview", "미리보기"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    className={`${styles.modeTab} ${mode === value ? styles.modeTabActive : ""}`}
                    key={value}
                    ref={(node) => {
                      tabRefs.current[value] = node;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={mode === value}
                    tabIndex={mode === value ? 0 : -1}
                    onClick={() => chooseMode(value)}
                    onKeyDown={moveTab}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <span className={styles.modeSpacer} />
            {(mode === "code" || empty) && claudeOpener}
          </div>

          <div className={styles.centerBody}>
            {empty && (
              <div className={styles.starterArea}>
                {generation ? (
                  <PlanCard
                    generation={generation}
                    running={genRunning}
                    progress={progress}
                    disabled={!mayCreate || generating}
                    onStart={() => void runPlan(generation)}
                    onCancel={() => void dropPlan()}
                  />
                ) : (
                  <StartForm
                    initialIdea={project.description}
                    busy={planning}
                    disabled={!mayCreate}
                    error={generateError}
                    onPlan={(input) => void makePlan(input)}
                  />
                )}
                <p className={styles.limitsNote} data-testid="app-limits">
                  {APP_LIMITS_NOTE}
                </p>
              </div>
            )}

            {!empty && mode === "code" && files !== null && (
              <CodeView path={activeFile} content={fileMap[activeFile] ?? ""} />
            )}

            {!empty && mode === "preview" && (
              <div className={styles.previewSide}>
                {viewing && (
                  <p className={styles.viewingBanner} role="status">
                    v{viewing.number}을(를) 보는 중이에요 — 읽기만 하고, 파일은 바뀌지 않아요.
                    <button className="btn btn-sm" type="button" onClick={() => setViewing(null)}>
                      작업 중 버전으로
                    </button>
                  </p>
                )}
                <PreviewPane
                  files={viewing ? viewing.files : fileMap}
                  entry={ENTRY_FILE}
                  appUrl={viewing ? null : liveUrl}
                  runtimeAvailable={!viewing && Boolean(appsBase) && mayCreate}
                  onRefreshRuntime={() => void refreshRuntime()}
                  refreshing={refreshing}
                  stamp={
                    previewWhich === "published" && publishedUrl
                      ? (project.published_at ?? null)
                      : (project.app_runtime_at ?? null)
                  }
                  toolbarStart={versionSelect}
                  toolbarEnd={claudeOpener}
                  onCapture={mayCreate ? storeThumbnail : undefined}
                  onFrameReady={onFrameReady}
                />
                {captureUrl && (
                  <HiddenCapture
                    url={captureUrl}
                    onImage={(image) => storeThumbnail(image, false, "published")}
                    onDone={() => setCaptureUrl(null)}
                  />
                )}
                {runtimeError && (
                  <p className={styles.starterError} role="alert">
                    {runtimeError}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 오른쪽 — Claude: 바뀌어 온 대화, 고치기 */}
        {claudeShown && (
          <aside
            className={`${ws.pane} ${ws.paneLast} ${styles.right} ${narrow ? styles.sheet : ""}`}
            aria-label="Claude"
          >
          <div className={styles.rightInner}>
            <div className={ws.paneHead}>
              <span className={ws.paneHeadTitle}>Claude</span>
              <span className={styles.headTools}>
              {generateEstimate && (generateEstimate.models?.length ?? 0) > 0 ? (
                <ModelDepthPicker
                  name="빌더 모델"
                  placement="down"
                  align="end"
                  models={generateEstimate.models!.map(builderPickerModel)}
                  current={
                    generateEstimate.models!
                      .map(builderPickerModel)
                      .find((model) => model.id === generateEstimate.chat_model_id) ?? null
                  }
                  level={generateEstimate.depth ?? "medium"}
                  onChange={(model, level) => void chooseBuildModel(model, level)}
                  disabled={!mayCreate || generating}
                  footnote="금액은 이 프로젝트 크기로 어림한 값이에요. 실제로는 쓴 만큼만 차감되고, 괄호 안 금액을 넘지 않아요."
                />
              ) : (
                generateEstimate && (
                  <span className="badge badge-muted">{generateEstimate.model_label}</span>
                )
              )}
              <button
                className={styles.collapseButton}
                type="button"
                onClick={() => showClaude(false)}
                aria-label={narrow ? "Claude 판 닫기" : "Claude 판 접기"}
                title={narrow ? "Claude 판 닫기" : "Claude 판 접기"}
              >
                <ChevronsRight size={15} aria-hidden="true" />
              </button>
              </span>
            </div>
            <div className={ws.paneBody}>
              <div className={ws.chatThread}>
                {/* owner-polish 13: the conversation needs a Claude-made version
                    to be a conversation. A project whose versions all came from
                    예시 앱 / 가져오기 / 되돌리기 would show the same rows here and
                    in 모든 버전 — so until the first 만들기/고치기 only the list
                    below shows, opened. */}
                {hasClaudeHistory && (
                  <ClaudeHistory
                    versions={versions}
                    viewing={viewing?.number ?? null}
                    onView={(version) => void viewVersion(version)}
                    onRestore={askToRestore}
                    restoreDisabled={!mayCreate || generating}
                    restoreTitle={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                  />
                )}
                {thread.map((message, index) => (
                  <div
                    className={`${ws.chatMessage} ${
                      message.role === "member" ? ws.chatUser : ws.chatAssistant
                    }`}
                    key={index}
                  >
                    <span className={ws.chatRole}>{message.role === "member" ? "나" : "Claude"}</span>
                    {message.text}
                  </div>
                ))}
                {planning && (
                  <p className={styles.hint} role="status">
                    Claude가 바꿀 계획을 세우는 중이에요…
                  </p>
                )}
                {generation && !empty && (
                  <PlanCard
                    generation={generation}
                    running={genRunning}
                    progress={progress}
                    disabled={!mayCreate || generating}
                    onStart={() => void runPlan(generation)}
                    onCancel={() => void dropPlan()}
                  />
                )}
                {versions.length === 0 && thread.length === 0 && !generating && !generation && (
                  <p className={styles.hint}>
                    {empty
                      ? "가운데에서 만들고 싶은 앱을 알려 주면 Claude가 먼저 계획을 보여 줘요."
                      : "바꾸고 싶은 점을 아래에 적으면 Claude가 파일을 고쳐요. 바뀔 때마다 버전이 남아서 언제든 되돌릴 수 있어요."}
                  </p>
                )}
              </div>

              {versions.length > 0 && (
                <details className={styles.versions} open={!hasClaudeHistory || undefined} data-testid="all-versions">
                  <summary>모든 버전 ({versions.length})</summary>
                  <ul className={styles.versionList}>
                    {versions.map((version, index) => (
                      <li className={styles.versionRow} key={version.number}>
                        <span className={styles.versionNumber}>v{version.number}</span>
                        <span className={styles.versionNote} title={version.note}>
                          {version.label ? (
                            <strong className={styles.versionLabel}>{version.label}</strong>
                          ) : null}
                          {version.note || "변경"}
                          <span className={styles.versionMeta}>
                            {relativeTime(version.created_at)} · 파일 {version.file_count}개
                            {version.published ? " · 게시됨" : ""}
                          </span>
                        </span>
                        <button
                          className={`${styles.versionIcon} ${version.pinned ? styles.versionIconOn : ""}`}
                          type="button"
                          aria-pressed={Boolean(version.pinned)}
                          aria-label={`v${version.number} ${version.pinned ? "고정 풀기" : "고정하기"}`}
                          title={version.pinned ? "고정됨 — 30개를 넘어도 지워지지 않아요" : "고정하기"}
                          onClick={() => void saveVersionLabel(version, { pinned: !version.pinned })}
                          disabled={!mayCreate}
                        >
                          <Pin size={13} aria-hidden="true" />
                        </button>
                        <button
                          className={styles.versionIcon}
                          type="button"
                          aria-label={`v${version.number} 이름 붙이기`}
                          title="이름 붙이기"
                          onClick={() => {
                            setLabelling(version.number);
                            setLabelDraft(version.label ?? "");
                          }}
                          disabled={!mayCreate}
                        >
                          <Tag size={13} aria-hidden="true" />
                        </button>
                        {labelling === version.number && (
                          <form
                            className={styles.labelForm}
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveVersionLabel(version, { label: labelDraft });
                              setLabelling(null);
                            }}
                          >
                            <input
                              className="field"
                              aria-label={`v${version.number}에 붙일 이름`}
                              placeholder="예: 메모 기능 추가"
                              maxLength={80}
                              value={labelDraft}
                              autoFocus
                              onChange={(event) => setLabelDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") setLabelling(null);
                              }}
                            />
                            <button className="btn btn-sm" type="submit">
                              저장
                            </button>
                          </form>
                        )}
                        {index === 0 ? (
                          <span className="badge badge-muted">지금</span>
                        ) : (
                          <>
                            {!hasClaudeHistory && (
                              <button
                                className="btn btn-sm"
                                type="button"
                                aria-pressed={viewing?.number === version.number}
                                aria-label={`v${version.number} 이 버전 보기`}
                                onClick={() => void viewVersion(version)}
                              >
                                이 버전 보기
                              </button>
                            )}
                            <button
                              className="btn btn-sm"
                              type="button"
                              aria-label={`v${version.number}${particleRo(version.number)} 되돌리기`}
                              onClick={() => askToRestore(version)}
                              disabled={!mayCreate || generating}
                              title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                            >
                              되돌리기
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div className={ws.chatComposer}>
              <label className="sr-only" htmlFor="builder-ask">
                Claude에게 만들거나 고쳐 달라고 하기
              </label>
              <textarea
                className={`field ${styles.askField}`}
                id="builder-ask"
                rows={3}
                maxLength={2000}
                value={ask}
                onChange={(event) => setAsk(event.target.value)}
                onKeyDown={(event) => {
                  // Enter는 보내기, Shift+Enter는 줄 바꿈. 한글을 조합하는 중의
                  // Enter는 글자를 끝내는 것이라 보내지 않습니다.
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  if (mayCreate && !generating && !empty && ask.trim()) void makePlan({ request: ask.trim() });
                }}
                aria-describedby="builder-ask-keys"
                placeholder={
                  mayCreate
                    ? empty
                      ? "앱을 만든 뒤에 여기서 고쳐 달라고 할 수 있어요"
                      : `예: ${ASK_EXAMPLES[exampleIndex]}`
                    : "이번 분기에는 사용할 수 없습니다"
                }
                disabled={!mayCreate || generating || empty}
                data-working={generating || undefined}
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
              />
              <span className="sr-only" id="builder-ask-keys">
                Enter로 보내고, Shift+Enter로 줄을 바꿔요.
              </span>
              <div className={styles.askActions}>
                {/* owner-polish 14: while working the button is busy, not
                    disabled — disabled gives the 🚫 cursor; busy gives
                    cursor: progress and a spinner. */}
                <button
                  className={`btn btn-primary btn-sm ${generating ? "btn-working" : ""}`}
                  type="button"
                  onClick={() => {
                    if (generating) return;
                    void makePlan({ request: ask.trim() });
                  }}
                  aria-disabled={generating || undefined}
                  aria-busy={generating || undefined}
                  disabled={!generating && (!mayCreate || empty || !ask.trim())}
                >
                  {generating ? (
                    <>
                      <Loader2 size={14} className="spin" aria-hidden="true" /> 만드는 중…
                    </>
                  ) : (
                    "고치기"
                  )}
                </button>
                {generateEstimate && (
                  <span className={styles.starterCost}>
                    약 {formatKrw(generateEstimate.estimated_krw)} · 최대{" "}
                    {formatKrw(generateEstimate.worst_case_krw)}
                  </span>
                )}
              </div>
              {mayCreate && generateEstimate && (
                <WalletCheck costKrw={generateEstimate.worst_case_krw} />
              )}
              {generateError && !empty && (
                <p className={styles.starterError} role="alert">
                  {generateError}{" "}
                  {lastInput && (
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => void makePlan(lastInput)}
                      disabled={!mayCreate || generating}
                    >
                      다시 시도
                    </button>
                  )}
                </p>
              )}
              {!mayCreate && (
                <p className={styles.hint}>
                  <Lock size={11} aria-hidden="true" /> 이번 분기에 참여하지 않아 사용할 수 없습니다.
                </p>
              )}
            </div>
          </div>
          </aside>
        )}
      </div>

      {handoff && (
        <HandoffSheet projectId={project.id} mode={handoff} onClose={() => setHandoff(null)} />
      )}

      {publishOpen && (
        <PublishDialog
          projectId={project.id}
          publishedVersion={project.published_version_number ?? null}
          nextVersion={latestVersion}
          initial={{
            name: project.name,
            description: project.description,
            note: "",
          }}
          initialAiAccess={project.ai_access ?? "demo"}
          captureThumbnail={captureCandidate}
          busy={publishing}
          error={publishError}
          onClose={() => setPublishOpen(false)}
          onConfirm={(values) => void publish(values)}
        />
      )}

      {thumbnailOpen && (
        <ThumbnailDialog
          capture={captureCandidate}
          busy={thumbnailBusy}
          error={thumbnailError}
          onClose={() => setThumbnailOpen(false)}
          onConfirm={(image) => void saveChosenThumbnail(image)}
        />
      )}

      <ConfirmDialog
        busy={deleting}
        error={deleteError}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
