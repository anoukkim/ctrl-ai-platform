"use client";

/**
 * Project Builder 작업 공간 — 프로젝트 하나.
 *
 * 구성: 왼쪽에 이 프로젝트의 파일만, 가운데에 코드와 미리보기,
 * 오른쪽에 Claude. 프로젝트 목록은 더 이상 왼쪽을 차지하지 않고,
 * 위쪽 막대의 전환 메뉴로 옮겼습니다.
 *
 * 프로젝트 정보와 파일은 백엔드에서 가져옵니다. 빈 프로젝트에서는 Claude가
 * 작은 예시 앱(HTML·CSS·JS)을 만들어 줄 수 있고(chat-builder-starter),
 * 오른쪽에서 말로 만들고 고칠 수 있습니다(builder-static-runtime). 바뀔
 * 때마다 버전이 남아 되돌릴 수 있고, 앱은 앱 주소(apps.ctrlai.my)에 올라가
 * 미리보기 프레임 안에서 돌아갑니다. GitHub 연동은 다음 단계입니다.
 */

import { ArrowLeft, Lock, Pin, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useMayCreate } from "@/app/components/MyQuarterProvider";
import NotParticipatingBanner from "@/app/components/NotParticipatingBanner";
import WorkspaceTitle from "@/app/components/WorkspaceTitle";
import ws from "@/app/components/workspace.module.css";
import {
  BUILDER_STATUS_LABEL,
  createStarterApp,
  deleteBuilderProject,
  appUrl,
  describeError,
  APP_LIMITS_NOTE,
  STYLE_CHOICES,
  generateProject,
  labelVersion,
  publicUrl,
  publishProject,
  unpublishProject,
  getBuilderProject,
  getGenerateEstimate,
  getStarterEstimate,
  listBuilderFiles,
  listBuilderProjects,
  listVersions,
  refreshAppRuntime,
  restoreVersion,
  updateBuilderProject,
  type BuilderFile,
  type BuilderProject,
  type BuilderVersion,
  type GenerateEstimate,
  type StarterEstimate,
} from "@/lib/projects";
import { useSite } from "@/app/components/SiteProvider";
import { relativeTime } from "@/lib/relative-time";
import ProjectStatusBadge from "@/app/components/ProjectStatusBadge";
import WalletCheck from "@/app/components/WalletCheck";
import TestModeNotice from "@/app/components/TestModeNotice";
import { useMyQuarter } from "@/app/components/MyQuarterProvider";
import { useSpendFeedback } from "@/app/components/SpendFeedbackProvider";
import { NOT_PARTICIPATING_HINT, formatKrw } from "@/lib/quarters";

import PreviewPane from "./PreviewPane";
import HandoffSheet, { type HandoffMode } from "./HandoffSheet";
import PublishDialog, { type PublishValues } from "./PublishDialog";
import styles from "./workspace.module.css";
import Skeleton from "@/app/components/Skeleton";
import { useToast } from "@/app/components/ToastProvider";

type Mode = "code" | "preview" | "split";

type State =
  | { phase: "loading" }
  | { phase: "ready"; project: BuilderProject }
  | { phase: "error"; message: string };

const ENTRY_FILE = "index.html";

/** 숫자 뒤의 "로/으로": 삼으로, 이로, 칠로 (백엔드 버전 메모와 같은 규칙). */
function particleRo(n: number): string {
  return [0, 3, 6].includes(n % 10) ? "으로" : "로";
}

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

/**
 * 코드에 색을 입힙니다 — 화면용 장식일 뿐, 코드를 바꾸지 않습니다.
 *
 * 문법을 제대로 읽는 편집기(Monaco)는 Phase 3 이후입니다. 그때까지는
 * 예약어, 문자열, JSX 태그, 주석 네 가지만 색으로 구분합니다. 색은
 * 토큰(--code-keyword, --code-string, --accent)이라 밝은 테마에서도
 * 읽힙니다.
 */
const TOKEN_PATTERN =
  /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(<\/?[A-Za-z][\w.]*)|\b(import|from|export|default|function|const|let|var|return|if|else|type|interface|async|await|new|extends)\b/g;

function highlight(code: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(code.slice(last, start));
    const className = match[1]
      ? styles.tokComment
      : match[2]
        ? styles.tokString
        : match[3]
          ? styles.tokTag
          : styles.tokKeyword;
    nodes.push(
      <span className={className} key={start}>
        {match[0]}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < code.length) nodes.push(code.slice(last));
  return nodes;
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
  // 만든 앱을 먼저 보여 줍니다 — 초보 회원에게는 코드보다 결과가 먼저입니다.
  const [mode, setMode] = useState<Mode>("preview");
  const [files, setFiles] = useState<BuilderFile[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<StarterEstimate | null>(null);
  const [starterIdea, setStarterIdea] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const { refresh: refreshWallet } = useMyQuarter();
  const { reportCharge } = useSpendFeedback();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 말로 만들기 / 고치기 (builder-static-runtime).
  const { apps_base_url: appsBase } = useSite();
  const [ask, setAsk] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateEstimate, setGenerateEstimate] = useState<GenerateEstimate | null>(null);
  const [thread, setThread] = useState<{ role: "member" | "claude"; text: string }[]>([]);
  const [versions, setVersions] = useState<BuilderVersion[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // ctrlaiapps-publish
  const [style, setStyle] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [handoff, setHandoff] = useState<HandoffMode | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [previewWhich, setPreviewWhich] = useState<"draft" | "published">("draft");
  const [labelling, setLabelling] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

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
        if (list.length === 0) {
          getStarterEstimate().then(setEstimate).catch(() => setEstimate(null));
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
  }, [projectId, loadVersions]);

  // 예시 앱을 만든 뒤에는 백엔드가 앱 주소에도 올렸으므로 프로젝트를 다시 읽습니다.
  const reloadProject = useCallback(() => {
    getBuilderProject(projectId)
      .then((project) => setState({ phase: "ready", project }))
      .catch(() => {
        /* 잘 보이던 화면을 그대로 둡니다 */
      });
  }, [projectId]);

  const makeStarter = useCallback(
    async (idea: string) => {
      setStarting(true);
      setStarterError(null);
      try {
        const result = await createStarterApp(projectId, idea);
        setFiles(result.files);
        setActiveFile(ENTRY_FILE);
        setSummary(result.summary);
        setMode("preview");
        loadVersions();
        reloadProject();
        void refreshWallet();
        reportCharge({ chargedKrw: result.charged_krw, label: "빌더 · 앱 만들기" });
      } catch (error) {
        setStarterError(describeError(error));
      } finally {
        setStarting(false);
      }
    },
    [projectId, refreshWallet, reportCharge, loadVersions, reloadProject],
  );

  const runGenerate = useCallback(async () => {
    const text = ask.trim();
    if (!text) return;
    setGenerating(true);
    setGenerateError(null);
    setThread((list) => [...list, { role: "member", text }]);
    try {
      const result = await generateProject(projectId, text, style);
      setAsk("");
      setFiles(result.files);
      setState({ phase: "ready", project: result.project });
      setVersions((list) => [result.version, ...list.filter((v) => v.number !== result.version.number)]);
      setThread((list) => [...list, { role: "claude", text: result.summary }]);
      if (result.changed.length > 0 && mode !== "preview") setActiveFile(result.changed[0]);
      void refreshWallet();
      reportCharge({ chargedKrw: result.charged_krw, label: "빌더 · 고치기" });
      getGenerateEstimate(projectId).then(setGenerateEstimate).catch(() => undefined);
    } catch (error) {
      setGenerateError(describeError(error));
    } finally {
      setGenerating(false);
    }
  }, [ask, projectId, mode, refreshWallet, reportCharge, style]);

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
        });
        setState({ phase: "ready", project: updated });
        setPublishOpen(false);
        listVersions(projectId).then(setVersions).catch(() => undefined);
        toast.show(`CtrlAIApps에 v${updated.published_version_number}을(를) 게시했어요.`);
      } catch (error) {
        setPublishError(describeError(error));
      } finally {
        setPublishing(false);
      }
    },
    [projectId, toast],
  );

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
  const code = fileMap[activeFile] ?? "";
  const lineCount = code.split("\n").length;
  const empty = files !== null && files.length === 0;
  const idea = starterIdea ?? project.description;
  const showCode = mode === "code" || mode === "split";
  const showPreview = mode === "preview" || mode === "split";
  const draftUrl = appUrl(project, appsBase);
  const publishedUrl = publicUrl(project, appsBase);
  const liveUrl = previewWhich === "published" && publishedUrl ? publishedUrl : draftUrl;
  const latestVersion = versions.length > 0 ? versions[0].number : null;

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
        {(project.published_version_number || latestVersion) && (
          <span className="badge badge-muted" data-testid="version-status">
            {[
              project.published_version_number ? `게시됨 v${project.published_version_number}` : null,
              latestVersion ? `작업 중 v${latestVersion}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        <TestModeNotice area="builder" />
        <span className="badge badge-muted">
          {project.github_repo ? `GitHub: ${project.github_repo}` : "GitHub 미연결"}
        </span>

        <span className={ws.topbarSpacer} />
        <span className={ws.topbarActions}>
          {/* 내려받기는 참여 여부와 무관합니다 — 내가 만든 것을 꺼내 오는
              일이고, 백엔드도 같은 이유로 열어 두었습니다. */}
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => setHandoff("download")}
            disabled={files === null}
            title="앱 파일과 안내를 ZIP으로 받습니다"
          >
            내려받기
          </button>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => setHandoff("claude")}
            disabled={files === null}
            title="claude.ai나 Claude Code에서 이어서 만드는 방법"
          >
            내 Claude로 이어서 만들기
          </button>
          <button className="btn btn-sm" type="button" disabled title="Phase 5에서 제공됩니다">
            GitHub에 저장
          </button>
          {project.published_version_number ? (
            <>
              <button
                className="btn btn-sm"
                type="button"
                onClick={askToUnpublish}
                title="CtrlAIApps에서 내립니다. 버전은 모두 남아요."
              >
                게시 취소
              </button>
              <button
                className="btn btn-sm btn-primary"
                type="button"
                onClick={() => {
                  setPublishError(null);
                  setPublishOpen(true);
                }}
                disabled={!mayCreate || empty}
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
              >
                업데이트 게시
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              type="button"
              onClick={() => {
                setPublishError(null);
                setPublishOpen(true);
              }}
              disabled={!mayCreate || empty || files === null}
              title={empty ? "앱을 먼저 만들어 주세요" : mayCreate ? undefined : NOT_PARTICIPATING_HINT}
            >
              CtrlAIApps에 게시
            </button>
          )}
        </span>
      </div>

      <NotParticipatingBanner inWorkspace />

      <div className={ws.body}>
        {/* 왼쪽 — 이 프로젝트의 파일만 */}
        <aside className={`${ws.pane} ${styles.left}`}>
          <div className={ws.paneHead}>
            <span className={ws.paneHeadTitle}>파일</span>
            {files !== null && <span className="badge badge-muted">{files.length}개</span>}
          </div>
          <div className={ws.paneBody}>
            {filesError !== null && <p className={styles.hint}>파일을 불러오지 못했습니다. {filesError}.</p>}
            {empty && <p className={styles.hint}>아직 파일이 없어요. 가운데에서 예시 앱을 만들 수 있어요.</p>}
            <ul className={styles.fileList}>
              {fileTree(files ?? []).map((node) => {
                const isFolder = node.folder;
                const isActive = !isFolder && node.path === activeFile;

                return (
                  <li key={`${node.depth}-${node.path}`}>
                    <button
                      className={`${styles.fileRow} ${isActive ? styles.fileRowActive : ""} ${
                        isFolder ? styles.folderRow : ""
                      }`}
                      style={{ paddingLeft: `${0.4 + node.depth * 0.75}rem` }}
                      type="button"
                      onClick={() => {
                        if (isFolder) return;
                        setActiveFile(node.path);
                        if (mode === "preview") setMode("split");
                      }}
                      disabled={isFolder}
                    >
                      <span className={styles.fileGlyph} aria-hidden="true">
                        {isFolder ? "▾" : "·"}
                      </span>
                      {node.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* 가운데 — 코드 / 미리보기 */}
        <section className={`${ws.pane} ${ws.paneCenter} ${styles.center}`}>
          <div className={styles.modeTabs} role="tablist" aria-label="작업 모드">
            {(
              [
                ["code", "코드"],
                ["preview", "미리보기"],
                ["split", "나란히"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={`${styles.modeTab} ${mode === value ? styles.modeTabActive : ""}`}
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
            <span className={styles.modeSpacer} />
            <span className={styles.splitToggle}>{project.name}</span>
          </div>

          <div className={styles.centerBody}>
            {empty && (
              <div className={styles.starter}>
                <p className={styles.starterTitle}>예시 앱부터 만들어 볼까요?</p>
                <p className={styles.starterText}>
                  만들고 싶은 것을 적으면 Claude가 바로 실행해 볼 수 있는 작은 앱(HTML · CSS ·
                  JavaScript)을 만들어 줍니다. 만든 뒤에는 파일을 보고, 미리보기에서 눌러 볼 수
                  있어요.
                </p>
                <label className="sr-only" htmlFor="starter-idea">
                  만들고 싶은 앱
                </label>
                <textarea
                  className={`field ${styles.starterIdea}`}
                  id="starter-idea"
                  value={idea}
                  maxLength={2000}
                  rows={3}
                  placeholder="예: 한 달 지출을 적고 항목별로 합계를 보여 주는 가계부"
                  onChange={(event) => setStarterIdea(event.target.value)}
                  disabled={!mayCreate || starting}
                />
                <div className={styles.starterActions}>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void makeStarter(idea)}
                    disabled={!mayCreate || starting || !idea.trim()}
                    title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                  >
                    {starting ? "예시 앱을 만드는 중… (보통 30초~1분)" : "예시 앱 만들기"}
                  </button>
                  {estimate && (
                    <span className={styles.starterCost}>
                      약 {formatKrw(estimate.estimated_krw)} · 최대 {formatKrw(estimate.worst_case_krw)}
                    </span>
                  )}
                </div>
                {mayCreate && estimate && <WalletCheck costKrw={estimate.worst_case_krw} />}
                <p className={styles.limitsNote} data-testid="app-limits">
                  {APP_LIMITS_NOTE}
                </p>
                {starterError && (
                  <p className={styles.starterError} role="alert">
                    {starterError}
                  </p>
                )}
              </div>
            )}

            {!empty && showCode && (
              <div className={styles.codeSide}>
                <div className={styles.tabs}>
                  <span className={`${styles.tab} ${styles.tabActive}`}>{activeFile}</span>
                </div>
                <div className={styles.codeScroll}>
                  <pre className={styles.code}>
                    <span className={styles.gutter} aria-hidden="true">
                      {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
                    </span>
                    <code className={styles.codeText}>{highlight(code)}</code>
                  </pre>
                </div>
              </div>
            )}

            {!empty && showPreview && (
              <div className={styles.previewSide}>
                {publishedUrl && (
                  <div className={styles.previewWhich} role="group" aria-label="미리볼 버전">
                    {(
                      [
                        ["draft", `작업 중 버전${latestVersion ? ` (v${latestVersion})` : ""}`],
                        ["published", `게시된 버전 (v${project.published_version_number})`],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`${styles.modeTab} ${previewWhich === value ? styles.modeTabActive : ""}`}
                        aria-pressed={previewWhich === value}
                        onClick={() => setPreviewWhich(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <PreviewPane
                  files={fileMap}
                  entry={ENTRY_FILE}
                  appUrl={liveUrl}
                  runtimeAvailable={Boolean(appsBase) && mayCreate}
                  onRefreshRuntime={() => void refreshRuntime()}
                  refreshing={refreshing}
                  stamp={
                    previewWhich === "published" && publishedUrl
                      ? (project.published_at ?? null)
                      : (project.app_runtime_at ?? null)
                  }
                />
                {runtimeError && (
                  <p className={styles.starterError} role="alert">
                    {runtimeError}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 오른쪽 — Claude: 말로 만들기 / 고치기, 버전 기록 */}
        <aside className={`${ws.pane} ${ws.paneLast} ${styles.right}`}>
          <div className={styles.rightInner}>
            <div className={ws.paneHead}>
              <span className={ws.paneHeadTitle}>Claude</span>
              {generateEstimate && (
                <span className="badge badge-muted">{generateEstimate.model_label}</span>
              )}
            </div>
            <div className={ws.paneBody}>
              <div className={ws.chatThread}>
                {summary && (
                  <div className={`${ws.chatMessage} ${ws.chatAssistant}`}>
                    <span className={ws.chatRole}>Claude</span>
                    {summary}
                  </div>
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
                {generating && (
                  <p className={styles.hint} role="status">
                    Claude가 파일을 쓰는 중이에요… (보통 30초~2분)
                  </p>
                )}
                {!summary && thread.length === 0 && !generating && (
                  <p className={styles.hint}>
                    {empty
                      ? "만들고 싶은 앱을 아래에 적거나, 가운데에서 예시 앱부터 만들어 보세요."
                      : "바꾸고 싶은 점을 아래에 적으면 Claude가 파일을 고쳐요. 바뀔 때마다 버전이 남아서 언제든 되돌릴 수 있어요."}
                  </p>
                )}
              </div>

              {versions.length > 0 && (
                <details className={styles.versions}>
                  <summary>버전 기록 ({versions.length})</summary>
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
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => askToRestore(version)}
                            disabled={!mayCreate || generating}
                            title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                          >
                            되돌리기
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div className={ws.chatComposer}>
              {empty && (
                <div className={styles.styleRow}>
                  <label htmlFor="builder-style">스타일</label>
                  <select
                    id="builder-style"
                    className="field"
                    value={STYLE_CHOICES.includes(style as (typeof STYLE_CHOICES)[number]) || style === "" ? style : "__custom"}
                    onChange={(event) =>
                      setStyle(event.target.value === "__custom" ? " " : event.target.value)
                    }
                    disabled={!mayCreate || generating}
                  >
                    <option value="">아이디어에 맞게</option>
                    {STYLE_CHOICES.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                    <option value="__custom">직접 적기</option>
                  </select>
                  {style !== "" && !STYLE_CHOICES.includes(style as (typeof STYLE_CHOICES)[number]) && (
                    <input
                      className="field"
                      aria-label="원하는 스타일 직접 적기"
                      placeholder="예: 파스텔 톤의 다이어리 느낌"
                      maxLength={100}
                      value={style.trimStart()}
                      onChange={(event) => setStyle(event.target.value || " ")}
                    />
                  )}
                </div>
              )}
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
                placeholder={
                  mayCreate
                    ? empty
                      ? "예: 한 달 지출을 적는 가계부를 만들어 줘"
                      : "예: 버튼 색을 주황색으로 바꿔 줘"
                    : "이번 분기에는 사용할 수 없습니다"
                }
                disabled={!mayCreate || generating}
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
              />
              <div className={styles.askActions}>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => void runGenerate()}
                  disabled={!mayCreate || generating || !ask.trim()}
                >
                  {generating ? "만드는 중…" : empty ? "만들기" : "고치기"}
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
              {generateError && (
                <p className={styles.starterError} role="alert">
                  {generateError}
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
      </div>

      {handoff && (
        <HandoffSheet projectId={project.id} mode={handoff} onClose={() => setHandoff(null)} />
      )}

      {publishOpen && (
        <PublishDialog
          publishedVersion={project.published_version_number ?? null}
          nextVersion={latestVersion}
          initial={{
            name: project.name,
            description: project.description,
            note: "",
          }}
          busy={publishing}
          error={publishError}
          onClose={() => setPublishOpen(false)}
          onConfirm={(values) => void publish(values)}
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
