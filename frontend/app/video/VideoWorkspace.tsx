"use client";

/**
 * Video Generator 작업 공간.
 *
 * 한 번 만들고 끝나는 화면이 아니라, 반복해서 다듬는 작업 공간입니다.
 *   아이디어 → 생성 → 확인 → Claude와 상의 → 프롬프트 수정 →
 *   다시 생성 → 버전 비교 → 최종본 선택 → YouTube에 게시
 *
 * 구성: 왼쪽에 프롬프트와 설정, 가운데에 큰 9:16 미리보기,
 * 오른쪽에 Claude(작업 내내 계속 보입니다), 아래에 버전 목록.
 *
 * 전부 목업입니다. Claude와 Higgsfield는 호출하지 않고, 답변은 미리 준비한
 * 문장 중에서 낱말을 보고 고릅니다. 새 버전도 화면 안에서만 만들어집니다.
 * 새로고침하면 처음 상태로 돌아갑니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import ws from "@/app/components/workspace.module.css";
import {
  MOCK_VIDEO_CHAT,
  MOCK_VIDEO_FALLBACK_REPLY,
  MOCK_VIDEO_REVISIONS,
  MOCK_VIDEO_VERSIONS,
  VIDEO_ASPECT_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_PROJECT_NAME,
  VIDEO_STYLE_OPTIONS,
  type VideoChatMessage,
  type VideoVersion,
} from "@/lib/mock-data";

import styles from "./video.module.css";

/** 미리보기 길이(초). 실제 영상이 아니라 재생 느낌만 흉내 냅니다. */
const PREVIEW_SECONDS = 15;
const TICK_MS = 150;

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `0:${String(whole).padStart(2, "0")}`;
}

export default function VideoWorkspace() {
  const [versions, setVersions] = useState<VideoVersion[]>(MOCK_VIDEO_VERSIONS);
  const [selectedId, setSelectedId] = useState(MOCK_VIDEO_VERSIONS[2].id);
  const [finalId, setFinalId] = useState<string | null>(null);

  const [prompt, setPrompt] = useState(MOCK_VIDEO_VERSIONS[2].prompt);
  const [style, setStyle] = useState(VIDEO_STYLE_OPTIONS[0]);
  const [duration, setDuration] = useState(VIDEO_DURATION_OPTIONS[1]);
  const [aspect, setAspect] = useState(VIDEO_ASPECT_OPTIONS[0]);

  const [messages, setMessages] = useState<VideoChatMessage[]>(MOCK_VIDEO_CHAT);
  const [draft, setDraft] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(true);

  const generateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = versions.find((version) => version.id === selectedId) ?? versions[0];

  // 재생 진행 막대. 효과 본문에서 바로 상태를 바꾸지 않고, 타이머 안에서만
  // 바꿉니다.
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

  // 화면을 벗어날 때 생성 타이머를 정리합니다.
  useEffect(() => {
    return () => {
      if (generateTimer.current) clearTimeout(generateTimer.current);
    };
  }, []);

  const selectVersion = useCallback((version: VideoVersion) => {
    setSelectedId(version.id);
    setPrompt(version.prompt);
    setProgress(0);
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((playing) => {
      // 끝까지 재생한 뒤 다시 누르면 처음부터 재생합니다.
      if (!playing && progress >= 100) setProgress(0);
      return !playing;
    });
  }, [progress]);

  const replay = useCallback(() => {
    setProgress(0);
    setIsPlaying(true);
  }, []);

  /** Higgsfield 생성을 흉내 냅니다. 잠시 기다린 뒤 새 버전을 추가합니다. */
  const generate = useCallback(() => {
    if (isGenerating) return;

    setIsGenerating(true);
    setIsPlaying(false);
    setProgress(0);

    generateTimer.current = setTimeout(() => {
      setVersions((current) => {
        const next: VideoVersion = {
          id: `v${current.length + 1}`,
          label: `v${current.length + 1}`,
          createdAt: new Date().toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          status: "ready",
          prompt,
          artwork: ["#0b1020", "#5b21b6"],
          note: "방금 만든 버전입니다.",
        };
        setSelectedId(next.id);
        return [...current, next];
      });
      setIsGenerating(false);
    }, 1800);
  }, [isGenerating, prompt]);

  /** Claude 답변을 흉내 냅니다. 실제로는 아무 요청도 보내지 않습니다. */
  const askClaude = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    const rule = MOCK_VIDEO_REVISIONS.find((item) => item.match.test(trimmed));
    const userMessage: VideoChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      body: trimmed,
    };
    const reply: VideoChatMessage = rule
      ? {
          id: `a-${Date.now()}`,
          role: "assistant",
          body: rule.reply,
          revisedPrompt: rule.revise(prompt),
        }
      : {
          id: `a-${Date.now()}`,
          role: "assistant",
          body: MOCK_VIDEO_FALLBACK_REPLY,
        };

    setMessages((current) => [...current, userMessage, reply]);
    setDraft("");
  }, [draft, prompt]);

  const elapsed = (progress / 100) * PREVIEW_SECONDS;

  return (
    <div className={ws.shell}>
      {/* 위쪽 막대 */}
      <div className={ws.topbar}>
        <span className={ws.topbarTitle}>
          Video Generator
          <span className="badge badge-mock">준비 중</span>
        </span>
        <span className={ws.topbarDivider} aria-hidden="true" />
        <span className={ws.topbarProject}>
          프로젝트
          <span className={ws.topbarProjectName}>{VIDEO_PROJECT_NAME}</span>
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
          </div>
          <div className={ws.paneBody}>
            <p className="section-title">어떤 영상을 만들까요?</p>
            <textarea
              className={`field ${styles.promptArea}`}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="영상 아이디어를 자유롭게 적어주세요"
              aria-label="영상 프롬프트"
            />
            <div className={styles.promptMeta}>
              <span>한국어로 적으면 됩니다</span>
              <span>{prompt.length}자</span>
            </div>

            <div className={styles.settings}>
              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>분위기</span>
                <div className={styles.chips}>
                  {VIDEO_STYLE_OPTIONS.map((option) => (
                    <button
                      className={`${styles.chip} ${option === style ? styles.chipActive : ""}`}
                      key={option}
                      type="button"
                      onClick={() => setStyle(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>길이</span>
                <div className={styles.chips}>
                  {VIDEO_DURATION_OPTIONS.map((option) => (
                    <button
                      className={`${styles.chip} ${option === duration ? styles.chipActive : ""}`}
                      key={option}
                      type="button"
                      onClick={() => setDuration(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>화면 비율</span>
                <div className={styles.chips}>
                  {VIDEO_ASPECT_OPTIONS.map((option) => (
                    <button
                      className={`${styles.chip} ${option === aspect ? styles.chipActive : ""}`}
                      key={option}
                      type="button"
                      onClick={() => setAspect(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
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
                onClick={generate}
                disabled={isGenerating}
              >
                {isGenerating ? "생성 중…" : "Higgsfield로 생성"}
              </button>
              <p className="small dim">
                실제로 영상을 만들지는 않습니다. 새 버전이 어떻게 쌓이는지 보여 주는 예시입니다.
              </p>
            </div>
          </div>
        </aside>

        {/* 가운데 — 미리보기 */}
        <section className={`${ws.pane} ${ws.paneCenter}`}>
          <div className={ws.paneHead}>
            <span className={ws.paneHeadTitle}>
              미리보기
              <span className="badge badge-muted">{selected.label}</span>
              {finalId === selected.id && <span className="badge badge-ok">최종본</span>}
            </span>
            <span>
              {aspect} · {duration}
            </span>
          </div>

          <div className={styles.stage}>
            <div className={styles.player}>
              <div
                className={`${styles.playerArt} ${isPlaying ? styles.playerArtPlaying : ""}`}
                style={{
                  background: `linear-gradient(150deg, ${selected.artwork[0]}, ${selected.artwork[1]})`,
                }}
              >
                <div>
                  <p className={styles.playerLabel}>{VIDEO_PROJECT_NAME}</p>
                  <p className={styles.playerSub}>{selected.note}</p>
                </div>
              </div>

              {!isPlaying && !isGenerating && (
                <button className={styles.playOverlay} type="button" onClick={togglePlay}>
                  <span className={styles.playOverlayGlyph} aria-hidden="true">
                    ▶
                  </span>
                  <span className="sr-only">재생</span>
                </button>
              )}

              {isGenerating && (
                <div className={styles.generating}>
                  <div>
                    <div className={styles.spinner} aria-hidden="true" />
                    Higgsfield로 생성 중…
                    <p className="small dim">보통 30초 정도 걸립니다</p>
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
                    onClick={togglePlay}
                    aria-label={isPlaying ? "일시정지" : "재생"}
                    title={isPlaying ? "일시정지" : "재생"}
                  >
                    {isPlaying ? "❚❚" : "▶"}
                  </button>
                  <button
                    className={styles.controlBtn}
                    type="button"
                    onClick={replay}
                    aria-label="처음부터 다시 재생"
                    title="처음부터 다시 재생"
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
                    onClick={() => setMuted((value) => !value)}
                    aria-label={muted ? "소리 켜기" : "소리 끄기"}
                    title={muted ? "소리 켜기" : "소리 끄기"}
                  >
                    {muted ? "🔇" : "🔊"}
                  </button>
                  <button
                    className={styles.controlBtn}
                    type="button"
                    disabled
                    aria-label="전체 화면"
                    title="전체 화면은 실제 영상이 생기면 제공됩니다"
                  >
                    ⛶
                  </button>
                </div>
              </div>
            </div>

            <p className={styles.stageMeta}>
              <span>Higgsfield로 생성</span>
              <span aria-hidden="true">·</span>
              <span>{selected.createdAt}</span>
              <span aria-hidden="true">·</span>
              <span>{style}</span>
            </p>
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
                  // 한글 조합 중에 Enter가 눌리면 글자가 잘리므로,
                  // 조합이 끝난 뒤에만 보냅니다.
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    askClaude();
                  }
                }}
                placeholder="어떻게 바꿀까요?"
                aria-label="Claude에게 수정 요청하기"
              />
              <button className="btn btn-sm" type="button" onClick={askClaude} disabled={!draft.trim()}>
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
          <ul className={styles.versionList}>
            {versions.map((version) => (
              <li key={version.id}>
                <button
                  className={`${styles.version} ${
                    version.id === selectedId ? styles.versionActive : ""
                  }`}
                  type="button"
                  onClick={() => selectVersion(version)}
                  aria-pressed={version.id === selectedId}
                >
                  <span
                    className={styles.versionThumb}
                    style={{
                      background: `linear-gradient(150deg, ${version.artwork[0]}, ${version.artwork[1]})`,
                    }}
                    aria-hidden="true"
                  />
                  <span className={styles.versionMeta}>
                    <span>{version.label}</span>
                    <span className={styles.versionTime}>{version.createdAt}</span>
                  </span>
                  {finalId === version.id && <span className="badge badge-ok">최종</span>}
                </button>
              </li>
            ))}
          </ul>

          <span className={styles.versionSpacer} />

          <span className={styles.versionActions}>
            <button className="btn btn-sm" type="button" onClick={generate} disabled={isGenerating}>
              다시 생성
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => setFinalId(selected.id)}
              disabled={finalId === selected.id}
            >
              {finalId === selected.id ? "최종본으로 지정됨" : "최종본으로 선택"}
            </button>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              disabled
              title={
                finalId
                  ? "YouTube 게시는 Phase 7에서 제공됩니다"
                  : "먼저 최종본을 선택해 주세요. 게시는 Phase 7에서 제공됩니다"
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
