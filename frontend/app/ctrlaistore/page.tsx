/**
 * CtrlAIStore — 회원들이 만든 앱을 모아 보는 곳.
 *
 * Project Builder의 프로젝트는 혼자 작업하는 공간이고, 여기에 올라온
 * 앱은 커뮤니티에 공개된 결과물입니다.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { CreatorLine } from "@/app/components/Community";
import { MOCK_APPS, totalReactions } from "@/lib/mock-data";

import styles from "./ctrlaistore.module.css";

export const metadata: Metadata = {
  title: "CtrlAI Apps — Ctrl AI",
};

export default function CtrlAIStorePage() {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">
          CtrlAI Apps <span className="badge badge-mock">준비 중</span>
        </h1>
        <p className="page-subtitle">
          회원들이 Project Builder로 만들어 게시한 앱입니다. 만든 사람이 이번 시즌에
          참여하지 않더라도 앱은 그대로 남아 있습니다.
        </p>
        <span className="badge badge-muted">{MOCK_APPS.length}개</span>
      </header>

      <div className={styles.grid}>
        {MOCK_APPS.map((app) => (
          <Link className={styles.card} href={`/ctrlaistore/${app.slug}`} key={app.slug}>
            <div
              className={styles.artwork}
              style={{
                background: `linear-gradient(140deg, ${app.artwork[0]}, ${app.artwork[1]})`,
              }}
            >
              <span className={styles.category}>{app.category}</span>
              <span className={styles.artworkText} aria-hidden="true">
                {app.name}
              </span>
            </div>
            <div className={styles.body}>
              <h2 className={styles.name}>{app.name}</h2>
              <p className={styles.tagline}>{app.tagline}</p>
              <CreatorLine creator={app.creator} />
              <p className={styles.meta}>
                <span className={styles.metaItem}>♥ {totalReactions(app.reactions)}</span>
                <span className={styles.metaItem}>💬 {app.comments.length}</span>
                <span className={styles.metaItem}>{app.publishedAt}</span>
              </p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
