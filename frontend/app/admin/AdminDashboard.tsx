"use client";

/**
 * Admin › Dashboard (admin-consolidation v3, owner 2026-10-17).
 *
 * "처리할 일이 있으면 위에, 나머지는 한눈에." 위에서부터:
 *
 * 1. **처리할 일** — 승인 대기, 열린 신고. 0인 것은 보이지 않아요.
 * 2. **알림** — 기준(Admin › System › 알림 기준)을 넘으면 저절로: 지원금을 많이 쓴 회원, 늦은 백업,
 *    Anthropic 이번 달 예산, 서버 썸네일, 연결에 문제가 생긴 제공자, 첨부
 *    파일 디스크.
 * 3. **이번 주 가장 많이 쓴 곳** — 메뉴별 비율과 가장 많이 쓴 앱.
 *
 * 구역 카드 격자와 화면마다 되풀이되던 숫자는 없앴습니다 — 갈 곳은 위의
 * 여섯 탭이 말해 줍니다.
 */

import Link from "next/link";

import { DEFAULT_ALERTS, formatWhenOrNever, type AdminDashboard } from "@/lib/admin";
import { formatKrw } from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "./AdminQuarterProvider";
import { tabHref } from "./sections";

import styles from "./admin.module.css";
import PageHeader from "@/app/components/PageHeader";
import Skeleton from "@/app/components/Skeleton";

/** 첨부 파일 디스크 — 이만큼 차면 알림. 지원금·월 예산·백업은 알림 기준
 *  (Admin › System, `dashboard.alert_thresholds`)을 따릅니다. */
const DISK_ALERT_PCT = 80;

interface Todo {
  key: string;
  href: string;
  count: number;
  label: string;
  where: string;
}

interface Alert {
  key: string;
  tone: "warn" | "ok" | "info";
  text: string;
  note?: string;
  href?: string;
}

export function todosOf(dashboard: AdminDashboard): Todo[] {
  const all: Todo[] = [
    {
      key: "applications",
      // 거르기까지 걸어 보냅니다 — 누른 이유가 "대기 중인 것"이니까요.
      href: "/admin/members?filter=pending",
      count: dashboard.pending_applications,
      label: "참여 신청 승인 대기",
      where: "Members",
    },
    {
      key: "reports",
      href: tabHref("community", "content"),
      count: dashboard.open_reports ?? 0,
      label: "열린 신고",
      where: "Community",
    },
  ];
  return all.filter((item) => item.count > 0);
}

export function alertsOf(dashboard: AdminDashboard): Alert[] {
  const alerts: Alert[] = [];
  const limits = dashboard.alert_thresholds ?? DEFAULT_ALERTS;
  for (const name of dashboard.failing_providers) {
    alerts.push({ key: `provider-${name}`, tone: "warn", text: `${name} 연결에 문제가 있어요`, note: "마지막 호출이나 확인이 실패했어요", href: "/admin/system" });
  }
  for (const wallet of dashboard.wallet_alerts ?? []) {
    alerts.push({
      key: `wallet-${wallet.user_id}`,
      tone: "warn",
      text: `${wallet.display_name} · 지원금 ${wallet.used_pct}% 사용`,
      note: `${limits.wallet_pct}% 넘음 · ${formatKrw(wallet.remaining_krw)} 남음`,
      href: `/admin/members/${wallet.user_id}`,
    });
  }
  const month = dashboard.anthropic_month;
  if (month && month.used_pct !== null && month.budget_usd) {
    alerts.push({
      key: "anthropic",
      tone: month.used_pct >= limits.month_pct ? "warn" : "info",
      text: `Anthropic 이번 달 예산 ${month.used_pct}%`,
      note: `$${month.used_usd.toFixed(2)} / $${month.budget_usd}${month.used_pct >= limits.month_pct ? " · Console 한도에 닿으면 Chat이 멈춰요" : ""}`,
      href: tabHref("quarters", "budget"),
    });
  }
  if (!dashboard.is_development && dashboard.backups) {
    const local = dashboard.backups.find((line) => line.kind === "local");
    const offsite = dashboard.backups.find((line) => line.kind === "offsite");
    if (!local?.at) {
      alerts.push({ key: "backup", tone: "warn", text: "백업 기록이 없어요", note: "서버에서 deploy/backup.sh가 도는지 확인해 주세요", href: "/admin/system" });
    } else if (local.late) {
      alerts.push({
        key: "backup",
        tone: "warn",
        text: `마지막 백업이 ${limits.backup_hours}시간보다 오래됐어요`,
        note: `${formatWhenOrNever(local.at)} · 매일 도는 작업(cron)을 확인해 주세요`,
        href: "/admin/system",
      });
    }
    if (offsite?.at && offsite.late) {
      alerts.push({ key: "backup-offsite", tone: "warn", text: "서버 밖 백업이 늦어요", note: formatWhenOrNever(offsite.at), href: "/admin/system" });
    }
  }
  const thumbs = dashboard.thumbnail_server ?? "off";
  if (thumbs !== "off") {
    alerts.push({
      key: "thumbs",
      tone: thumbs === "ok" ? "ok" : "warn",
      text: thumbs === "ok" ? "서버 썸네일 정상" : "서버 썸네일이 응답하지 않아요",
      note: thumbs === "ok" ? undefined : "그동안 썸네일은 회원 브라우저가 찍어요",
      href: "/admin/system",
    });
  }
  const used = dashboard.attachment_bytes;
  const limit = dashboard.attachment_limit_bytes;
  if (used !== undefined && limit && used / limit >= DISK_ALERT_PCT / 100) {
    const mb = Math.round(used / (1024 * 1024));
    const gb = Math.round(limit / (1024 * 1024 * 1024));
    alerts.push({ key: "disk", tone: "warn", text: `첨부 파일 ${mb}MB / ${gb}GB — 거의 찼어요`, href: "/admin/system" });
  }
  return alerts;
}

export default function AdminDashboard() {
  const { selected, dashboard, error } = useAdminQuarter();

  if (error !== null) {
    return (
      <div className="card">
        <p className="small muted">이번 분기의 숫자를 불러오지 못했습니다. {error}.</p>
      </div>
    );
  }
  if (dashboard === null) return <Skeleton />;

  const todos = todosOf(dashboard);
  const alerts = alertsOf(dashboard);
  const week = dashboard.week_top;

  return (
    <div className={styles.sections}>
      <PageHeader title="Admin" subtitle="처리할 일이 있으면 위에, 나머지는 한눈에." />

      {selected === null && (
        <div className="card">
          <p className="small muted">아직 분기가 없어요. 분기를 만들면 신청을 받고 지원금을 배정할 수 있어요.</p>
          <p style={{ marginTop: "0.7rem" }}>
            <Link className="btn btn-sm" href="/admin/quarters">
              분기 만들기
            </Link>
          </p>
        </div>
      )}

      <section aria-labelledby="admin-todo">
        <h2 className="section-title" id="admin-todo">
          처리할 일
        </h2>
        {todos.length === 0 ? (
          <p className="small muted" data-testid="todo-empty">
            지금 처리할 일이 없어요.
          </p>
        ) : (
          <div className={styles.todoRow}>
            {todos.map((item) => (
              <Link className={styles.todo} href={withQuarter(item.href, selected?.id)} key={item.key}>
                <span className={styles.todoCount}>{item.count}</span>
                <span className={styles.todoText}>
                  <strong>{item.label}</strong>
                  <span className="small dim">{item.where} ›</span>
                </span>
              </Link>
            ))}
          </div>
        )}
        <p className="small dim" style={{ marginTop: "0.4rem" }}>
          0개인 할 일은 보이지 않아요.
        </p>
      </section>

      <section aria-labelledby="admin-alerts">
        <h2 className="section-title" id="admin-alerts">
          알림
          <span className={styles.sectionNote}>기준을 넘으면 자동</span>
        </h2>
        {alerts.length === 0 ? (
          <p className="small muted">지금은 알릴 것이 없어요.</p>
        ) : (
          <ul className={styles.alertList}>
            {alerts.map((alert) => {
              const body = (
                <>
                  <span className={styles.alertMark} data-tone={alert.tone} aria-hidden="true" />
                  <span className={styles.todoText}>
                    <strong>{alert.text}</strong>
                    {alert.note && <span className="small dim">{alert.note}</span>}
                  </span>
                </>
              );
              return (
                <li key={alert.key} data-tone={alert.tone} data-testid="admin-alert">
                  {alert.href ? (
                    <Link className={styles.alertItem} href={withQuarter(alert.href, selected?.id)}>
                      {body}
                    </Link>
                  ) : (
                    <span className={styles.alertItem}>{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-week">
        <h2 className="section-title" id="admin-week">
          이번 주 가장 많이 쓴 곳
        </h2>
        {week && week.places.length > 0 ? (
          <p className={styles.weekLine} data-testid="week-top">
            {week.places.map((place) => `${place.label} ${place.pct}%`).join(" · ")}
            {week.app_name && (
              <span className="small dim">
                {" "}
                · 가장 많이 쓴 앱 · {week.app_name} {formatKrw(week.app_krw)}
              </span>
            )}
          </p>
        ) : (
          <p className="small muted">이번 주에는 아직 쓴 곳이 없어요.</p>
        )}
      </section>
    </div>
  );
}
