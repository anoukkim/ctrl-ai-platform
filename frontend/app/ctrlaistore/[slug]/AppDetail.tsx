"use client";

/**
 * 게시된 앱 하나 (ctrlaiapps-publish → ui-improvements, owner-polish 15).
 *
 * 머리 줄 하나: 작은 썸네일 · 이름 · 만든 사람 · "v5 · 3일 전 업데이트" ·
 * 업데이트 메모, 오른쪽에 **새 창에서 열기**와 **신고**. 설명은 한 줄로
 * 접혀 있고 "더 보기"로 펼칩니다. 그 아래가 바로 앱 — 첫 화면의 대부분을
 * 차지하고(390px에서도), CTRL+AI와 분리된 샌드박스 프레임 안에서
 * 돌아갑니다. 예전의 큰 색 블록과 중복 "앱 실행" 단추는 없습니다.
 *
 * 안내는 앱마다 사실대로: 게시된 버전의 ctrlai.json이 공유 목록을 선언하면
 * "이 앱의 공유 글은 다른 회원도 볼 수 있어요"라고 말합니다.
 */

import { ExternalLink, Flag } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import Skeleton from "@/app/components/Skeleton";
import { useToast } from "@/app/components/ToastProvider";
import { getApp, reportApp, type AppListing } from "@/lib/apps";
import { describeError } from "@/lib/http";
import { RUNTIME_SANDBOX } from "@/lib/static-preview";

import { AppThumbnail } from "../AppThumbnail";
import { versionLine } from "../AppCard";
import styles from "../ctrlaistore.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; app: AppListing }
  | { phase: "error"; message: string };

export const HONEST_NOTE =
  "이 앱은 방문한 사람의 브라우저에서 돌아가요. 로그인·AI·공유 목록은 내가 허용한 뒤에만 쓰고, AI는 내 지원금에서 나가요 — 버튼을 눌렀을 때만.";

export const SHARED_NOTE =
  "이 앱은 방문한 사람의 브라우저에서 돌아가요. 이 앱의 공유 글은 다른 회원도 볼 수 있어요. 로그인·AI는 내가 허용한 뒤에만 쓰고, AI는 내 지원금에서 나가요 — 버튼을 눌렀을 때만.";

/** 설명이 이 길이를 넘으면 접어 둡니다 — 한 줄이면 접을 것이 없습니다. */
const FOLD_AFTER = 80;

export function honestNote(app: Pick<AppListing, "shared_lists">): string {
  return app.shared_lists ? SHARED_NOTE : HONEST_NOTE;
}

/** app-ai-access: AI를 쓰는 앱에만 한 줄 더 — 만든 사람이 AI를 어떻게 열었는지. */
export const AI_DEMO_NOTE = "이 앱의 AI는 데모로만 열려 있어요 — AI를 부르지 않고, 아무것도 나가지 않아요.";
export const AI_FULL_NOTE =
  "이 앱의 AI는 전체 기능이에요 — 로그인한 회원이 버튼을 누를 때만 자기 지원금에서 나가요. 앱 왼쪽 아래 스위치로 언제든 데모로 볼 수 있어요.";

export function aiNote(app: Pick<AppListing, "uses_ai" | "ai_access">): string | null {
  if (!app.uses_ai) return null;
  return app.ai_access === "full" ? AI_FULL_NOTE : AI_DEMO_NOTE;
}

export default function AppDetail({ slug }: { slug: string }) {
  const toast = useToast();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();

  useEffect(() => {
    getApp(slug)
      .then((app) => setState({ phase: "ready", app }))
      .catch((error: unknown) => setState({ phase: "error", message: describeError(error) }));
  }, [slug]);

  if (state.phase === "loading") return <Skeleton label="앱을 불러오는 중…" />;
  if (state.phase === "error") {
    return (
      <>
        <Link className={styles.back} href="/ctrlaistore">
          ← CtrlAIApps
        </Link>
        <p className="small muted" role="alert">
          {state.message}. 게시가 취소되었거나 주소가 바뀌었을 수 있어요.
        </p>
      </>
    );
  }

  const { app } = state;
  const foldable = app.description.length > FOLD_AFTER;

  const sendReport = async () => {
    setSending(true);
    setReportError(null);
    try {
      const result = await reportApp(app.slug, reason.trim());
      toast.show(result.detail);
      setReporting(false);
      setReason("");
    } catch (error) {
      setReportError(describeError(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Link className={styles.back} href="/ctrlaistore">
        ← CtrlAIApps
      </Link>

      <header className={styles.head}>
        <div className={styles.headThumb}>
          <AppThumbnail app={app} size="small" />
        </div>

        <div className={styles.headText}>
          <h1 className={`page-title ${styles.headTitle}`}>{app.name}</h1>
          <p className={styles.headMeta}>
            <span className={styles.creator}>
              <span className={styles.creatorAvatar} aria-hidden="true">
                {app.author_name.slice(0, 1)}
              </span>
              <span className={styles.creatorName}>{app.author_name}</span>
            </span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{versionLine(app)}</span>
            {app.publish_note && (
              <>
                <span className={styles.metaDot} aria-hidden="true">
                  ·
                </span>
                <span className={styles.headNote}>{app.publish_note}</span>
              </>
            )}
          </p>
        </div>

        <div className={styles.headActions}>
          {app.app_url ? (
            <a
              className="btn btn-sm"
              href={app.app_url}
              target="_blank"
              rel="noopener noreferrer"
              title="앱을 새 창에서 크게 열어요"
            >
              <ExternalLink size={14} aria-hidden="true" />
              새 창에서 열기
            </a>
          ) : (
            <span className={`badge ${styles.headOffline}`} title="앱 서버가 잠시 꺼져 있어요">
              실행 준비 중
            </span>
          )}
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => setReporting((open) => !open)}
            aria-expanded={reporting}
          >
            <Flag size={14} aria-hidden="true" />
            신고하기
          </button>
        </div>
      </header>

      <p
        className={`${styles.description} ${foldable && !expanded ? styles.descriptionFolded : ""}`}
        id={descriptionId}
      >
        {app.description}
      </p>
      {foldable && (
        <button
          className={styles.descriptionToggle}
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={descriptionId}
        >
          {expanded ? "설명 접기" : "설명 더 보기"}
        </button>
      )}

      {reporting && (
        <div className={styles.reportBox}>
          <label htmlFor="report-reason">무엇이 문제인가요? 관리자만 볼 수 있어요.</label>
          <textarea
            id="report-reason"
            className="field"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="예: 비밀번호를 입력하라는 화면이 있어요"
            autoFocus
          />
          {reportError && (
            <p className="small" role="alert">
              {reportError}
            </p>
          )}
          <div className={styles.actions}>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => void sendReport()}
              disabled={sending || !reason.trim()}
            >
              {sending ? "보내는 중…" : "신고 보내기"}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setReporting(false)}>
              취소
            </button>
          </div>
        </div>
      )}

      {app.app_url ? (
        <section className={styles.livePreview} aria-label="앱">
          <div className={styles.livePreviewBar}>
            여기서 바로 써 볼 수 있어요 · 비밀번호나 개인 정보는 입력하지 마세요
          </div>
          <iframe
            className={styles.livePreviewFrame}
            src={app.app_url}
            sandbox={RUNTIME_SANDBOX}
            title={app.name}
            referrerPolicy="no-referrer"
          />
        </section>
      ) : (
        <section className={styles.livePreview} aria-label="앱">
          <p className={styles.livePreviewOffline}>앱 서버가 잠시 꺼져 있어요. 잠시 뒤 다시 열어 주세요.</p>
        </section>
      )}

      <p className={styles.honest}>{honestNote(app)}</p>
      {aiNote(app) && (
        <p className={styles.honest} data-testid="ai-access-note">
          {aiNote(app)}
        </p>
      )}
    </>
  );
}
