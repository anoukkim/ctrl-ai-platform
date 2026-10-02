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
 *
 * **빈 자리는 비워 두지 않습니다.** 기능도 화면도 기록도 없는 앱은 실제로
 * 있습니다(방금 게시한 앱). 그 자리를 아무것도 없이 두면 화면이 고장 난
 * 것처럼 보이므로, 왜 비어 있는지 한 줄로 적습니다.
 */

import {
  Bell,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  ListChecks,
  PenLine,
  Repeat,
  Search,
  Share2,
  ShoppingCart,
  Sparkles,
  Tags,
  Users,
  Vote,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  CommentSection,
  ReactionChips,
  TabBar,
  useCommentThread,
} from "@/app/components/CommentSection";
import {
  formatDate,
  lastUpdated,
  type App,
  type AppFeatureIcon,
  type AppScreenshot,
} from "@/lib/mock-data";

import styles from "../ctrlaistore.module.css";

type Tab = "about" | "comments" | "updates";

/** 기능 카드의 아이콘. 데이터 파일은 이름만 들고 있고, 이름을 아이콘으로
 *  바꾸는 일은 화면이 합니다 — `AppFeatureIcon`을 키로 썼으므로 데이터에만
 *  새 이름을 넣으면 `tsc`가 여기서 빠진 것을 알려 줍니다. */
const FEATURE_ICON: Record<AppFeatureIcon, LucideIcon> = {
  checklist: ListChecks,
  chart: ChartColumn,
  calendar: CalendarDays,
  link: Link2,
  share: Share2,
  people: Users,
  bell: Bell,
  search: Search,
  sparkle: Sparkles,
  clock: Clock,
  note: FileText,
  cart: ShoppingCart,
  repeat: Repeat,
  pen: PenLine,
  tag: Tags,
  vote: Vote,
};

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
/* 비어 있을 때                                                         */
/* ------------------------------------------------------------------ */

/** 아직 아무것도 없는 칸. 빈 상자보다 한 줄이 낫습니다 — 비어 있는 것과
 *  고장 난 것은 화면에서 똑같이 생겼기 때문입니다. */
function Empty({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <p className={styles.empty}>
      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* 소개                                                                */
/* ------------------------------------------------------------------ */

function About({ app }: { app: App }) {
  const updated = lastUpdated(app);
  /** 크게 열어 둔 화면. 없으면 닫혀 있습니다. */
  const [zoomed, setZoomed] = useState<AppScreenshot | null>(null);

  return (
    <div className={styles.about}>
      {/* 읽는 글이라 한 줄의 길이를 제한합니다. 넓은 화면에서 끝까지
          늘어난 문장은 다음 줄의 첫 글자를 찾기가 어렵습니다. */}
      <p className={styles.description}>{app.description}</p>

      <section className={styles.aboutBlock}>
        <h2 className={styles.blockTitle}>주요 기능</h2>
        {app.features.length > 0 ? (
          <ul className={styles.features}>
            {app.features.map((feature) => {
              const Icon = FEATURE_ICON[feature.icon];
              return (
                <li className={styles.feature} key={feature.title}>
                  <span className={styles.featureIcon} aria-hidden="true">
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <span className={styles.featureText}>
                    <span className={styles.featureTitle}>{feature.title}</span>
                    <span className={styles.featureNote}>{feature.description}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon={LayoutGrid}>만든 사람이 아직 기능 설명을 올리지 않았습니다.</Empty>
        )}
      </section>

      {/* 화면 모음.
       *
       * 한 줄로 두고 좁을 때는 옆으로 밉니다 — 본문 전체가 옆으로 밀리면
       * 안 되지만, 그림 줄 하나가 밀리는 것은 괜찮습니다. 세로로 쌓으면
       * 화면 넷이 자세히를 한참 아래로 밀어냅니다. */}
      <section className={styles.aboutBlock}>
        <h2 className={styles.blockTitle}>스크린샷</h2>
        {app.screenshots.length > 0 ? (
          <>
            <ul className={styles.gallery}>
              {app.screenshots.map((shot) => (
                <li className={styles.shot} key={shot.label}>
                  <button
                    className={styles.shotButton}
                    type="button"
                    onClick={() => setZoomed(shot)}
                  >
                    <span
                      className={styles.shotArt}
                      style={{
                        background: `linear-gradient(140deg, ${shot.artwork[0]}, ${shot.artwork[1]})`,
                      }}
                      aria-hidden="true"
                    />
                    <span className={styles.shotLabel}>{shot.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className={styles.galleryNote}>화면은 아직 예시입니다.</p>
          </>
        ) : (
          <Empty icon={ImageIcon}>아직 올라온 화면이 없습니다.</Empty>
        )}
      </section>

      {/* 자주 보지 않는 사실들. 예전의 큰 표가 하던 일을 접힌 채로 합니다. */}
      <details className={styles.details}>
        <summary className={styles.detailsSummary}>
          <span>자세히</span>
          <ChevronDown className={styles.chevron} size={15} aria-hidden="true" />
        </summary>
        <dl className={styles.detailsBody}>
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>저장소</dt>
            <dd className={styles.detailValue}>
              {app.githubRepo ? (
                <span className={styles.detailLink}>
                  {app.githubRepo}
                  {/* Phase 4 전에는 연결된 곳이 없어 링크로 만들지
                      않습니다. 아이콘만으로 바깥 주소라는 것은 보입니다. */}
                  <ExternalLink size={13} aria-hidden="true" />
                </span>
              ) : (
                <span className={styles.detailDim}>공개하지 않음</span>
              )}
            </dd>
          </div>
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>실행 주소</dt>
            <dd className={styles.detailValue}>
              {app.launchUrl ?? <span className={styles.detailDim}>아직 없습니다</span>}
            </dd>
          </div>
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>마지막 업데이트</dt>
            <dd className={`${styles.detailValue} ${styles.detailDate}`}>
              {updated ? (
                formatDate(updated)
              ) : (
                <span className={styles.detailDim}>기록이 없습니다</span>
              )}
            </dd>
          </div>
          <div className={styles.detailRow}>
            <dt className={styles.detailLabel}>분류</dt>
            <dd className={styles.detailValue}>{app.category}</dd>
          </div>
        </dl>
      </details>

      {zoomed && <Lightbox shot={zoomed} onClose={() => setZoomed(null)} />}
    </div>
  );
}

/**
 * 화면 하나를 크게 보는 겹침창.
 *
 * `<dialog>`의 `showModal()`은 jsdom에 없어 테스트에서 열리지 않습니다.
 * 직접 그린 겹침창이라 닫는 길을 셋 다 열어 둡니다 — 닫기 단추, 바탕
 * 누르기, Esc.
 */
function Lightbox({ shot, onClose }: { shot: AppScreenshot; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={styles.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={shot.label}
      onClick={onClose}
    >
      {/* 그림 위를 눌렀을 때까지 닫히면 실수로 닫는 일이 잦습니다. */}
      <div className={styles.lightboxInner} onClick={(event) => event.stopPropagation()}>
        <div
          className={styles.lightboxArt}
          style={{
            background: `linear-gradient(140deg, ${shot.artwork[0]}, ${shot.artwork[1]})`,
          }}
          aria-hidden="true"
        />
        <p className={styles.lightboxLabel}>{shot.label}</p>
      </div>
      <button className={styles.lightboxClose} type="button" onClick={onClose} aria-label="닫기">
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 업데이트 기록                                                        */
/* ------------------------------------------------------------------ */

/**
 * 세로 타임라인.
 *
 * 예전에는 날짜와 글이 한 줄에 붙어 흘렀습니다. 판 번호 · 날짜 · 제목 ·
 * 바뀐 것들을 세로줄 하나에 꿰면 어디까지가 한 판인지가 눈으로 끊깁니다.
 * 맨 위 하나에만 "최신"을 답니다 — 목록이 최신순이므로 그 자리는 언제나
 * 첫 줄입니다.
 */
function Updates({ app }: { app: App }) {
  if (app.updates.length === 0) {
    return (
      <div className={styles.updatesPane}>
        <Empty icon={Clock}>아직 업데이트 기록이 없습니다.</Empty>
      </div>
    );
  }

  return (
    <div className={styles.updatesPane}>
      <ol className={styles.timeline}>
        {app.updates.map((update, index) => (
          <li className={styles.entry} key={update.version + update.date}>
            <span className={styles.entryDot} aria-hidden="true" />
            <p className={styles.entryHead}>
              <span className={styles.entryVersion}>{update.version}</span>
              <span className={styles.entryDate}>{formatDate(update.date)}</span>
              {index === 0 && <span className={styles.entryLatest}>최신</span>}
            </p>
            <p className={styles.entryTitle}>{update.title}</p>
            <ul className={styles.entryChanges}>
              {update.changes.map((change) => (
                <li className={styles.entryChange} key={change}>
                  <Check size={13} strokeWidth={2} aria-hidden="true" />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className={styles.mockNote}>
        업데이트 기록은 아직 예시입니다. Phase 5에서 게시할 때마다 쌓입니다.
      </p>
    </div>
  );
}
