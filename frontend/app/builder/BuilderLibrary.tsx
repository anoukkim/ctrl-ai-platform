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

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  LIBRARY_FILTERS,
  builderProjectDownloadUrl,
  builderThumbnailUrl,
  createBuilderProject,
  createBuilderProjectFromTemplate,
  deleteBuilderProject,
  describeError,
  formatRelative,
  listBuilderProjects,
  listBuilderTemplates,
  setBuilderPinned,
  updateBuilderProject,
  type LibraryFilter,
  type BuilderProject,
  type BuilderTemplate,
} from "@/lib/projects";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import LibraryCard from "@/app/components/LibraryCard";
import ListToolbar from "@/app/components/ListToolbar";
import PageHeader from "@/app/components/PageHeader";
import TestModeNotice from "@/app/components/TestModeNotice";
import ProjectStatusBadge from "@/app/components/ProjectStatusBadge";
import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import SortMenu from "@/app/components/SortMenu";
import Thumbnail from "@/app/ctrlaistore/AppThumbnail";
import { useMayCreate } from "@/app/components/MyQuarterProvider";
import NotParticipatingBanner from "@/app/components/NotParticipatingBanner";
import { useChatIdea } from "@/app/components/useChatIdea";
import { sortItems, useSortPref, writeSortPref } from "@/lib/list-sort";
import { NOT_PARTICIPATING_HINT } from "@/lib/quarters";

import styles from "@/app/components/library.module.css";
import { useToast } from "@/app/components/ToastProvider";

type State =
  | { phase: "loading" }
  | { phase: "ready"; projects: BuilderProject[] }
  | { phase: "error"; message: string };

export default function BuilderLibrary() {
  const toast = useToast();
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
  // 시작 방법 (app-platform P4): 빈 프로젝트(null) 또는 템플릿 하나. 목록은
  // 칸을 처음 열 때 받아 옵니다. Chat에서 온 아이디어가 있으면 그 길이
  // 우선이라 템플릿은 보이지 않습니다.
  const [templates, setTemplates] = useState<BuilderTemplate[] | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  // 전체 / 작성 중 / 게시됨. 거르기는 백엔드가 합니다(`?status=`) — 검색만
  // 브라우저 안에서 합니다.
  const [statusFilter, setStatusFilter] = useState<LibraryFilter>("all");
  // 정렬 (ui-improvements): 고정 먼저, 그다음 마지막 수정순 / 이름순 — 이 기기에 기억.
  const sort = useSortPref("builder");
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

  const reload = useCallback(() => {
    setState({ phase: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!creating || idea || templates !== null) return;
    let cancelled = false;
    listBuilderTemplates()
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch(() => {
        // 템플릿이 없어도 빈 프로젝트는 만들 수 있습니다.
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [creating, idea, templates]);

  /** 템플릿을 고르면 이름 칸을 그 이름으로 채웁니다 — 회원이 적은 이름은 두고요. */
  const pickTemplate = useCallback(
    (key: string | null) => {
      setTemplateKey(key);
      const previous = templates?.find((t) => t.key === templateKey)?.name ?? "";
      const next = templates?.find((t) => t.key === key)?.name ?? "";
      if (!newName.trim() || newName === previous) setNewName(next);
    },
    [newName, templateKey, templates],
  );

  /**
   * 프로젝트를 만들고 작업 공간으로 갑니다. Chat에서 가져온 아이디어는
   * 설명으로 저장되고, 작업 공간이 그것으로 짧은 질문을 채워 둔 뒤 만들
   * 계획부터 보여 줍니다(quality-tuning Q2) — 돈은 계획을 세울 때부터 듭니다.
   * 템플릿을 골랐다면 파일을 복사할 뿐이라 무료이고, 바로 미리보기로 열립니다.
   */
  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;

    setBusy(true);
    setCreateError(null);
    let project: BuilderProject;
    try {
      project = templateKey
        ? await createBuilderProjectFromTemplate({ template: templateKey, name })
        : await createBuilderProject({ name, description: idea });
    } catch (error) {
      setCreateError(describeError(error));
      setBusy(false);
      return;
    }
    setBusy(false);
    router.push(`/builder/${project.id}`);
  }, [idea, newName, router, templateKey]);

  // 이름 바꾸기는 목록을 다시 받지 않고 그 줄만 고칩니다 — 다시
  // 불러오면 검색·필터가 깜빡이고, 바꾼 줄이 어디로 갔는지 알기
  // 어려워집니다.
  const rename = useCallback(async (id: number, name: string) => {
    const updated = await updateBuilderProject(id, { name });
    toast.show("이름을 바꿨어요.");
    setState((current) =>
      current.phase === "ready"
        ? {
            phase: "ready",
            projects: current.projects.map((item) => (item.id === id ? updated : item)),
          }
        : current,
    );
  }, [toast]);

  /** 고정 / 고정 해제 — 그 줄만 바꿉니다(이름 바꾸기와 같은 이유). */
  const pin = useCallback(async (id: number, next: boolean) => {
    const updated = await setBuilderPinned(id, next);
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
      toast.show("삭제했어요. 실수였다면 관리자가 되살릴 수 있어요.");
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
  }, [toast]);

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
  const visible = sortItems(
    projects.filter((project) => matchesQuery(query, project.name, project.description)),
    sort,
    (project) => ({ name: project.name, updated: project.updated_at, pinned: Boolean(project.pinned_at) }),
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
          {!idea && (
            <div className={styles.templateGrid} role="group" aria-label="시작 방법">
              <button
                aria-pressed={templateKey === null}
                className={styles.templateCard}
                onClick={() => pickTemplate(null)}
                type="button"
              >
                <span className={styles.templateName}>빈 프로젝트</span>
                <span className={styles.templateDesc}>
                  이름만 정하고, 작업 공간에서 Claude에게 만들고 싶은 것을 말해요.
                </span>
              </button>
              {(templates ?? []).map((template) => (
                <button
                  aria-pressed={templateKey === template.key}
                  className={styles.templateCard}
                  key={template.key}
                  onClick={() => pickTemplate(template.key)}
                  type="button"
                >
                  <span className={styles.templateName}>{template.name}</span>
                  <span className={styles.templateDesc}>{template.description}</span>
                  <span className={styles.templateUses}>
                    {template.uses.map((use) => (
                      <span className={styles.templateUse} key={use}>
                        {use}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          )}
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
              {busy ? "만드는 중…" : "만들기"}
            </button>
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setIdea("");
                setTemplateKey(null);
                setCreateError(null);
              }}
            >
              취소
            </button>
          </div>
          {createError && (
            <p className={styles.createError} role="alert">
              {createError}
            </p>
          )}
          {templateKey && (
            <p className={styles.createStarterHint}>
              템플릿은 바로 열려요 — 무료예요. 열리면 Claude에게 바꾸고 싶은 점을 말해 보세요. 로그인·AI·공유 데이터가 어떻게 되는지는{" "}
              <a href="/help/apps" target="_blank" rel="noreferrer">
                앱 기능 상자 안내
              </a>
              에 있어요.
            </p>
          )}
          {idea && (
            <p className={styles.createIdea}>
              <span className={styles.createIdeaLabel}>
                Chat에서 가져온 아이디어 — 프로젝트 설명으로 저장됩니다
              </span>
              {idea}
            </p>
          )}
          {idea.trim() && (
            <p className={styles.createStarterHint}>
              만들면 작업 공간에서 몇 가지를 묻고, Claude가 만들 계획부터 보여 줘요.
            </p>
          )}
        </div>
      )}

      <ListToolbar
        label={
          <p className={styles.sectionLabel}>
            내 프로젝트
            {state.phase === "ready" && (
              <span className={styles.count}>{state.projects.length}개</span>
            )}
          </p>
        }
        search={
          state.phase === "ready" && (state.projects.length > 0 || statusFilter !== "all") ? (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="프로젝트 이름이나 설명으로 검색"
              resultCount={visible.length}
              totalCount={state.projects.length}
              grow
            />
          ) : null
        }
        controls={
          state.phase === "ready" && (state.projects.length > 0 || statusFilter !== "all") ? (
            <>
              {/* 전체 / 작성 중 / 게시됨 — 백엔드의 ?status=와 같은 값입니다. */}
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
              <SortMenu value={sort} onChange={(key) => writeSortPref("builder", key)} />
            </>
          ) : null
        }
      />

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
            {state.message}. 잠시 후 다시 시도해 주세요. 계속 안 되면 &lsquo;의견 보내기&rsquo;로 알려 주세요.
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
                  label: "프로젝트 내려받기 (ZIP)",
                  href: builderProjectDownloadUrl(project.id),
                  title: "앱 파일과 안내(README · CLAUDE.md · 프롬프트)를 ZIP으로 받습니다",
                },
              ]}
              href={`/builder/${project.id}`}
              key={project.id}
              lockedHint={NOT_PARTICIPATING_HINT}
              mayEdit={mayCreate}
              name={project.name}
              onDelete={() => askToDelete(project)}
              onPin={(next) => pin(project.id, next)}
              onRename={(name) => rename(project.id, name)}
              pinned={Boolean(project.pinned_at)}
              thumbnail={
                /* 찍어 둔 썸네일(작업 중 → 게시본), 없으면 표지 (owner-polish 5). */
                <Thumbnail
                  name={project.name}
                  seed={project.draft_slug ?? project.app_slug ?? String(project.id)}
                  imageUrl={builderThumbnailUrl(project)}
                />
              }
              thumbnailPlacement="top"
            >
              {/* 설명은 게시할 때 쓴 것만 — 작업 중 프로젝트의 칸에는 요청 문장이
                  들어가 있던 때가 있어 보여 주지 않습니다(owner, 2026-10-16). */}
              {project.status === "published" && project.description && (
                <p className={styles.cardDescription}>{project.description}</p>
              )}
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
