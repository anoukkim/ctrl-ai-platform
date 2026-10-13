"use client";

/**
 * Project Builder — 내 프로젝트 목록.
 *
 * 메인 내비게이션에서 Project Builder를 누르면 작업 공간이 아니라 이
 * 화면이 먼저 열립니다. 프로젝트를 고르면 /builder/{id}로 들어갑니다.
 *
 * 목록은 백엔드에서 가져옵니다. 백엔드가 꺼져 있어도 화면이 깨지지 않고
 * 무엇을 하면 되는지 한국어로 안내합니다.
 *
 * Chat에서 "앱 만들어 줘"로 왔다면 새 프로젝트 칸이 아이디어로 채워져
 * 열리고, "예시 앱까지 만들기"가 켜져 있습니다(chat-builder-starter): 만들기를
 * 누르면 프로젝트를 만든 뒤 Claude가 작은 예시 앱을 만들고, 작업 공간이
 * 열리면서 바로 미리보기로 보여 줍니다. 비용은 누르기 전에 보입니다.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  LIBRARY_FILTERS,
  builderProjectDownloadUrl,
  createBuilderProject,
  createStarterApp,
  deleteBuilderProject,
  getStarterEstimate,
  describeError,
  formatRelative,
  listBuilderProjects,
  updateBuilderProject,
  type LibraryFilter,
  type BuilderProject,
  type StarterEstimate,
} from "@/lib/projects";
import WalletCheck from "@/app/components/WalletCheck";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import LibraryCard from "@/app/components/LibraryCard";
import PageHeader from "@/app/components/PageHeader";
import TestModeNotice from "@/app/components/TestModeNotice";
import ProjectStatusBadge from "@/app/components/ProjectStatusBadge";
import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { useMayCreate } from "@/app/components/MyQuarterProvider";
import NotParticipatingBanner from "@/app/components/NotParticipatingBanner";
import { useChatIdea } from "@/app/components/useChatIdea";
import { NOT_PARTICIPATING_HINT, formatKrw } from "@/lib/quarters";

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
  const router = useRouter();
  // Chat에서 아이디어를 들고 왔으면 예시 앱까지 만드는 것이 기본입니다.
  const [withStarter, setWithStarter] = useState(() => chatIdea.idea !== "");
  const [estimate, setEstimate] = useState<StarterEstimate | null>(null);
  const [step, setStep] = useState<"project" | "starter" | null>(null);
  const [starterFailed, setStarterFailed] = useState<{ id: number; message: string } | null>(
    null,
  );
  const [query, setQuery] = useState("");
  // 전체 / Draft / 게시됨. 거르기는 백엔드가 합니다(`?status=`) — 검색만
  // 브라우저 안에서 합니다.
  const [statusFilter, setStatusFilter] = useState<LibraryFilter>("all");
  // 지우려고 고른 프로젝트. 창에 이름을 보여 줘야 하므로 id만으로는
  // 모자랍니다.
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listBuilderProjects(statusFilter)
      .then((projects) => {
        if (!cancelled) setState({ phase: "ready", projects });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey, statusFilter]);

  // 예시 앱의 비용 어림 — 칸이 열려 있을 때만 받습니다.
  useEffect(() => {
    if (!creating || estimate !== null) return;
    let cancelled = false;
    getStarterEstimate()
      .then((figures) => {
        if (!cancelled) setEstimate(figures);
      })
      .catch(() => {
        /* 어림값이 없어도 프로젝트는 만들 수 있습니다 */
      });
    return () => {
      cancelled = true;
    };
  }, [creating, estimate]);

  const reload = useCallback(() => {
    setState({ phase: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;

    setBusy(true);
    setStarterFailed(null);
    setStep("project");
    let project: BuilderProject;
    try {
      project = await createBuilderProject({ name, description: idea });
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
      setBusy(false);
      setStep(null);
      return;
    }

    if (withStarter && idea.trim()) {
      setStep("starter");
      try {
        await createStarterApp(project.id, idea);
      } catch (error) {
        // 프로젝트는 만들어졌습니다. 이유를 보여 주고, 작업 공간에서 다시
        // 시도할 수 있게 그 프로젝트로 가는 길을 함께 둡니다.
        setStarterFailed({ id: project.id, message: describeError(error) });
        setBusy(false);
        setStep(null);
        reload();
        return;
      }
    }
    setBusy(false);
    setStep(null);
    router.push(`/builder/${project.id}`);
  }, [idea, newName, reload, router, withStarter]);

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
  const visible = projects.filter((project) =>
    matchesQuery(query, project.name, project.description),
  );

  return (
    <>
      <PageHeader
        eyebrow="Create"
        tone="build"
        title="Project Builder"
        titleAddon={<TestModeNotice area="builder" />}
        subtitle="만들고 싶은 것을 한국어로 설명하면 Claude가 프로젝트를 만들어 줍니다."
        actions={
          <button
            className="btn btn-primary btn-lg"
            type="button"
            onClick={() => setCreating((open) => !open)}
            disabled={!mayCreate}
            title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
          >
            + 새 프로젝트
          </button>
        }
      />

      <NotParticipatingBanner />

      {creating && (
        <div className={styles.createForm}>
          <p className={styles.createTitle}>새 프로젝트</p>
          <label className="sr-only" htmlFor="new-builder-project">
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
              className="btn btn-primary"
              type="button"
              onClick={() => void create()}
              disabled={!newName.trim() || busy}
            >
              {step === "starter"
                ? "예시 앱을 만드는 중… (보통 30초~1분)"
                : busy
                  ? "만드는 중…"
                  : "만들기"}
            </button>
            <button
              className="btn btn-outline"
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
              <span className={styles.createIdeaLabel}>
                Chat에서 가져온 아이디어 — 프로젝트 설명으로 저장됩니다
              </span>
              {idea}
            </p>
          )}
          <label className={styles.createStarter}>
            <input
              type="checkbox"
              checked={withStarter}
              onChange={(event) => setWithStarter(event.target.checked)}
              disabled={busy}
            />
            <span>
              예시 앱까지 만들기
              <span className={styles.createStarterHint}>
                {idea.trim()
                  ? estimate
                    ? ` — Claude가 바로 실행해 볼 수 있는 작은 앱을 만들어요. 약 ${formatKrw(estimate.estimated_krw)} (최대 ${formatKrw(estimate.worst_case_krw)})`
                    : " — Claude가 바로 실행해 볼 수 있는 작은 앱을 만들어요."
                  : " — 만들고 싶은 것을 Chat에서 가져오거나, 프로젝트를 연 뒤 적어 주세요."}
              </span>
            </span>
          </label>
          {withStarter && idea.trim() && estimate && (
            <WalletCheck costKrw={estimate.worst_case_krw} />
          )}
          {starterFailed && (
            <p className={styles.createError} role="alert">
              프로젝트는 만들었지만 예시 앱은 만들지 못했습니다. {starterFailed.message}{" "}
              <Link href={`/builder/${starterFailed.id}`}>프로젝트 열어서 다시 시도 ›</Link>
            </p>
          )}
        </div>
      )}

      <div className={`toolbar ${styles.toolbar}`}>
        <p className={`toolbar-count ${styles.sectionLabel}`}>
          내 프로젝트
          {state.phase === "ready" && (
            <span className={styles.count}>{state.projects.length}개</span>
          )}
        </p>

        {state.phase === "ready" && (state.projects.length > 0 || statusFilter !== "all") && (
          <>
            <div className={styles.toolbarSearch}>
              <SearchBar
                value={query}
                onChange={setQuery}
                placeholder="프로젝트 이름이나 설명으로 검색"
                resultCount={visible.length}
                totalCount={state.projects.length}
              />
            </div>
            {/* 전체 / Draft / 게시됨 — 백엔드의 ?status=와 같은 값입니다. */}
            <div className="segmented" role="group" aria-label="상태">
              {LIBRARY_FILTERS.map((option) => (
                <button
                  aria-pressed={statusFilter === option.value}
                  className="chip"
                  key={option.value}
                  onClick={() => setStatusFilter(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

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

      {state.phase === "ready" &&
        state.projects.length === 0 &&
        statusFilter === "all" &&
        !creating && (
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

      {state.phase === "ready" &&
        (state.projects.length > 0 || statusFilter !== "all") &&
        visible.length === 0 && (
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
              badge={<ProjectStatusBadge status={project.status} />}
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
              thumbnail={
                <span className={styles.thumbPlaceholder}>미리보기 썸네일</span>
              }
              thumbnailPlacement="top"
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
            className={`${styles.newCard} ${styles.newCardBuild}`}
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
