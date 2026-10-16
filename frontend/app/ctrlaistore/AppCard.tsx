"use client";

/**
 * 게시된 앱 카드 하나 — CtrlAIApps 목록이 씁니다 (owner-polish 3 → ui-improvements).
 * 썸네일 · 이름 · 짧은 설명 · 만든 사람 · "v5 · 3일 전 업데이트" · 업데이트
 * 메모(있으면), 그리고 모서리의 **즐겨찾기(★)**.
 *
 * 카드는 링크가 아닙니다 — 링크 안에 단추를 둘 수 없으니, 카드를 덮는
 * 링크를 깔고 ★만 그 위에 올립니다(LibraryCard와 같은 짜임).
 */

import { Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { AppListing } from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";

import { AppThumbnail } from "./AppThumbnail";
import styles from "./ctrlaistore.module.css";

/** "v5 · 3일 전 업데이트" */
export function versionLine(app: AppListing): string {
  const when = app.published_at ? `${relativeTime(app.published_at)} 업데이트` : "";
  return [`v${app.version_number}`, when].filter(Boolean).join(" · ");
}

interface Props {
  app: AppListing;
  /** 거절되면 throw. 주어지지 않으면 ★가 없습니다(예: 관리자 화면). */
  onFavorite?: (on: boolean) => Promise<void>;
}

export default function AppCard({ app, onFavorite }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (!onFavorite) return;
    setBusy(true);
    setError(null);
    try {
      await onFavorite(!app.favorite);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={styles.card} data-testid="app-card">
      <Link aria-label={app.name} className={styles.cardLink} href={`/ctrlaistore/${app.slug}`} />
      <AppThumbnail app={app} />
      {onFavorite && (
        <button
          aria-label={app.favorite ? `${app.name} 즐겨찾기 해제` : `${app.name} 즐겨찾기`}
          aria-pressed={app.favorite}
          className={`${styles.favorite} ${app.favorite ? styles.favoriteOn : ""}`}
          disabled={busy}
          onClick={() => void toggle()}
          title={app.favorite ? "즐겨찾기 해제" : "즐겨찾기 — 내 목록 맨 앞에"}
          type="button"
        >
          <Star size={16} fill={app.favorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      )}
      <div className={styles.body}>
        <h2 className={styles.name}>{app.name}</h2>
        <p className={styles.tagline}>{app.description}</p>
        {error && (
          <p className="small" role="alert">
            {error}
          </p>
        )}
        <p className={styles.meta}>
          <span className={styles.metaItem}>{app.author_name}</span>
          <span className={`${styles.metaItem} ${styles.metaDate}`}>{versionLine(app)}</span>
        </p>
        {app.publish_note && <p className={styles.note}>{app.publish_note}</p>}
      </div>
    </article>
  );
}
