"use client";

/**
 * Project Builder — 내 프로젝트 목록.
 *
 * 메인 내비게이션에서 Project Builder를 누르면 작업 공간이 아니라 이
 * 화면이 먼저 열립니다. 프로젝트를 고르면 /builder/{id}로 들어갑니다.
 *
 * 목록은 백엔드에서 가져옵니다. 백엔드가 꺼져 있어도 화면이 깨지지 않고
 * 무엇을 하면 되는지 한국어로 안내합니다.
 */

import { useCallback, useEffect, useState } from "react";

import {
  BUILDER_STATUS_BADGE,
  BUILDER_STATUS_LABEL,
  builderProjectDownloadUrl,
  createBuilderProject,
  deleteBuilderProject,
  describeError,
  formatRelative,
  listBuilderProjects,
  updateBuilderProject,
  type BuilderProject,
} from "@/lib/projects";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import LibraryCard from "@/app/components/LibraryCard";
import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { useMayCreate } from "@/app/components/MyQuarterProvider";
import NotParticipatingBanner from "@/app/components/NotParticipatingBanner";
import { useChatIdea } from "@/app/components/useChatIdea";
import { NOT_PARTICIPATING_HINT } from "@/lib/quarters";

import styles from "@/app/components/library.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; projects: BuilderProject[] }
  | { phase: "error"; message: string };

export default function BuilderLibrary() {
  // 참여하지 않는 분기에는 새로 만들 수 없습니다. 실제 차단은
  // 백엔드의 require_active_member가 하고, 여기서는 이유를 설명합니다.
  const mayCreate = useMayCreate();

  const [state, setState] = useState<State>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // Chat의 액션 단추로 왔다면 새 프로젝트 칸을 열고 채워 둡니다.
  const chatIdea = useChatIdea();
  const [creating, setCreating] = useState(() => chatIdea.idea !== "");
  const [newName, setNewName] = useState(() => chatIdea.name);
  const [idea, setIdea] = useState(() => chatIdea.idea);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // 지우려고 고른 프로젝트. 창에 이름을 보여 줘야 하므로 id만으로는
  // 모자랍니다.
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listBuilderProjects()
      .then((projects) => {
        if (!cancelled) setState({ phase: "ready", projects });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => {
    setState({ phase: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;

    setBusy(true);
    try {
      await createBuilderProject({ name, description: idea });
      setNewName("");
      setIdea("");
      setCreating(false);
      reload();
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [idea, newName, reload]);

  // 이름 바꾸기는 목록을 다시 받지 않고 그 줄만 고칩니다 — 다시
  // 불러오면 검색·필터가 깜빡이고, 바꾼 줄이 어디로 갔는지 알기
  // 어려워집니다.
  const rename = useCallback(async (id: number, name: string) => {
    const updated = await updateBuilderProject(id, { name });
    setState((current) =>
      current.phase === "ready"
        ? {
            phase: "ready",
            projects: current.projects.map((item) => (item.id === id ? updated : item)),
          }
        : current,
    );
  }, []);

  const remove = useCallback(async (id: number) => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await deleteBuilderProject(id);
      setConfirm(null);
      setState((current) =>
        current.phase === "ready"
          ? { phase: "ready", projects: current.projects.filter((item) => item.id !== id) }
          : current,
      );
    } catch (error) {
      // 창은 열어 둡니다 — 왜 안 되었는지 읽을 자리가 거기뿐입니다.
      setRemoveError(describeError(error));
    } finally {
      setRemoving(false);
    }
  }, []);

  const askToDelete = useCallback(
    (project: BuilderProject) => {
      setRemoveError(null);
      setConfirm({
        title: "프로젝트 삭제",
        effect: `'${project.name}' 프로젝트을 삭제합니다. 목록에서 사라지지만 관리자가 되살릴 수 있고, 지금까지 쓴 사용량 기록은 그대로 남습니다.`,
        confirmLabel: "삭제",
        danger: true,
        onConfirm: () => remove(project.id),
      });
    },
    [remove],
  );

  // 브라우저 안에서 거릅니다. 서버 검색으로 옮길 때는 이 블록만 요청으로
  // 바뀌고 화면 구조는 그대로입니다.
  const projects = state.phase === "ready" ? state.projects : [];
  const visible = projects.filter(
    (project) =>
      matchesQuery(query, project.name, project.description) &&
      (statusFilter === "all" || project.status === statusFilter),
  );

  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>Project Builder</h1>
        <p className={styles.subtitle}>
          만들고 싶은 것을 한국어로 설명하면 Claude가 프로젝트를 만들어 줍니다.
        </p>
        <div className={styles.headActions}>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => setCreating((open) => !open)}
            disabled={!mayCreate}
            title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
          >
            + 새 프로젝트
          </button>
        </div>
      </header>

      <NotParticipatingBanner />

      {creating && (
        <div className={styles.createForm}>
          <label className="section-title" htmlFor="new-builder-project">
            새 프로젝트 이름
          </label>
          <div className={styles.createRow}>
            <input
              className={`field ${styles.createInput}`}
              id="new-builder-project"
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                // 한글 조합 중 Enter가 눌리면 글자가 잘리므로 조합이 끝난
                // 뒤에만 보냅니다.
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void create();
                }
              }}
              placeholder="예: 습관 관리 앱"
              autoFocus
            />
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => void create()}
              disabled={!newName.trim() || busy}
            >
              {busy ? "만드는 중…" : "만들기"}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setIdea("");
              }}
            >
              취소
            </button>
          </div>
          {idea && (
            <p className={styles.createIdea}>
              <span className={styles.createIdeaLabel}>Chat에서 가져온 아이디어 — 프로젝트 설명로 저장됩니다</span>
              {idea}
            </p>
          )}
        </div>
      )}

      <p className={styles.sectionLabel}>
        내 프로젝트
        {state.phase === "ready" && (
          <span className={styles.count}>{state.projects.length}개</span>
        )}
      </p>

      {state.phase === "ready" && state.projects.length > 0 && (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="프로젝트 이름이나 설명으로 검색"
          resultCount={visible.length}
          totalCount={state.projects.length}
          filters={[
            {
              key: "status",
              label: "상태",
              value: statusFilter,
              onChange: setStatusFilter,
              options: [
                { value: "all", label: "전체" },
                ...Object.entries(BUILDER_STATUS_LABEL).map(([value, label]) => ({
                  value,
                  label,
                })),
              ],
            },
          ]}
        />
      )}

      {state.phase === "loading" && (
        <div className={styles.skeletonGrid} aria-busy="true" aria-label="불러오는 중">
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      )}

      {state.phase === "error" && (
        <div className={styles.error}>
          <p className={styles.errorTitle}>프로젝트를 불러오지 못했습니다</p>
          <p className={styles.errorText}>
            {state.message}. 백엔드가 실행 중인지 확인해 주세요. <code>backend</code> 폴더에서{" "}
            <code>uvicorn app.main:app --reload --port 8000</code>을 실행하면 됩니다.
          </p>
          <button className="btn btn-sm" type="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}

      {state.phase === "ready" && state.projects.length === 0 && !creating && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>아직 만든 프로젝트가 없습니다</p>
          <p className={styles.emptyText}>
            첫 프로젝트를 만들어 보세요. 이름만 정하면 바로 시작할 수 있습니다.
          </p>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => setCreating(true)}
            disabled={!mayCreate}
          >
            + 새 프로젝트
          </button>
        </div>
      )}

      {state.phase === "ready" && state.projects.length > 0 && visible.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>검색 결과가 없습니다</p>
          <p className={styles.emptyText}>다른 낱말로 찾아보거나 상태 필터를 바꿔보세요.</p>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
            }}
          >
            검색 조건 지우기
          </button>
        </div>
      )}

      {state.phase === "ready" && visible.length > 0 && (
        <div className={styles.grid}>
          {visible.map((project) => (
            <LibraryCard
              badge={
                <span className={`badge ${BUILDER_STATUS_BADGE[project.status]}`}>
                  {BUILDER_STATUS_LABEL[project.status]}
                </span>
              }
              extraActions={[
                {
                  label: "코드 다운로드 (ZIP)",
                  href: builderProjectDownloadUrl(project.id),
                  title: "프로젝트 파일을 압축 파일로 받습니다",
                },
              ]}
              href={`/builder/${project.id}`}
              key={project.id}
              lockedHint={NOT_PARTICIPATING_HINT}
              mayEdit={mayCreate}
              name={project.name}
              onDelete={() => askToDelete(project)}
              onRename={(name) => rename(project.id, name)}
            >
              <p className={styles.cardDescription}>
                {project.description || "설명이 아직 없습니다."}
              </p>
              <p className={styles.cardMeta}>
                <span className={styles.metaTime}>{formatRelative(project.updated_at)}</span>
                <span className={styles.metaDot} aria-hidden="true">
                  ·
                </span>
                <span>
                  {project.github_repo ? `GitHub: ${project.github_repo}` : "GitHub 미연결"}
                </span>
              </p>
            </LibraryCard>
          ))}

          <button
            className={styles.newCard}
            type="button"
            onClick={() => setCreating(true)}
            disabled={!mayCreate}
            title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
          >
            <span className={styles.newCardGlyph} aria-hidden="true">
              +
            </span>
            <span className={styles.newCardLabel}>새 프로젝트</span>
            <span className={styles.newCardHint}>이름만 정하면 시작합니다</span>
          </button>
        </div>
      )}

      <ConfirmDialog
        busy={removing}
        error={removeError}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
