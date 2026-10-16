"use client";

/**
 * Profile › 내가 만든 앱 — 내가 CtrlAIApps에 게시한 앱 (owner-polish 3 →
 * ui-improvements).
 *
 * "내 프로젝트"처럼 **간단한 목록**입니다: 이름 · 게시 버전 · 업데이트 시각 ·
 * 열기. 큰 이미지 카드는 두지 않습니다 — "그냥 목록으로만, 이미지 넣으면
 * 너무 많아짐" (owner, 2026-10-16). `GET /api/apps/mine`을 읽으므로 다른
 * 사람의 앱은 절대 섞이지 않습니다.
 */

import { ExternalLink, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import EmptyState from "@/app/components/EmptyState";
import Skeleton from "@/app/components/Skeleton";
import { listMyApps, type AppListing } from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";

import styles from "./profile.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; apps: AppListing[] }
  | { phase: "error"; message: string };

export default function MyAppsSection() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    listMyApps()
      .then((apps) => {
        if (!cancelled) setState({ phase: "ready", apps });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card" aria-labelledby="my-apps-title">
      <h2 className="section-title" id="my-apps-title">
        내가 만든 앱
        {state.phase === "ready" && <span className="badge badge-muted">{state.apps.length}개</span>}
      </h2>

      {state.phase === "loading" && <Skeleton label="게시한 앱을 불러오는 중…" />}

      {state.phase === "error" && (
        <p className="small muted" role="alert">
          게시한 앱을 불러오지 못했습니다. {state.message}.
        </p>
      )}

      {state.phase === "ready" && state.apps.length === 0 && (
        <EmptyState
          compact
          icon={LayoutGrid}
          title="아직 게시한 앱이 없어요"
          text="Project Builder에서 만든 앱을 'CtrlAIApps에 게시'하면 여기에 모여요."
          action={{ label: "앱 만들러 가기", href: "/builder" }}
        />
      )}

      {state.phase === "ready" && state.apps.length > 0 && (
        <ul className={styles.list} data-testid="my-apps-list">
          {state.apps.map((app) => (
            <li className={styles.listItem} key={app.id}>
              <Link className={styles.listLink} href={`/ctrlaistore/${app.slug}`}>
                {app.name}
              </Link>
              <span className={styles.listMeta}>
                <span className="badge badge-muted">v{app.version_number}</span>
                {app.published_at && (
                  <span className="small dim">{relativeTime(app.published_at)} 업데이트</span>
                )}
                {app.app_url && (
                  <a
                    className={styles.listOpen}
                    href={app.app_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${app.name} 열기`}
                    title="새 창에서 열기"
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    열기
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
