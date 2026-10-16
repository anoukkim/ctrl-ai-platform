"use client";

/**
 * 게시된 앱 하나 (ctrlaiapps-publish).
 *
 * 히어로: 표지 · 이름 · 설명 · 만든 사람 · "v5 · 3일 전 업데이트" · 업데이트
 * 메모, 그리고 주된 버튼 **앱 실행**(새 창) 하나. 아래에는 같은 앱을 이
 * 화면 안에서 바로 써 볼 수 있는 미리보기 — 앱 주소를 그대로, CTRL+AI와
 * 분리된 샌드박스 프레임 안에서 띄웁니다. 맨 아래 신고.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import Skeleton from "@/app/components/Skeleton";
import { useToast } from "@/app/components/ToastProvider";
import { coverTint, getApp, reportApp, type AppListing } from "@/lib/apps";
import { describeError } from "@/lib/http";
import { RUNTIME_SANDBOX } from "@/lib/static-preview";

import { versionLine } from "../AppCard";
import styles from "../ctrlaistore.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; app: AppListing }
  | { phase: "error"; message: string };

export const HONEST_NOTE =
  "이 앱은 방문한 사람의 브라우저에서 돌아가요. 로그인·AI·공유 목록은 내가 허용한 뒤에만 쓰고, AI는 내 지원금에서 나가요 — 버튼을 눌렀을 때만.";

export default function AppDetail({ slug }: { slug: string }) {
  const toast = useToast();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

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

      <div className={styles.hero}>
        <div
          className={styles.heroArtwork}
          style={{ background: coverTint(app.slug) }}
          aria-hidden="true"
        >
          <span className={styles.artworkText}>{app.name}</span>
        </div>

        <div className={styles.heroMeta}>
          <h1 className="page-title">{app.name}</h1>
          <p className={styles.heroTagline}>{app.description}</p>
          <p className={styles.creator}>
            <span className={styles.creatorAvatar} aria-hidden="true">
              {app.author_name.slice(0, 1)}
            </span>
            <span className={styles.creatorName}>{app.author_name}</span>
          </p>
          <p className={styles.metaLine}>
            <span>{versionLine(app)}</span>
            {app.publish_note && (
              <>
                <span className={styles.metaDot} aria-hidden="true">
                  ·
                </span>
                <span>{app.publish_note}</span>
              </>
            )}
          </p>

          <div className={styles.actions}>
            {app.app_url ? (
              <a className="btn btn-primary" href={app.app_url} target="_blank" rel="noopener noreferrer">
                앱 실행
              </a>
            ) : (
              <button className="btn btn-primary" type="button" disabled title="앱 서버가 잠시 꺼져 있어요">
                실행 준비 중
              </button>
            )}
          </div>
          <p className={styles.honest}>{HONEST_NOTE}</p>
        </div>
      </div>

      {app.app_url && (
        <section className={styles.livePreview} aria-label="앱 미리보기">
          <div className={styles.livePreviewBar}>
            여기서 바로 써 볼 수 있어요 · 비밀번호나 개인 정보는 입력하지 마세요
          </div>
          <iframe
            className={styles.livePreviewFrame}
            src={app.app_url}
            sandbox={RUNTIME_SANDBOX}
            title={`${app.name} 미리보기`}
            referrerPolicy="no-referrer"
          />
        </section>
      )}

      <section className={styles.honest}>
        {reporting ? (
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
        ) : (
          <button className="btn btn-sm" type="button" onClick={() => setReporting(true)}>
            신고하기
          </button>
        )}
      </section>
    </>
  );
}
