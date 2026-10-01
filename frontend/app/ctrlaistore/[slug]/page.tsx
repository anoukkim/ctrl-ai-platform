/**
 * 앱 상세 화면.
 *
 * 맨 위는 **히어로** 한 덩어리입니다 — 왼쪽에 대표 그림, 오른쪽에 이름,
 * 한 줄 소개, 만든 사람, 그리고 분류 · 게시일 · 반응 수 한 줄. 예전에는
 * 네 줄짜리 표가 이 자리에서 분류와 게시일과 저장소와 실행 주소를 모두
 * 같은 무게로 보여 줬습니다. 네 줄 중 둘은 거의 보지 않는 것이라, 정작
 * 먼저 읽어야 할 이름과 만든 사람이 묻혔습니다. 자주 보지 않는 둘은
 * "자세히" 안으로 들어갔습니다.
 *
 * 버튼도 무게를 갈랐습니다. **앱 실행 하나만 주된 버튼**입니다. 예전에는
 * 앱 실행 · 개발자 보기 · GitHub에서 보기가 모두 같은 크기로 나란히
 * 있었고, 그중 둘은 눌러도 아무 일이 없었습니다. 개발자 보기는 없어졌고
 * — 만든 사람의 이름이 그 자리를 합니다 — GitHub은 작은 보조 버튼으로,
 * 저장소를 공개한 앱에만 나타납니다.
 *
 * App Router에서 `params`는 Promise이므로 값을 읽기 전에 await 해야 합니다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MEMBERSHIP_LABEL,
  MOCK_APPS,
  findApp,
  formatDate,
  otherAppsBy,
  totalReactions,
} from "@/lib/mock-data";
import { MEMBERSHIP_BADGE } from "@/lib/quarters";

import styles from "../ctrlaistore.module.css";
import AppTabs from "./AppTabs";

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

  const others = otherAppsBy(app.creator.username, app.slug);

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
          <span className={styles.artworkText}>{app.name}</span>
        </div>

        <div className={styles.heroMeta}>
          <h1 className="page-title">
            {app.name} <span className="badge badge-mock">준비 중</span>
          </h1>
          <p className={styles.heroTagline}>{app.tagline}</p>

          {/*
           * 만든 사람.
           *
           * 커뮤니티를 떠난 회원의 앱에도 이름과 꼬리표가 그대로 남습니다.
           * 꼬리표만으로 충분하므로 "이번 분기에 참여 중이며…" 같은 설명
           * 문장은 두지 않습니다 — 보는 사람이 알아야 할 것은 이 앱을 누가
           * 만들었는지이고, 그 사람의 분기 사정이 아닙니다.
           *
           * 회원 프로필 화면이 아직 없어 이름은 아직 링크가 아닙니다.
           */}
          <p className={styles.creator}>
            <span className={styles.creatorAvatar} aria-hidden="true">
              {app.creator.displayName.slice(0, 1)}
            </span>
            <span className={styles.creatorName}>{app.creator.displayName}</span>
            <span className={`badge ${MEMBERSHIP_BADGE[app.creator.membership]}`}>
              {MEMBERSHIP_LABEL[app.creator.membership]}
            </span>
          </p>

          <p className={styles.metaLine}>
            <span>{app.category}</span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>{formatDate(app.publishedAt)}</span>
            <span className={styles.metaDot} aria-hidden="true">
              ·
            </span>
            <span>반응 {totalReactions(app.reactions)}</span>
          </p>

          <div className={styles.actions}>
            {app.launchUrl ? (
              <a
                className="btn btn-primary"
                href={app.launchUrl}
                target="_blank"
                rel="noreferrer"
              >
                앱 실행
              </a>
            ) : (
              /* 주소가 없으면 누를 것이 없습니다. 눌릴 것처럼 보이는
                 버튼보다, 왜 못 누르는지 적힌 버튼이 낫습니다. */
              <button
                className="btn btn-primary"
                type="button"
                disabled
                title="만든 사람이 아직 실행 주소를 올리지 않았습니다. 안전한 실행 환경이 준비되면 이 자리에서 열립니다."
              >
                실행 준비 중
              </button>
            )}

            {/* 저장소를 공개한 앱에만 나타납니다. 실제 연결은 Phase 4입니다. */}
            {app.githubRepo ? (
              <button
                className="btn btn-sm"
                type="button"
                disabled
                title="GitHub 연결은 Phase 4에서 제공됩니다"
              >
                GitHub에서 보기
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <AppTabs app={app} />

      {others.length > 0 && (
        <section className={styles.others}>
          <h2 className="section-title">{app.creator.displayName}의 다른 앱</h2>
          <div className={styles.othersGrid}>
            {others.map((other) => (
              <Link className={styles.card} href={`/ctrlaistore/${other.slug}`} key={other.slug}>
                <div
                  className={styles.artwork}
                  style={{
                    background: `linear-gradient(140deg, ${other.artwork[0]}, ${other.artwork[1]})`,
                  }}
                >
                  <span className={styles.artworkText} aria-hidden="true">
                    {other.name}
                  </span>
                </div>
                <div className={styles.body}>
                  <h3 className={styles.name}>{other.name}</h3>
                  <p className={styles.tagline}>{other.tagline}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
