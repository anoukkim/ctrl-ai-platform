"use client";

/**
 * Project Builder 작업 공간.
 *
 * 화면 구성: 왼쪽에 프로젝트/파일, 가운데에 코드, 오른쪽에 Claude,
 * 아래에 미리보기와 빌드 결과. 작업 영역이 화면 대부분을 차지합니다.
 *
 * 동작하는 것은 "파일을 고르면 코드가 바뀐다" 정도입니다. 코드를 실제로
 * 만들거나 실행하지 않습니다. 회원이 만든 코드는 Ctrl AI 백엔드에서
 * 실행하지 않으며, 격리된 실행 환경은 나중 단계입니다.
 */

import { useState } from "react";

import ws from "@/app/components/workspace.module.css";
import {
  MOCK_BUILDER_CHAT,
  MOCK_BUILD_OUTPUT,
  MOCK_FILE_CONTENTS,
  MOCK_FILE_TREE,
  MOCK_PROJECTS,
  PROJECT_STATUS_LABEL,
} from "@/lib/mock-data";

import styles from "./builder.module.css";

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-muted",
  building: "badge-warn",
  ready: "badge-accent",
  published: "badge-ok",
  archived: "badge-muted",
};

/** 편집기 위쪽에 열려 있는 탭. 실제 편집기처럼 보이게 하는 장치입니다. */
const OPEN_TABS = ["page.tsx", "HabitForm.tsx"];

export default function BuilderWorkspace() {
  const [projectId, setProjectId] = useState(MOCK_PROJECTS[0].id);
  const [activeFile, setActiveFile] = useState("page.tsx");

  const project = MOCK_PROJECTS.find((item) => item.id === projectId) ?? MOCK_PROJECTS[0];
  const code = MOCK_FILE_CONTENTS[activeFile] ?? "// 내용이 없습니다.";
  const lineCount = code.split("\n").length;

  // 열린 탭 + 지금 고른 파일(탭에 없더라도 보이도록).
  const tabs = OPEN_TABS.includes(activeFile) ? OPEN_TABS : [...OPEN_TABS, activeFile];

  return (
    <div className={ws.shell}>
      {/* 위쪽 막대 — 낮게 유지합니다. */}
      <div className={ws.topbar}>
        <span className={ws.topbarTitle}>
          Project Builder
          <span className="badge badge-mock">준비 중</span>
        </span>
        <span className={ws.topbarDivider} aria-hidden="true" />
        <span className={ws.topbarProject}>
          <span className={ws.topbarProjectName}>{project.name}</span>
          <span className={`badge ${STATUS_BADGE[project.status] ?? "badge-muted"}`}>
            {PROJECT_STATUS_LABEL[project.status]}
          </span>
        </span>
        <span className={ws.topbarSpacer} />
        <span className={ws.topbarActions}>
          <button className="btn btn-sm" type="button" disabled title="Phase 4에서 제공됩니다">
            GitHub 연결
          </button>
          <button className="btn btn-sm" type="button" disabled title="Phase 4에서 제공됩니다">
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

      <div className={ws.body}>
        {/* 왼쪽 — 프로젝트와 파일 */}
        <aside className={`${ws.pane} ${styles.left}`}>
          <div className={ws.paneHead}>
            <span className={ws.paneHeadTitle}>탐색</span>
            <button className="btn btn-sm" type="button" disabled title="Phase 3에서 제공됩니다">
              새 프로젝트
            </button>
          </div>
          <div className={ws.paneBody}>
            <p className="section-title">내 프로젝트</p>
            <ul className={styles.projectList}>
              {MOCK_PROJECTS.map((item) => (
                <li key={item.id}>
                  <button
                    className={`${styles.projectItem} ${
                      item.id === projectId ? styles.projectItemActive : ""
                    }`}
                    type="button"
                    onClick={() => setProjectId(item.id)}
                    aria-pressed={item.id === projectId}
                  >
                    <span className={styles.projectItemTop}>
                      <span className={styles.projectItemName}>{item.name}</span>
                      <span className={`badge ${STATUS_BADGE[item.status] ?? "badge-muted"}`}>
                        {PROJECT_STATUS_LABEL[item.status]}
                      </span>
                    </span>
                    <span className={styles.projectItemMeta}>{item.updatedAt} 수정</span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="section-title">파일</p>
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

        {/* 가운데 — 코드 */}
        <section className={`${ws.pane} ${ws.paneCenter}`}>
          <div className={styles.tabs}>
            {tabs.map((tab) => (
              <button
                className={`${styles.tab} ${tab === activeFile ? styles.tabActive : ""}`}
                key={tab}
                type="button"
                onClick={() => setActiveFile(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className={styles.codeScroll}>
            <pre className={styles.code}>
              <span className={styles.gutter} aria-hidden="true">
                {Array.from({ length: lineCount }, (_, index) => index + 1).join("\n")}
              </span>
              <code className={styles.codeText}>{code}</code>
            </pre>
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
                placeholder="무엇을 만들고 싶나요?"
                disabled
                aria-label="Claude에게 요청하기 (Phase 0에서는 사용할 수 없습니다)"
              />
              <p className={styles.hint}>
                예: &ldquo;이번 주 달성률을 보여주는 그래프를 추가해줘.&rdquo;
              </p>
            </div>
          </div>
        </aside>
      </div>

      {/* 아래 — 미리보기와 빌드 결과 */}
      <div className={ws.bottom}>
        <div className={ws.bottomHead}>
          <span>미리보기 · 빌드 결과</span>
          <span className="badge badge-mock">준비 중</span>
        </div>
        <div className={styles.bottomGrid}>
          <div className={styles.preview}>
            <div className={styles.previewFrame}>
              안전한 실행 환경이 준비되면 만든 앱을 여기에서 바로 확인할 수 있습니다.
            </div>
          </div>
          <pre className={styles.output}>
            {MOCK_BUILD_OUTPUT.map((line) => (
              <div className={line.includes("✓") ? styles.outputOk : undefined} key={line}>
                {line}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}
