"use client";

/**
 * Project Builder 작업 공간 — 프로젝트 하나.
 *
 * 구성: 왼쪽에 이 프로젝트의 파일만, 가운데에 코드와 미리보기,
 * 오른쪽에 Claude. 프로젝트 목록은 더 이상 왼쪽을 차지하지 않고,
 * 위쪽 막대의 전환 메뉴로 옮겼습니다.
 *
 * 프로젝트 정보는 백엔드에서 가져옵니다. 파일과 Claude 대화는 아직
 * 예시입니다. 코드 생성은 Phase 4, GitHub 연동은 Phase 5입니다.
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
  BUILDER_STATUS_BADGE,
  BUILDER_STATUS_LABEL,
  builderProjectDownloadUrl,
  deleteBuilderProject,
  describeError,
  getBuilderProject,
  listBuilderProjects,
  updateBuilderProject,
  type BuilderProject,
} from "@/lib/projects";
import { MOCK_BUILDER_CHAT, MOCK_FILE_CONTENTS, MOCK_FILE_TREE } from "@/lib/mock-data";
import { NOT_PARTICIPATING_HINT } from "@/lib/quarters";

import PreviewPane from "./PreviewPane";
import styles from "./workspace.module.css";

type Mode = "code" | "preview" | "split";

type State =
  | { phase: "loading" }
  | { phase: "ready"; project: BuilderProject }
  | { phase: "error"; message: string };

const ENTRY_FILE = "page.tsx";

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
  const [mode, setMode] = useState<Mode>("code");
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
  const code = MOCK_FILE_CONTENTS[activeFile] ?? "// 내용이 없습니다.";
  const lineCount = code.split("\n").length;
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

        <span className={`badge ${BUILDER_STATUS_BADGE[project.status]}`}>
          {BUILDER_STATUS_LABEL[project.status]}
        </span>
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
            <span className="badge badge-mock">준비 중</span>
          </div>
          <div className={ws.paneBody}>
            <ul className={styles.fileList}>
              {MOCK_FILE_TREE.map((node) => {
                const isFolder = node.kind === "folder";
                const isActive = !isFolder && node.name === activeFile;

                return (
                  <li key={`${node.depth}-${node.name}`}>
                    <button
                      className={`${styles.fileRow} ${isActive ? styles.fileRowActive : ""} ${
                        isFolder ? styles.folderRow : ""
                      }`}
                      style={{ paddingLeft: `${0.4 + node.depth * 0.75}rem` }}
                      type="button"
                      onClick={() => !isFolder && setActiveFile(node.name)}
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
            {showCode && (
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

            {showPreview && (
              <div className={styles.previewSide}>
                <PreviewPane files={MOCK_FILE_CONTENTS} entry={ENTRY_FILE} />
              </div>
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
                {MOCK_BUILDER_CHAT.map((message, index) => (
                  <div
                    className={`${ws.chatMessage} ${
                      message.role === "user" ? ws.chatUser : ws.chatAssistant
                    }`}
                    key={index}
                  >
                    <span className={ws.chatRole}>
                      {message.role === "user" ? "나" : "Claude"}
                    </span>
                    {message.body}
                  </div>
                ))}
              </div>
            </div>
            <div className={ws.chatComposer}>
              <input
                className="field"
                type="text"
                placeholder={mayCreate ? "무엇을 바꿀까요?" : "이번 분기에는 사용할 수 없습니다"}
                disabled
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                aria-label={
                  mayCreate
                    ? "Claude에게 요청하기 (Phase 3에서 제공됩니다)"
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
