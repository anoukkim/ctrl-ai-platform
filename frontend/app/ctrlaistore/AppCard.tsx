/**
 * 게시된 앱 카드 하나 — CtrlAIApps 목록과 Profile › 내가 만든 앱이 같은
 * 카드를 씁니다 (owner-polish 3). 이름 · 짧은 설명 · 만든 사람 ·
 * "v5 · 3일 전 업데이트" · 업데이트 메모(있으면).
 */

import Link from "next/link";

import { coverTint, type AppListing } from "@/lib/apps";
import { relativeTime } from "@/lib/relative-time";

import styles from "./ctrlaistore.module.css";

/** "v5 · 3일 전 업데이트" */
export function versionLine(app: AppListing): string {
  const when = app.published_at ? `${relativeTime(app.published_at)} 업데이트` : "";
  return [`v${app.version_number}`, when].filter(Boolean).join(" · ");
}

export default function AppCard({ app }: { app: AppListing }) {
  return (
    <Link className={styles.card} href={`/ctrlaistore/${app.slug}`}>
      <div className={styles.artwork} style={{ background: coverTint(app.slug) }}>
        <span className={styles.artworkText} aria-hidden="true">
          {app.name}
        </span>
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>{app.name}</h2>
        <p className={styles.tagline}>{app.description}</p>
        <p className={styles.meta}>
          <span className={styles.metaItem}>{app.author_name}</span>
          <span className={`${styles.metaItem} ${styles.metaDate}`}>{versionLine(app)}</span>
        </p>
        {app.publish_note && <p className={styles.note}>{app.publish_note}</p>}
      </div>
    </Link>
  );
}
