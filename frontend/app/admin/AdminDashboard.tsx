"use client";

/**
 * 대시보드의 본문: 할 일 → 구역 카드 → 최근 기록.
 *
 * 순서가 뜻을 담고 있습니다. 위는 "지금 해야 하는 일", 가운데는 "갈 수
 * 있는 곳", 아래는 "방금 무슨 일이 있었는지"입니다. 할 일이 없으면 위
 * 줄은 사라지고 카드가 올라옵니다 — 빈 칸을 지키고 있을 이유가 없습니다.
 */

import Link from "next/link";

import { ACCOUNT_STATUS_LABEL, formatWhen, type AdminDashboard } from "@/lib/admin";
import { MEMBERSHIP_LABEL, formatDate, formatKrw } from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "./AdminQuarterProvider";
import { QuarterBadge } from "./components/StatusBadge";
import { visibleSections, type AdminSection } from "./sections";

import styles from "./admin.module.css";

export default function AdminDashboard() {
  const { selected, dashboard, error } = useAdminQuarter();

  if (error !== null) {
    return (
      <div className="card">
        <p className="small muted">대시보드를 불러오지 못했습니다. {error}.</p>
      </div>
    );
  }

  if (dashboard === null) {
    return <p className="small muted">불러오는 중…</p>;
  }

  const sections = visibleSections(dashboard.is_development).filter(
    (section) => section.key !== "dashboard",
  );

  const todo = [
    {
      key: "quarters",
      href: "/admin/quarters",
      label: "참여 신청",
      count: dashboard.pending_applications,
      waiting: (count: number) => `${count}건이 심사를 기다립니다.`,
    },
    {
      key: "topups",
      href: "/admin/topups",
      label: "충전 신청",
      count: dashboard.pending_top_ups,
      waiting: (count: number) => `${count}건의 입금 확인이 필요합니다.`,
    },
  ];
  const needsAction = todo.filter((item) => item.count > 0);

  return (
    <div className={styles.sections}>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">
          회원, 분기, 지원금을 관리합니다. 제공자 이용 권한은 CTRL+AI가 갖고 회원별 사용량을
          기록하므로, 회원이 직접 API 키를 보관하지 않습니다.
        </p>
      </header>

      {needsAction.length > 0 && (
        <section aria-labelledby="admin-todo">
          <h2 className="section-title" id="admin-todo">
            손이 필요한 일
          </h2>
          <div className={styles.todoRow}>
            {needsAction.map((item) => (
              <Link
                className={styles.todo}
                href={withQuarter(item.href, selected?.id)}
                key={item.key}
              >
                <span className={styles.todoCount}>{item.count}</span>
                <span className={styles.todoText}>
                  <strong>{item.label}</strong>
                  <span className="small dim">{item.waiting(item.count)}</span>
                </span>
                <span aria-hidden="true" className={styles.todoChevron}>
                  ›
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="admin-quarter-now">
        <h2 className="section-title" id="admin-quarter-now">
          {selected ? selected.display_name : "분기"}
        </h2>
        {selected === null ? (
          <div className="card">
            <p className="small muted">
              아직 분기가 없습니다. 분기를 만들면 신청을 받고 지원금을 배정할 수 있습니다.
            </p>
            <p style={{ marginTop: "0.7rem" }}>
              <Link className="btn btn-sm" href="/admin/quarters">
                분기 만들기
              </Link>
            </p>
          </div>
        ) : (
          <div className={styles.quarterSummary}>
            <div className={styles.quarterFacts}>
              <QuarterBadge status={selected.status} />
              <span className="small muted">
                기간 {formatDate(selected.starts_at)} – {formatDate(selected.ends_at)}
              </span>
              <span className="small muted">
                신청{" "}
                {selected.application_opens_at
                  ? `${formatDate(selected.application_opens_at)} – ${formatDate(
                      selected.application_closes_at,
                    )}`
                  : "기간 미정"}
              </span>
              <span className="small muted">
                1인 한도 {formatKrw(selected.subsidy_limit_krw)}
              </span>
            </div>

            <div className={styles.stats}>
              <Stat label="전체 회원" value={dashboard.counts.total} />
              <Stat
                label={`${MEMBERSHIP_LABEL.active} (이번 분기)`}
                value={dashboard.counts.membership.active ?? 0}
              />
              <Stat
                label={MEMBERSHIP_LABEL.inactive}
                value={dashboard.counts.membership.inactive ?? 0}
              />
              <Stat label="미참여" value={dashboard.counts.membership.none ?? 0} />
              <Stat
                label={ACCOUNT_STATUS_LABEL.former}
                value={dashboard.counts.accounts.former ?? 0}
              />
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="admin-sections">
        <h2 className="section-title" id="admin-sections">
          관리 구역
        </h2>
        <div className={styles.cardGrid}>
          {sections.map((section) => (
            <SectionCard
              figures={dashboard}
              key={section.key}
              quarterId={selected?.id ?? null}
              section={section}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="admin-recent">
        <h2 className="section-title" id="admin-recent">
          최근 기록
          <span className={styles.sectionNote}>
            관리자가 바꾼 마지막 10건 · 읽기 전용
          </span>
        </h2>
        {dashboard.recent_audit.length === 0 ? (
          <div className="card">
            <p className="small muted">
              아직 기록이 없습니다. 회원 참여 상태나 지원금을 바꾸면 여기에 남습니다.
            </p>
          </div>
        ) : (
          <>
            <ul className={styles.recentList}>
              {dashboard.recent_audit.map((entry) => (
                <li className={styles.recentItem} key={entry.id}>
                  <span className={styles.recentWhen}>{formatWhen(entry.created_at)}</span>
                  <span className="badge badge-muted">{entry.action_label}</span>
                  <span className={styles.recentSummary}>{entry.summary}</span>
                  <span className={styles.recentActor}>@{entry.actor_username || "—"}</span>
                </li>
              ))}
            </ul>
            <p style={{ marginTop: "0.7rem" }}>
              <Link className="btn btn-sm" href={withQuarter("/admin/audit", selected?.id)}>
                감사 로그 전체 보기
              </Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/**
 * 구역 카드 하나.
 *
 * 카드 전체가 링크입니다. 안에 "열기" 버튼을 따로 두면 누를 수 있는 곳이
 * 두 개가 되고, 큰 쪽을 눌렀을 때 아무 일도 일어나지 않습니다.
 *
 * 상태 한 줄은 구역마다 다릅니다. 숫자가 아니라 문장인 이유는, "3"만으로는
 * 그것이 신청인지 회원인지 알 수 없기 때문입니다.
 */
function SectionCard({
  section,
  figures,
  quarterId,
}: {
  section: AdminSection;
  figures: AdminDashboard;
  quarterId: number | null;
}) {
  const status: Record<string, { text: string; pending?: number }> = {
    members: {
      text: `전체 ${figures.counts.total}명 · ${MEMBERSHIP_LABEL.active} ${
        figures.counts.membership.active ?? 0
      }명`,
    },
    quarters: {
      text:
        figures.pending_applications > 0
          ? `대기 중인 신청 ${figures.pending_applications}건`
          : "대기 중인 신청 없음",
      pending: figures.pending_applications,
    },
    topups: {
      text:
        figures.pending_top_ups > 0
          ? `확인 대기 ${figures.pending_top_ups}건`
          : "충전 요청 없음",
      pending: figures.pending_top_ups,
    },
    budget: { text: "다음 작업에서 추가합니다" },
    "video-models": {
      text: `회원에게 공개 ${figures.video_models_member_visible} / 전체 ${figures.video_models_total}`,
    },
    audit: {
      text:
        figures.recent_audit.length > 0
          ? `마지막 기록 ${formatWhen(figures.recent_audit[0].created_at)}`
          : "기록 없음",
    },
    content: { text: "앱·영상 정리 — 준비 중" },
    system: { text: "백엔드와 데이터베이스 상태" },
    dev: { text: "사용량 시뮬레이터" },
  };

  const info = status[section.key] ?? { text: "" };
  const pending = info.pending ?? 0;

  const inner = (
    <>
      <span className={styles.cardTop}>
        <span className={styles.cardIcon} aria-hidden="true">
          <section.Icon size={18} strokeWidth={1.75} />
        </span>
        <span className={styles.cardName}>{section.label}</span>
        {pending > 0 && <span className={styles.cardCount}>{pending}</span>}
        {section.comingSoon && <span className="badge badge-mock">준비 중</span>}
        {section.developmentOnly && <span className="badge badge-accent">개발 환경</span>}
      </span>
      <span className={styles.cardDescription}>{section.description}</span>
      <span className={styles.cardStatus}>{info.text}</span>
    </>
  );

  if (section.comingSoon) {
    return (
      <div className={`${styles.card} ${styles.cardDisabled}`} aria-disabled="true">
        {inner}
      </div>
    );
  }

  return (
    <Link
      className={`${styles.card} ${pending > 0 ? styles.cardNeedsAction : ""}`}
      href={withQuarter(section.href, quarterId)}
    >
      {inner}
      <span aria-hidden="true" className={styles.cardChevron}>
        ›
      </span>
    </Link>
  );
}
