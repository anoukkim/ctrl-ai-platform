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
 *
 * admin-ui-unify: 제목은 틀이 그리고, 처리할 일과 알림은 상태 카드
 * (`StatusStrip`과 같은 모양 — 카드 전체가 링크), 이번 주는 `ItemList`.
 */

import Link from "next/link";

import { DEFAULT_ALERTS, formatWhenOrNever, type AdminDashboard } from "@/lib/admin";
import { formatKrw } from "@/lib/quarters";

import Skeleton from "@/app/components/Skeleton";

import { useAdminQuarter, withQuarter } from "./AdminQuarterProvider";
import { ItemList, ItemRow, Pill, Stack, SubHeading, type Tone } from "./components/AdminUI";
import kit from "./components/AdminUI.module.css";
import { tabHref } from "./sections";

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

const ALERT_PILL: Record<Alert["tone"], { tone: Tone; label: string }> = {
  warn: { tone: "warn", label: "확인 필요" },
  ok: { tone: "ok", label: "정상" },
  info: { tone: "accent", label: "참고" },
};

/** 상태 카드 한 장 — 링크가 있으면 카드 전체가 링크. */
function Card({
  href,
  name,
  pill,
  note,
  testId,
  tone,
}: {
  href?: string;
  name: React.ReactNode;
  pill: React.ReactNode;
  note?: React.ReactNode;
  testId?: string;
  tone?: string;
}) {
  const body = (
    <>
      <div className={kit.statusRow}>
        <b>{name}</b>
        {pill}
      </div>
      {note && <small>{note}</small>}
    </>
  );
  return (
    <li data-testid={testId} data-tone={tone} style={{ display: "grid" }}>
      {href ? (
        <Link className={kit.statusCard} href={href} style={{ color: "inherit", textDecoration: "none" }}>
          {body}
        </Link>
      ) : (
        <div className={kit.statusCard}>{body}</div>
      )}
    </li>
  );
}

const CARDS: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0 };

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
    <Stack>
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

      <section aria-labelledby="admin-todo" className={kit.stack}>
        <SubHeading extra="0개인 일은 보이지 않아요">
          <span id="admin-todo">처리할 일</span>
        </SubHeading>
        {todos.length === 0 ? (
          <p className="small muted" data-testid="todo-empty" style={{ margin: 0 }}>
            지금 처리할 일이 없어요.
          </p>
        ) : (
          <ul className={kit.status} style={CARDS}>
            {todos.map((item) => (
              <Card
                key={item.key}
                href={withQuarter(item.href, selected?.id)}
                name={item.label}
                pill={<Pill tone="warn">{item.count.toLocaleString("ko-KR")}건</Pill>}
                note={`${item.where} ›`}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-alerts" className={kit.stack}>
        <SubHeading extra="기준(System › 알림 기준)을 넘으면 자동">
          <span id="admin-alerts">알림</span>
        </SubHeading>
        {alerts.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            지금은 알릴 것이 없어요.
          </p>
        ) : (
          <ul className={kit.status} style={CARDS}>
            {alerts.map((alert) => (
              <Card
                key={alert.key}
                testId="admin-alert"
                tone={alert.tone}
                href={alert.href ? withQuarter(alert.href, selected?.id) : undefined}
                name={alert.text}
                pill={<Pill tone={ALERT_PILL[alert.tone].tone}>{ALERT_PILL[alert.tone].label}</Pill>}
                note={alert.note}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="admin-week" className={kit.stack}>
        <SubHeading>
          <span id="admin-week">이번 주 가장 많이 쓴 곳</span>
        </SubHeading>
        {week && week.places.length > 0 ? (
          <ItemList testId="week-top">
            {week.places.map((place) => (
              <ItemRow
                key={place.label}
                title={place.label}
                cells={[
                  { label: "비율", value: `${place.pct}%`, keep: true },
                  { label: "금액", value: formatKrw(place.krw) },
                ]}
              />
            ))}
            {week.app_name && (
              <ItemRow
                title={week.app_name}
                tags={<Pill tone="accent">가장 많이 쓴 앱</Pill>}
                cells={[
                  { label: "비율", value: "—", keep: true },
                  { label: "금액", value: formatKrw(week.app_krw) },
                ]}
              />
            )}
          </ItemList>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            이번 주에는 아직 쓴 곳이 없어요.
          </p>
        )}
      </section>
    </Stack>
  );
}
