"use client";

/**
 * Admin — Budget (/admin/budget)
 *
 * 회원에게는 분기마다 동아리 지원 지갑이 하나씩 있습니다(single-wallet).
 * 하지만 동아리는 여전히 **제공자별로** 크레딧을 삽니다 — Claude는
 * Anthropic에서, 영상은 Higgsfield에서. 한 번 산 크레딧은 제공자 사이를
 * 옮길 수 없으니, 팀장이 다음 구매를 정할 때 보는 숫자는 "이번 분기에
 * 제공자마다 얼마를 썼나"입니다. 이 화면이 그 숫자와, 회원마다 남은
 * 지갑을 보여 줍니다.
 *
 * 분기의 1인 지원금은 Quarters에서, 한 회원의 지갑은 회원 상세에서
 * 바꿉니다 — 둘 다 감사 기록에 남습니다.
 *
 * cost-clarity (2026-10-14) — "돈이 어디로 갔는지"를 한 화면에:
 *   동아리 크레딧   제공자별 구매 기록(덧붙이기만), 사용, 남은 크레딧(추정)
 *   지급 vs 사용    이번 분기에 준 지갑, 실제 차감, 남은 돈(마감하면 회수)
 *   회원별          지급, 채팅/빌더/영상/기타, 캐시로 아낀 금액
 *   캐시            모델별·날짜별 적중률과 아낀 금액
 *   CSV            회원별, 날짜별, 구매, 캐시 (Excel용 UTF-8 BOM)
 *   대조            우리 장부 vs Anthropic 비용 보고서(선택, 기본 목업)
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useSite } from "@/app/components/SiteProvider";
import {
  exportUrl,
  formatUsd,
  getCredit,
  getQuarterMoney,
  type CreditOverview,
  type MemberMoneyRow,
  type QuarterMoney,
} from "@/lib/accounting";
import { DEPTH_LABEL, isDepth } from "@/lib/depth";
import { describeError } from "@/lib/http";
import { formatWonPart } from "@/lib/money";
import {
  MEMBERSHIP_LABEL,
  QUARTER_STATUS_LABEL,
  formatKrw,
  getQuarterBudget,
  type ModelDepthSpend,
  type ProviderSpend,
  type QuarterBudget,
} from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import AdminTable, { type Column } from "../components/AdminTable";
import Fold, { FoldGroup } from "../components/Fold";
import StatCards from "../components/StatCards";
import CachePanel from "./CachePanel";
import CreditPanel from "./CreditPanel";
import ReconcilePanel from "./ReconcilePanel";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";
import SharedPageHeader from "@/app/components/PageHeader";
import Skeleton from "@/app/components/Skeleton";

/** 단위 이름 — 제공자가 무엇으로 셈하는지. */
const UNIT_LABEL: Record<string, string> = { tokens: "토큰", seconds: "초" };

function percent(share: number | null): string {
  return share === null ? "–" : `${Math.round(share * 100)}%`;
}


/** 이번 달 Anthropic 지출이 월 예산의 몇 %인지 (막대와 경고가 같이 쓴다). */
function monthShare(budget: QuarterBudget): number {
  if (!budget.anthropic_month_budget_usd) return 0;
  return Math.min(100, Math.round((budget.anthropic_month_usd / budget.anthropic_month_budget_usd) * 100));
}

/**
 * 사용량, 한 줄에 한 가지. 표의 칸은 줄바꿈하지 않으므로, 토큰과 캐시를
 * 한 줄로 이으면 1280px에서 표가 상자보다 넓어졌습니다(fix-ui-polish-admin).
 */
function NativeUnits({ line }: { line: ProviderSpend }) {
  const parts = nativeUnitParts(line);
  if (parts.length === 0) return <>–</>;
  return (
    <span className={styles.stackCell}>
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </span>
  );
}

function nativeUnitParts(line: ProviderSpend): string[] {
  const parts: string[] = [];
  if (line.input_tokens || line.output_tokens) {
    parts.push(
      `입력 ${line.input_tokens.toLocaleString("ko-KR")} · 출력 ${line.output_tokens.toLocaleString("ko-KR")} 토큰`,
    );
  }
  if (line.cache_read_tokens || line.cache_write_tokens) {
    parts.push(
      `캐시 읽기 ${line.cache_read_tokens.toLocaleString("ko-KR")} · 쓰기 ${line.cache_write_tokens.toLocaleString("ko-KR")} 토큰` +
        (line.cache_hit_rate !== null ? ` (입력의 ${Math.round(line.cache_hit_rate * 100)}% 캐시)` : ""),
    );
  }
  for (const [unit, amount] of Object.entries(line.units)) {
    if (unit === "tokens" && parts.length > 0) continue;
    parts.push(`${amount.toLocaleString("ko-KR")} ${UNIT_LABEL[unit] ?? unit}`);
  }
  return parts;
}

function providerCost(line: ProviderSpend): string {
  const entries = Object.entries(line.provider_cost);
  if (entries.length === 0) return "–";
  return entries
    .map(([currency, amount]) => (currency === "USD" ? `$${amount}` : `${amount} ${currency}`))
    .join(" + ");
}

const FEATURE_LABEL: Record<string, string> = {
  chat: "채팅",
  build: "빌더",
  app_ai: "앱 AI",
  app_ai_preview: "앱 미리보기",
  publish_summary: "게시 요약",
  video_prompt: "영상 프롬프트",
};

/** Claude 사용 — 모델 × 기능 × 생각 깊이(quality-tuning Q1). */
const MODEL_DEPTH_COLUMNS: Column<ModelDepthSpend>[] = [
  { key: "model", header: "모델", render: (line) => <strong>{line.model_id || "–"}</strong> },
  { key: "feature", header: "기능", render: (line) => FEATURE_LABEL[line.feature] ?? line.feature },
  {
    key: "depth",
    header: "생각 깊이",
    render: (line) => (isDepth(line.depth) ? DEPTH_LABEL[line.depth] : "–"),
  },
  { key: "events", header: "건수", numeric: true, render: (line) => line.events.toLocaleString("ko-KR") },
  { key: "charged", header: "사용액", numeric: true, render: (line) => formatKrw(line.charged_krw) },
  { key: "average", header: "1회 평균", numeric: true, render: (line) => formatKrw(line.average_krw) },
  {
    key: "output",
    header: "출력 토큰",
    numeric: true,
    render: (line) => line.output_tokens.toLocaleString("ko-KR"),
  },
];

const PROVIDER_COLUMNS: Column<ProviderSpend>[] = [
  { key: "provider", header: "제공자", render: (line) => <strong>{line.label}</strong> },
  {
    key: "charged",
    header: "사용액",
    numeric: true,
    render: (line) => formatKrw(line.charged_krw),
  },
  {
    key: "split",
    header: "지원금 / 개인",
    numeric: true,
    render: (line) => `${formatKrw(line.community_krw)} / ${formatKrw(line.personal_krw)}`,
  },
  { key: "share", header: "비중", numeric: true, render: (line) => percent(line.share) },
  {
    key: "forecast",
    header: "지원금 총액을 이 비중으로",
    numeric: true,
    render: (line) =>
      line.share_of_wallets_krw === null ? "–" : formatKrw(line.share_of_wallets_krw),
  },
  { key: "cost", header: "제공자 청구액", numeric: true, render: providerCost },
  { key: "units", header: "사용량", render: (line) => <NativeUnits line={line} /> },
  {
    key: "events",
    header: "건수",
    numeric: true,
    render: (line) => line.events.toLocaleString("ko-KR"),
  },
];

export default function BudgetAdmin() {
  const site = useSite();
  const { selected } = useAdminQuarter();
  const quarterId = selected?.id ?? null;
  const [loaded, setLoaded] = useState<{
    quarterId: number;
    budget: QuarterBudget;
    money: QuarterMoney;
    credit: CreditOverview;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (quarterId === null) return;
    let cancelled = false;
    Promise.all([getQuarterBudget(quarterId), getQuarterMoney(quarterId), getCredit(quarterId)])
      .then(([budget, money, credit]) => {
        if (!cancelled) setLoaded({ quarterId, budget, money, credit });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [quarterId, version]);

  const current = loaded !== null && loaded.quarterId === quarterId ? loaded : null;
  const budget = current?.budget ?? null;

  if (selected === null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">
            아직 분기가 없습니다.{" "}
            <Link href="/admin/quarters">Quarters</Link>에서 분기를 먼저 만들어 주세요.
          </p>
        </div>
      </>
    );
  }

  if (error !== null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">지원금 현황을 불러오지 못했습니다. {error}.</p>
        </div>
      </>
    );
  }

  if (budget === null) {
    return (
      <>
        <PageHeader />
        <Skeleton />
      </>
    );
  }

  const money = current!.money;
  const credit = current!.credit;
  const closed = money.closed_at !== null;
  const memberColumns: Column<MemberMoneyRow>[] = [
    {
      key: "member",
      header: "회원",
      render: (row) => (
        <span className={styles.memberName}>
          {row.display_name}
          <span className={styles.memberHandle}>@{row.username}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "참여",
      render: (row) =>
        row.membership_status
          ? MEMBERSHIP_LABEL[row.membership_status as keyof typeof MEMBERSHIP_LABEL] ??
            row.membership_status
          : "기록 없음",
    },
    {
      key: "granted",
      header: "지급",
      numeric: true,
      render: (row) => (
        <span className={styles.stackCell}>
          <span>{formatKrw(row.granted_krw)}</span>
          {row.adjusted_krw !== 0 && (
            <span className="small dim">조정 {row.adjusted_krw > 0 ? "+" : ""}{formatKrw(row.adjusted_krw)}</span>
          )}
          {row.carried_in_krw > 0 && (
            <span className="small dim">이월 +{formatKrw(row.carried_in_krw)}</span>
          )}
        </span>
      ),
    },
    { key: "chat", header: "채팅", numeric: true, render: (row) => formatKrw(row.chat_krw) },
    { key: "build", header: "빌더", numeric: true, render: (row) => formatKrw(row.build_krw) },
    { key: "video", header: "영상", numeric: true, render: (row) => formatKrw(row.video_krw) },
    { key: "other", header: "기타", numeric: true, render: (row) => formatKrw(row.other_krw) },
    {
      key: "remaining",
      header: closed ? "회수" : "남음",
      numeric: true,
      render: (row) =>
        closed
          ? `${formatKrw(row.reclaimed_krw ?? 0)}${row.carry_over_krw ? ` (이월 ${formatKrw(row.carry_over_krw)})` : ""}`
          : formatKrw(row.remaining_krw),
    },
    {
      key: "saved",
      header: "캐시로 아낀 금액",
      numeric: true,
      render: (row) => (row.cache_saved_krw > 0 ? `약 ${formatWonPart(row.cache_saved_krw)}` : "–"),
    },
  ];

  return (
    <div className={styles.sections}>
      <PageHeader />

      <div className={styles.quarterLine}>
        <strong>{selected.display_name}</strong>
        <span className="badge badge-muted">{QUARTER_STATUS_LABEL[selected.status]}</span>
        <span className="small muted">1인 지원금 {formatKrw(budget.member_budget_krw)}</span>
        <Link className={styles.quarterLineLink} href={withQuarter("/admin/quarters", selected.id)}>
          Quarters에서 바꾸기 ›
        </Link>
      </div>

      <StatCards
        cards={[
          { key: "wallets", label: "지갑", value: budget.wallets.length, unit: "명" },
          { key: "budget", label: "지원금 총액", value: formatKrw(budget.total_budget_krw) },
          { key: "used", label: "사용", value: formatKrw(budget.total_consumed_krw) },
          { key: "left", label: "남음", value: formatKrw(budget.total_remaining_krw) },
        ]}
      />

      {/* 아래는 접는 섹션들 (ui-improvements B): 한 번에 하나만 펼치고, 접힌
          줄에는 한 줄 요약. 위의 숫자 카드는 늘 보입니다. */}
      <FoldGroup screen="budget">
      {budget.anthropic_month_budget_usd !== null && budget.anthropic_month_budget_usd > 0 && (
        <Fold
          id="month"
          title={`이번 달 Anthropic 지출 (${budget.anthropic_month})`}
          note="KST 기준 — Console 월 한도에 닿기 전에 보는 막대"
          summary={`$${budget.anthropic_month_usd.toFixed(2)} / $${budget.anthropic_month_budget_usd} · ${monthShare(budget)}%`}
        >
          {/* PART F: 이번 달 Anthropic 지출을 .env의
              ANTHROPIC_MONTHLY_BUDGET_USD와 비교합니다. 실제 차단은
              Anthropic Console의 월 한도가 하고, 이 막대는 그 전에
              알아차리기 위한 것입니다. */}
          <div
            className="meter"
            role="img"
            aria-label={`월 예산 ${budget.anthropic_month_budget_usd}달러 중 ${monthShare(budget)}% 사용`}
          >
            <div className="meter-fill" style={{ width: `${monthShare(budget)}%` }} />
          </div>
          <p className={monthShare(budget) >= 80 ? "notice" : "small muted"} style={{ marginTop: "0.5rem" }}>
            ${budget.anthropic_month_usd.toFixed(2)} / ${budget.anthropic_month_budget_usd}
            {monthShare(budget) >= 80
              ? " — 월 예산의 80%를 넘었습니다. Console 한도에 닿으면 Chat이 멈추니, 예산을 올리거나 사용을 줄여 주세요."
              : ""}
          </p>
        </Fold>
      )}

      <Fold
        id="granted"
        title="지급 vs 사용"
        note={closed ? `마감됨 · 남은 돈은 회수, 그중 ${money.carry_over_percent}%는 다음 분기로 이월` : "이번 분기 동아리 지원"}
        summary={`지급 ${formatKrw(money.granted_krw)} · 차감 ${formatKrw(money.charged_krw)} · ${closed ? "회수" : "안 쓴 돈"} ${formatKrw(money.unspent_krw)}`}
      >
        <div data-testid="granted-vs-used">
        <StatCards
          cards={[
            { key: "granted", label: "지급한 지갑", value: formatKrw(money.granted_krw) },
            { key: "charged", label: "실제 차감", value: formatKrw(money.charged_krw) },
            {
              key: "unspent",
              label: closed ? "회수" : "아직 안 쓴 돈",
              value: formatKrw(money.unspent_krw),
            },
            {
              key: "saved",
              label: "캐시로 아낀 금액",
              value: `약 ${formatWonPart(money.cache_saved_krw)}`,
            },
          ]}
        />
        {Number(money.absorbed_usd) > 0 && (
          <p className="small dim">
            이번 분기 회원에게 청구하지 않은 실패한 호출(동아리 부담): {formatUsd(money.absorbed_usd)}
          </p>
        )}
        </div>
      </Fold>

      <Fold
        id="credit"
        title="동아리 크레딧"
        note="제공자별 · 남은 크레딧은 추정, 제공자 콘솔이 최종 기준"
        summary={credit.providers.map((line) => `${line.label} 남음 ${formatUsd(line.remaining_usd)}`).join(" · ")}
      >
        <CreditPanel credit={credit} onChanged={reload} />
      </Fold>

      <Fold
        id="providers"
        title="제공자별 사용액"
        note="다음 크레딧 구매를 정할 때 보는 숫자"
        summary={
          budget.providers.length === 0
            ? "아직 사용 기록 없음"
            : budget.providers.map((line) => `${line.label} ${formatKrw(line.charged_krw)}`).join(" · ")
        }
      >
        <AdminTable
          columns={
            // The 지원금 / 개인 split only means something while top-ups are
            // on or someone actually spent personal money (personal-topup-off).
            site.top_ups_enabled || budget.providers.some((line) => line.personal_krw > 0)
              ? PROVIDER_COLUMNS
              : PROVIDER_COLUMNS.filter((column) => column.key !== "split")
          }
          rows={budget.providers}
          rowKey={(line) => line.provider}
          empty="이 분기에는 아직 사용 기록이 없습니다."
          caption="제공자별 사용액"
        />
        <p className="small dim" style={{ marginTop: "0.6rem" }}>
          회원의 지갑은 하나지만 크레딧은 제공자마다 따로 사고, 한 번 산 크레딧은 옮길 수
          없습니다. &ldquo;지원금 총액을 이 비중으로&rdquo;는 지금까지의 사용 비율대로 지원금
          총액({formatKrw(budget.total_budget_krw)})을 나눈 참고값입니다. 제공자 청구액은
          제공자가 매긴 금액이며 원화 사용액과 같은 숫자가 아닙니다.
          {/* 개인 충전이 꺼져 있는 동안(personal-topup-off)은 말하지 않습니다. */}
          {site.top_ups_enabled && " 개인 잔액에서 나간 사용도 같은 크레딧을 쓰므로 함께 셉니다."}
        </p>
      </Fold>

      <Fold
        id="model-depth"
        title="Claude 모델 × 생각 깊이"
        note="깊이 기본값과 한도를 정할 때 보는 숫자"
        summary={`${(budget.model_depth ?? []).length}줄`}
      >
        <AdminTable
          columns={MODEL_DEPTH_COLUMNS}
          rows={budget.model_depth ?? []}
          rowKey={(line) => `${line.model_id}|${line.feature}|${line.depth ?? ""}`}
          empty="이 분기에는 아직 Claude 사용 기록이 없습니다."
          caption="Claude 모델 × 생각 깊이"
        />
        <p className="small dim" style={{ marginTop: "0.6rem" }}>
          생각 깊이가 &ldquo;–&rdquo;인 줄은 깊이 조절이 없는 모델(Haiku)이거나 생각 깊이가 생기기 전의
          기록입니다.
        </p>
      </Fold>

      <Fold
        id="members"
        title="회원별"
        note="많이 쓴 순서 · 조정은 회원 상세에서"
        summary={`${money.members.length}명`}
      >
        <AdminTable
          columns={memberColumns}
          rows={money.members}
          rowKey={(row) => row.user_id}
          rowHref={(row) => withQuarter(`/admin/members/${row.user_id}`, selected.id)}
          empty="이 분기에 승인된 지갑이 없습니다. 참여 신청을 승인하면 생깁니다."
          caption="회원별 지급과 사용"
        />
        <div className={styles.actionRow}>
          <a className="btn btn-sm" href={exportUrl.members(selected.id)} download>
            회원별 CSV
          </a>
          <a className="btn btn-sm" href={exportUrl.daily(selected.id)} download>
            날짜별 CSV
          </a>
        </div>
        <p className="small dim">CSV는 Excel에서 바로 열리도록 UTF-8(BOM)으로 저장됩니다.</p>
      </Fold>

      <Fold id="cache" title="캐시" note="모델별 · 날짜별(KST) · 채팅 답장만">
        <CachePanel />
      </Fold>

      <Fold
        id="reconcile"
        title="Anthropic 비용과 대조"
        note="선택 기능 · 날짜는 UTC 기준"
        summary={credit.report_provider === "mock" ? "목업 보고서" : "실제 Anthropic 보고서"}
      >
        <ReconcilePanel reportProvider={credit.report_provider} />
      </Fold>
      </FoldGroup>
    </div>
  );
}

function PageHeader() {
  return (
    <SharedPageHeader
      eyebrow="Admin"
      title={sectionLabel("budget")}
      subtitle={
        <>
          회원마다 분기 지원금 지갑이 하나씩 있고, 채팅·영상 등 모든 기능이 그 지갑에서
          씁니다. 동아리는 크레딧을 제공자별로 사므로 사용액을 제공자별로 모아 보여 줍니다.
        </>
      }
    />
  );
}
