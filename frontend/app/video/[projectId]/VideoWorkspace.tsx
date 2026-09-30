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

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import ws from "@/app/components/workspace.module.css";
import {
  VIDEO_STATUS_BADGE,
  VIDEO_STATUS_LABEL,
  createVideoVersion,
  describeError,
  getVideoProject,
  listVideoModels,
  listVideoProjects,
  updateVideoProject,
  type VideoModel,
  type VideoProject,
  type VideoProjectDetail,
} from "@/lib/projects";
import {
  MOCK_VIDEO_CHAT,
  MOCK_VIDEO_FALLBACK_REPLY,
  MOCK_VIDEO_REVISIONS,
  type VideoChatMessage,
} from "@/lib/mock-data";

import styles from "./workspace.module.css";

/** 미리보기 길이(초). 실제 영상이 아니라 재생 느낌만 흉내 냅니다. */
const PREVIEW_SECONDS = 15;
const TICK_MS = 150;

/** 버전마다 다른 색을 주어 목록에서 구분되게 합니다. */
const VERSION_ARTWORK: [string, string][] = [
  ["#1e1b4b", "#7c3aed"],
  ["#0f172a", "#6d28d9"],
  ["#0c1222", "#4338ca"],
  ["#0b1020", "#5b21b6"],
];

function artworkFor(index: number): [string, string] {
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
  const [state, setState] = useState<State>({ phase: "loading" });
  const [siblings, setSiblings] = useState<VideoProject[]>([]);
  const [models, setModels] = useState<VideoModel[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<VideoChatMessage[]>(MOCK_VIDEO_CHAT);
  const [draft, setDraft] = useState("");

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState<null | "saving" | "saved">(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(true);

  const switcherRef = useRef<HTMLDivElement | null>(null);

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

  // 효과 본문에서 바로 상태를 바꾸지 않도록, 약속이 끝난 뒤에만 반영합니다.
  useEffect(() => {
    let cancelled = false;

    getVideoProject(projectId)
      .then((project) => {
        if (!cancelled) applyProject(project);
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [applyProject, projectId]);

  useEffect(() => {
    let cancelled = false;

    // 모델 목록은 백엔드가 정합니다. 프런트엔드에 모델 이름을 적어 두지
    // 않으므로, 관리자가 목록을 바꾸면 여기에 그대로 반영됩니다.
    listVideoModels()
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => {
        /* 모델을 못 받으면 Auto만 남습니다 */
      });

    listVideoProjects()
      .then((list) => {
        if (!cancelled) setSiblings(list);
      })
      .catch(() => {
        /* 전환 메뉴만 비어 있게 둡니다 */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- 재생 ---------- */

  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(() => {
      setProgress((current) => {
        const next = current + (TICK_MS / 1000 / PREVIEW_SECONDS) * 100;
        if (next >= 100) {
          setIsPlaying(false);
          return 100;
        }
        return next;
      });
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [isPlaying]);

  /* ---------- 바깥 클릭으로 전환 메뉴 닫기 ---------- */

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

  /* ---------- 저장 ---------- */

  const savePrompt = useCallback(async () => {
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
  }, [prompt, projectId, state]);

  const chooseModel = useCallback(
    async (value: string) => {
      const selected_model_id = value === "auto" ? null : Number(value);
      try {
        const updated = await updateVideoProject(projectId, { selected_model_id });
        setState({ phase: "ready", project: updated });
      } catch (error) {
        setState({ phase: "error", message: describeError(error) });
      }
    },
    [projectId],
  );

  const generate = useCallback(async () => {
    if (generating) return;

    setGenerating(true);
    setIsPlaying(false);
    setProgress(0);
    try {
      // 프롬프트를 먼저 저장해야 버전에 지금 내용이 기록됩니다.
      await updateVideoProject(projectId, { prompt });
      const version = await createVideoVersion(projectId);
      await load();
      setSelectedVersionId(version.id);
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    } finally {
      setGenerating(false);
    }
  }, [generating, load, projectId, prompt]);

  const markFinal = useCallback(async () => {
    if (!selectedVersionId) return;
    try {
      const updated = await updateVideoProject(projectId, {
        final_version_id: selectedVersionId,
      });
      setState({ phase: "ready", project: updated });
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    }
  }, [projectId, selectedVersionId]);

  /* ---------- Claude (목업) ---------- */

  const askClaude = useCallback(() => {
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
  }, [draft, prompt]);

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
  const versions = project.versions;
  const selectedIndex = versions.findIndex((v) => v.id === selectedVersionId);
  const selected = selectedIndex >= 0 ? versions[selectedIndex] : null;
  const artwork = artworkFor(selectedIndex >= 0 ? selectedIndex : 0);
  const elapsed = (progress / 100) * PREVIEW_SECONDS;
  const isFinal = selected !== null && project.final_version_id === selected.id;

  return (
    <div className={ws.shell}>
      {/* 위쪽 막대 */}
      <div className={ws.topbar}>
        <Link className={ws.backLink} href="/video">
          ← Video Projects
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
                    href={`/video/${item.id}`}
                    role="menuitem"
                    onClick={() => setSwitcherOpen(false)}
                  >
                    <span>{item.name}</span>
                    <span className={ws.switcherItemMeta}>
                      {VIDEO_STATUS_LABEL[item.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <span className={`badge ${VIDEO_STATUS_BADGE[project.status]}`}>
          {VIDEO_STATUS_LABEL[project.status]}
        </span>

        <span className={ws.topbarSpacer} />
        <span className={ws.topbarActions}>
          <Link className="btn btn-sm" href="/profile">
            내 영상
          </Link>
        </span>
      </div>

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
            <textarea
              className={`field ${styles.promptArea}`}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onBlur={() => void savePrompt()}
              placeholder="영상 아이디어를 자유롭게 적어주세요"
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
                >
                  {/* Auto는 Ctrl AI의 선택지이지 Higgsfield 모델이 아닙니다. */}
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
                    : "Ctrl AI가 알맞은 모델을 고릅니다."}
                </p>
              </div>

              {/* 모델마다 지원하는 설정이 다르므로, 고른 모델이 알려 준
                  것만 보여 줍니다. 고정된 목록을 적어 두지 않습니다. */}
              {project.selected_model?.capabilities && (
                <div className={styles.settingRow}>
                  <span className={styles.settingLabel}>이 모델이 지원하는 설정</span>
                  <div className={styles.chips}>
                    {(project.selected_model.capabilities.durations ?? []).map((d) => (
                      <span className={styles.chip} key={`d-${d}`}>
                        {d}초
                      </span>
                    ))}
                    {(project.selected_model.capabilities.aspect_ratios ?? []).map((r) => (
                      <span className={styles.chip} key={`r-${r}`}>
                        {r}
                      </span>
                    ))}
                    <span className={styles.chip}>
                      소리 {project.selected_model.capabilities.sound ? "지원" : "미지원"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.actions}>
              <button
                className="btn"
                type="button"
                onClick={() => setDraft("조금 더 어두운 분위기로 바꿔줘.")}
              >
                Claude로 다듬기
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void generate()}
                disabled={generating}
              >
                {generating ? "생성 중…" : "Higgsfield로 생성"}
              </button>
              <p className="small dim">
                아직 실제로 영상을 만들지는 않습니다. 시도만 버전으로 기록됩니다.
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
              {isFinal && <span className="badge badge-ok">최종본</span>}
            </span>
            <span>{selected ? selected.model_id : "버전 없음"}</span>
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
                <div className={styles.player}>
                  <div
                    className={`${styles.playerArt} ${isPlaying ? styles.playerArtPlaying : ""}`}
                    style={{
                      background: `linear-gradient(150deg, ${artwork[0]}, ${artwork[1]})`,
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
                        ▶
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
                        {isPlaying ? "❚❚" : "▶"}
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
                        {formatTime(elapsed)} / {formatTime(PREVIEW_SECONDS)}
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
                      >
                        수정된 프롬프트 적용
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
                placeholder="어떻게 바꿀까요?"
                aria-label="Claude에게 수정 요청하기"
              />
              <button
                className="btn btn-sm"
                type="button"
                onClick={askClaude}
                disabled={!draft.trim()}
              >
                보내기
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
                        background: `linear-gradient(150deg, ${artworkFor(index)[0]}, ${
                          artworkFor(index)[1]
                        })`,
                      }}
                      aria-hidden="true"
                    />
                    <span className={styles.versionMeta}>
                      <span>{version.label}</span>
                      <span className={styles.versionTime}>{formatClock(version.created_at)}</span>
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
              disabled={generating}
            >
              다시 생성
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => void markFinal()}
              disabled={!selected || isFinal}
            >
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
    </div>
  );
}
