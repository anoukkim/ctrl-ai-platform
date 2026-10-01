/**
 * 앱 상세 화면.
 *
 * App Router에서 `params`는 Promise이므로 값을 읽기 전에 await 해야 합니다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentThread, CreatorLine, Reactions } from "@/app/components/Community";
import { MEMBERSHIP_DESCRIPTION, MOCK_APPS, findApp } from "@/lib/mock-data";

import styles from "../ctrlaistore.module.css";

interface AppDetailProps {
  params: Promise<{ slug: string }>;
}

/** 목업 앱마다 한 페이지씩 미리 만들어 둡니다. */
export function generateStaticParams() {
  return MOCK_APPS.map((app) => ({ slug: app.slug }));
}

export async function generateMetadata({ params }: AppDetailProps): Promise<Metadata> {
  const { slug } = await params;
  const app = findApp(slug);

  return { title: app ? `${app.name} — CTRL+AI` : "앱을 찾을 수 없습니다 — CTRL+AI" };
}

export default async function AppDetailPage({ params }: AppDetailProps) {
  const { slug } = await params;
  const app = findApp(slug);

  if (!app) notFound();

  return (
    <>
      <Link className={styles.back} href="/ctrlaistore">
        ← CtrlAIApps
      </Link>

      <div className={styles.hero}>
        <div
          className={styles.heroArtwork}
          style={{ background: `linear-gradient(140deg, ${app.artwork[0]}, ${app.artwork[1]})` }}
          aria-hidden="true"
        >
          <span style={{ position: "relative", zIndex: 1 }}>{app.name}</span>
        </div>

        <div className={styles.heroMeta}>
          <h1 className="page-title">
            {app.name} <span className="badge badge-mock">준비 중</span>
          </h1>
          <p className="page-subtitle">{app.description}</p>
          <CreatorLine creator={app.creator} prefix="만든 사람" />
          <p className="small muted">{MEMBERSHIP_DESCRIPTION[app.creator.membership]}</p>

          <div className={styles.actions}>
            <button
              className="btn btn-primary"
              type="button"
              disabled
              title="앱 실행은 안전한 실행 환경이 준비된 뒤에 제공됩니다"
            >
              앱 실행
            </button>
            <button className="btn" type="button" disabled title="Phase 1에서 제공됩니다">
              개발자 보기
            </button>
            {app.githubRepo ? (
              <button className="btn" type="button" disabled title="Phase 4에서 제공됩니다">
                GitHub에서 보기
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.detailRows}>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>분류</span>
          <span>{app.category}</span>
        </p>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>게시일</span>
          <span>{app.publishedAt}</span>
        </p>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>저장소</span>
          <span>{app.githubRepo ?? "공개하지 않음"}</span>
        </p>
        <p className={styles.detailRow}>
          <span className={styles.detailLabel}>실행 주소</span>
          <span>{app.launchUrl ?? "아직 없습니다"}</span>
        </p>
      </div>

      <div className={styles.sections}>
        <section>
          <h2 className="section-title">반응</h2>
          <Reactions reactions={app.reactions} />
        </section>

        <section>
          <h2 className="section-title">댓글 {app.comments.length}개</h2>
          <CommentThread comments={app.comments} />
        </section>
      </div>
    </>
  );
}
