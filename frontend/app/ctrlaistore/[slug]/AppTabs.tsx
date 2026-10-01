"use client";

/**
 * 히어로 아래의 세 탭 — 소개 · 댓글 · 업데이트 기록.
 *
 * 세 가지를 한 화면에 모두 쌓아 두면 긴 설명과 화면 모음이 댓글을 아래로
 * 밀어냅니다. 탭으로 가르면 어느 것을 보려 해도 스크롤이 같은 자리에서
 * 시작합니다.
 *
 * 반응 칩과 댓글칸은 CtrlAITube 재생 화면과 **같은 컴포넌트**입니다
 * (`components/CommentSection.tsx`). 커뮤니티의 두 화면에서 댓글이 서로
 * 다르게 움직이면, 한쪽에서 익힌 것이 다른 쪽에서 통하지 않습니다.
 *
 * 댓글 수를 `useCommentThread`에서 받아 탭 이름에 적습니다 — 댓글을 하나
 * 쓰면 목록과 탭의 수가 함께 늘어납니다.
 */

import { useState } from "react";

import {
  CommentSection,
  ReactionChips,
  TabBar,
  useCommentThread,
} from "@/app/components/CommentSection";
import { formatDate, lastUpdated, type App } from "@/lib/mock-data";

import styles from "../ctrlaistore.module.css";

type Tab = "about" | "comments" | "updates";

export default function AppTabs({ app }: { app: App }) {
  const [tab, setTab] = useState<Tab>("about");
  const thread = useCommentThread(app.comments);

  return (
    <div className={styles.tabWrap}>
      <TabBar
        label="앱 정보"
        current={tab}
        onChange={(key) => setTab(key as Tab)}
        tabs={[
          { key: "about", name: "소개" },
          { key: "comments", name: `댓글 ${thread.count}` },
          { key: "updates", name: "업데이트 기록" },
        ]}
      />

      <div className={styles.tabPanel}>
        {tab === "about" && <About app={app} />}

        {tab === "comments" && (
          <>
            <ReactionChips reactions={app.reactions} />
            <CommentSection thread={thread} />
          </>
        )}

        {tab === "updates" && <Updates app={app} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 소개                                                                */
/* ------------------------------------------------------------------ */

function About({ app }: { app: App }) {
  const updated = lastUpdated(app);

  return (
    <div className={styles.about}>
      <p className={styles.description}>{app.description}</p>

      {/* 화면 모음. 아직 그림이 없어 색과 설명으로 자리를 잡아 둡니다 —
          실제 스크린샷은 Phase 5에서 올라갑니다. 좁은 화면에서는 이 줄만
          옆으로 밀립니다. */}
      {app.screenshots.length > 0 && (
        <div>
          <div className={styles.gallery} role="group" aria-label="앱 화면">
            {app.screenshots.map((shot) => (
              <figure className={styles.shot} key={shot.label}>
                <div
                  className={styles.shotArt}
                  style={{
                    background: `linear-gradient(140deg, ${shot.artwork[0]}, ${shot.artwork[1]})`,
                  }}
                  aria-hidden="true"
                />
                <figcaption className={styles.shotLabel}>{shot.label}</figcaption>
              </figure>
            ))}
          </div>
          <p className={styles.galleryNote}>화면은 아직 예시입니다.</p>
        </div>
      )}

      {/* 자주 보지 않는 사실들. 예전의 큰 표가 하던 일을 접힌 채로 합니다. */}
      <details className={styles.details}>
        <summary className={styles.detailsSummary}>자세히</summary>
        <div className={styles.detailsBody}>
          <p className={styles.detailRow}>
            <span className={styles.detailLabel}>저장소</span>
            <span>{app.githubRepo ?? "공개하지 않음"}</span>
          </p>
          <p className={styles.detailRow}>
            <span className={styles.detailLabel}>실행 주소</span>
            <span>{app.launchUrl ?? "아직 없습니다"}</span>
          </p>
          <p className={styles.detailRow}>
            <span className={styles.detailLabel}>마지막 수정</span>
            <span>{updated ? formatDate(updated) : "기록이 없습니다"}</span>
          </p>
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 업데이트 기록                                                        */
/* ------------------------------------------------------------------ */

function Updates({ app }: { app: App }) {
  if (app.updates.length === 0) {
    return <p className={styles.updatesEmpty}>아직 업데이트 기록이 없습니다.</p>;
  }

  return (
    <div className={styles.updatesPane}>
      <ol className={styles.updates}>
        {app.updates.map((update) => (
          <li className={styles.update} key={update.date + update.note}>
            <span className={styles.updateDate}>{formatDate(update.date)}</span>
            <span className={styles.updateNote}>{update.note}</span>
          </li>
        ))}
      </ol>
      <p className={styles.mockNote}>
        업데이트 기록은 아직 예시입니다. Phase 5에서 게시할 때마다 쌓입니다.
      </p>
    </div>
  );
}
