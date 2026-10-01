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

import { Lock } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useMayCreate } from "@/app/components/MyQuarterProvider";
import NotParticipatingBanner from "@/app/components/NotParticipatingBanner";
import ws from "@/app/components/workspace.module.css";
import {
  BUILDER_STATUS_BADGE,
  BUILDER_STATUS_LABEL,
  describeError,
  getBuilderProject,
  listBuilderProjects,
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

export default function BuilderWorkspace({ projectId }: { projectId: string }) {
  // 참여하지 않는 분기에도 이 화면은 열립니다 — 내 작업물은 언제든 볼 수
  // 있어야 하니까요. 막히는 것은 바꾸는 쪽뿐입니다.
  const mayCreate = useMayCreate();

  const [state, setState] = useState<State>({ phase: "loading" });
  const [siblings, setSiblings] = useState<BuilderProject[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [activeFile, setActiveFile] = useState(ENTRY_FILE);
  const [mode, setMode] = useState<Mode>("code");

  const switcherRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    getBuilderProject(projectId)
      .then((project) => {
        if (!cancelled) setState({ phase: "ready", project });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 전환 메뉴에 쓸 목록. 실패해도 작업 공간은 그대로 쓸 수 있어야 하므로
  // 조용히 넘어갑니다.
  useEffect(() => {
    let cancelled = false;
    listBuilderProjects()
      .then((projects) => {
        if (!cancelled) setSiblings(projects);
      })
      .catch(() => {
        /* 전환 메뉴만 비어 있게 둡니다 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 바깥을 누르면 전환 메뉴를 닫습니다.
  useEffect(() => {
    if (!switcherOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setSwitcherOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSwitcherOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [switcherOpen]);

  const closeSwitcher = useCallback(() => setSwitcherOpen(false), []);

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
        <Link className={ws.backLink} href="/builder">
          ← Projects
        </Link>
        <span className={ws.topbarDivider} aria-hidden="true" />

        <div className={ws.switcher} ref={switcherRef}>
          <button
            className={ws.switcherButton}
            type="button"
            onClick={() => setSwitcherOpen((open) => !open)}
            aria-expanded={switcherOpen}
            aria-haspopup="menu"
          >
            <span className={ws.switcherName}>{project.name}</span>
            <span className={ws.switcherCaret} aria-hidden="true">
              ▾
            </span>
          </button>

          {switcherOpen && (
            <ul className={ws.switcherMenu} role="menu">
              {siblings.length === 0 && (
                <li className={ws.switcherEmpty}>다른 프로젝트가 없습니다</li>
              )}
              {siblings.map((item) => (
                <li key={item.id} role="none">
                  <Link
                    className={`${ws.switcherItem} ${
                      item.id === project.id ? ws.switcherItemActive : ""
                    }`}
                    href={`/builder/${item.id}`}
                    role="menuitem"
                    onClick={closeSwitcher}
                  >
                    <span>{item.name}</span>
                    <span className={ws.switcherItemMeta}>
                      {BUILDER_STATUS_LABEL[item.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

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
            CtrlAI Apps에 게시
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
                    <code className={styles.codeText}>{code}</code>
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
    </div>
  );
}
