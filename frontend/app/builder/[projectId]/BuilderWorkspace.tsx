"use client";

/**
 * Project Builder 작업 공간 — 프로젝트 하나.
 *
 * 구성: 왼쪽에 이 프로젝트의 파일만, 가운데에 코드와 미리보기,
 * 오른쪽에 Claude. 프로젝트 목록은 더 이상 왼쪽을 차지하지 않고,
 * 위쪽 막대의 전환 메뉴로 옮겼습니다.
 *
 * 프로젝트 정보와 파일은 백엔드에서 가져옵니다. 빈 프로젝트에서는 Claude가
 * 작은 예시 앱(HTML·CSS·JS)을 만들어 줄 수 있고(chat-builder-starter), 만든
 * 앱은 미리보기의 샌드박스 iframe 안에서만 돌아갑니다. 파일은 아직 읽기만
 * 하고, Claude와 대화하며 고치기와 GitHub 연동은 다음 단계입니다.
 */

import { ArrowLeft, Lock } from "lucide-react";
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
  builderProjectDownloadUrl,
  createStarterApp,
  deleteBuilderProject,
  describeError,
  getBuilderProject,
  getStarterEstimate,
  listBuilderFiles,
  listBuilderProjects,
  updateBuilderProject,
  type BuilderFile,
  type BuilderProject,
  type StarterEstimate,
} from "@/lib/projects";
import ProjectStatusBadge from "@/app/components/ProjectStatusBadge";
import WalletCheck from "@/app/components/WalletCheck";
import { useMyQuarter } from "@/app/components/MyQuarterProvider";
import { NOT_PARTICIPATING_HINT, formatKrw } from "@/lib/quarters";

import PreviewPane from "./PreviewPane";
import styles from "./workspace.module.css";

type Mode = "code" | "preview" | "split";

type State =
  | { phase: "loading" }
  | { phase: "ready"; project: BuilderProject }
  | { phase: "error"; message: string };

const ENTRY_FILE = "index.html";

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
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
        void refreshWallet();
      } catch (error) {
        setStarterError(describeError(error));
      } finally {
        setStarting(false);
      }
    },
    [projectId, refreshWallet],
  );

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
      setState({ phase: "ready", project: updated });
      // 건너가기 메뉴에도 새 이름이 보이도록.
      setSiblings((list) =>
        list.map((item) => (item.id === updated.id ? { ...item, name: updated.name } : item)),
      );
    },
    [projectId],
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
      router.push("/builder");
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
          <p className="muted">프로젝트를 불러오는 중…</p>
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
              label: "코드 다운로드 (ZIP)",
              href: builderProjectDownloadUrl(project.id),
              title: "프로젝트 파일을 압축 파일로 받습니다",
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
        <span className="badge badge-muted">
          {project.github_repo ? `GitHub: ${project.github_repo}` : "GitHub 미연결"}
        </span>

        <span className={ws.topbarSpacer} />
        <span className={ws.topbarActions}>
          <button className="btn btn-sm" type="button" disabled title="Phase 5에서 제공됩니다">
            GitHub에 저장
          </button>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            disabled
            title="Phase 5에서 제공됩니다"
          >
            CtrlAIApps에 게시
          </button>
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
                <PreviewPane files={fileMap} entry={ENTRY_FILE} />
              </div>
            )}
          </div>
        </section>

        {/* 오른쪽 — Claude */}
        <aside className={`${ws.pane} ${ws.paneLast} ${styles.right}`}>
          <div className={styles.rightInner}>
            <div className={ws.paneHead}>
              <span className={ws.paneHeadTitle}>Claude</span>
              <span className="badge badge-mock">고치기는 준비 중</span>
            </div>
            <div className={ws.paneBody}>
              <div className={ws.chatThread}>
                {summary ? (
                  <div className={`${ws.chatMessage} ${ws.chatAssistant}`}>
                    <span className={ws.chatRole}>Claude</span>
                    {summary}
                  </div>
                ) : (
                  <p className={styles.hint}>
                    {empty
                      ? "가운데에서 예시 앱을 만들면 Claude가 무엇을 만들었는지 여기에서 알려 줘요."
                      : "Claude에게 말로 고쳐 달라고 하는 기능은 다음 단계에서 열립니다. 지금은 파일을 보고, 미리보기에서 눌러 보고, ZIP으로 받을 수 있어요."}
                  </p>
                )}
              </div>
            </div>
            <div className={ws.chatComposer}>
              <input
                className="field"
                type="text"
                placeholder={mayCreate ? "무엇을 바꿀까요? (다음 단계)" : "이번 분기에는 사용할 수 없습니다"}
                disabled
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                aria-label={
                  mayCreate
                    ? "Claude에게 고쳐 달라고 하기 (다음 단계에서 제공됩니다)"
                    : "이번 분기에는 사용할 수 없습니다"
                }
              />
              {/* 막힌 이유가 둘일 수 있습니다. 어느 쪽인지 알려 주지 않으면
                  회원은 분기에 참여하면 풀린다고 오해합니다. */}
              <p className={styles.hint}>
                {mayCreate ? (
                  <>예: &ldquo;이번 주 달성률을 보여주는 그래프를 추가해줘.&rdquo;</>
                ) : (
                  <>
                    <Lock size={11} aria-hidden="true" /> 이번 분기에 참여하지 않아 사용할 수
                    없습니다.
                  </>
                )}
              </p>
            </div>
          </div>
        </aside>
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
