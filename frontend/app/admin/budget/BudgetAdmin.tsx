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
 * 읽기 전용입니다. 분기의 1인 지원금은 Quarters에서, 한 회원의 지갑은
 * 회원 상세에서 바꿉니다 — 둘 다 감사 기록에 남습니다.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { describeError } from "@/lib/http";
import {
  MEMBERSHIP_LABEL,
  QUARTER_STATUS_LABEL,
  formatKrw,
  getQuarterBudget,
  type MemberWallet,
  type ProviderSpend,
  type QuarterBudget,
} from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import AdminTable, { type Column } from "../components/AdminTable";
import StatCards from "../components/StatCards";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";
import SharedPageHeader from "@/app/components/PageHeader";

/** 단위 이름 — 제공자가 무엇으로 셈하는지. */
const UNIT_LABEL: Record<string, string> = { tokens: "토큰", seconds: "초" };

function percent(share: number | null): string {
  return share === null ? "–" : `${Math.round(share * 100)}%`;
}

function nativeUnits(line: ProviderSpend): string {
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
  return parts.join(" / ") || "–";
}

function providerCost(line: ProviderSpend): string {
  const entries = Object.entries(line.provider_cost);
  if (entries.length === 0) return "–";
  return entries
    .map(([currency, amount]) => (currency === "USD" ? `$${amount}` : `${amount} ${currency}`))
    .join(" + ");
}

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
  { key: "units", header: "사용량", render: nativeUnits },
  {
    key: "events",
    header: "건수",
    numeric: true,
    render: (line) => line.events.toLocaleString("ko-KR"),
  },
];

export default function BudgetAdmin() {
  const { selected } = useAdminQuarter();
  const quarterId = selected?.id ?? null;
  const [loaded, setLoaded] = useState<{ quarterId: number; budget: QuarterBudget } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (quarterId === null) return;
    let cancelled = false;
    getQuarterBudget(quarterId)
      .then((budget) => {
        if (!cancelled) setLoaded({ quarterId, budget });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [quarterId]);

  const budget = loaded !== null && loaded.quarterId === quarterId ? loaded.budget : null;

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
        <p className="small muted">불러오는 중…</p>
      </>
    );
  }

  const walletColumns: Column<MemberWallet>[] = [
    {
      key: "member",
      header: "회원",
      render: (wallet) => (
        <span className={styles.memberName}>
          {wallet.display_name}
          <span className={styles.memberHandle}>@{wallet.username}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "참여",
      render: (wallet) =>
        wallet.membership_status ? MEMBERSHIP_LABEL[wallet.membership_status] : "기록 없음",
    },
    { key: "budget", header: "배정", numeric: true, render: (w) => formatKrw(w.budget_krw) },
    { key: "used", header: "사용", numeric: true, render: (w) => formatKrw(w.consumed_krw) },
    {
      key: "remaining",
      header: "남음",
      numeric: true,
      render: (w) => formatKrw(w.remaining_krw),
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

      <section aria-labelledby="budget-providers">
        <h2 className="section-title" id="budget-providers">
          제공자별 사용액
          <span className={styles.sectionNote}>다음 크레딧 구매를 정할 때 보는 숫자</span>
        </h2>
        <AdminTable
          columns={PROVIDER_COLUMNS}
          rows={budget.providers}
          rowKey={(line) => line.provider}
          empty="이 분기에는 아직 사용 기록이 없습니다."
          caption="제공자별 사용액"
        />
        <p className="small dim" style={{ marginTop: "0.6rem" }}>
          회원의 지갑은 하나지만 크레딧은 제공자마다 따로 사고, 한 번 산 크레딧은 옮길 수
          없습니다. &ldquo;지원금 총액을 이 비중으로&rdquo;는 지금까지의 사용 비율대로 지원금
          총액({formatKrw(budget.total_budget_krw)})을 나눈 참고값입니다. 제공자 청구액은
          제공자가 매긴 금액이며 원화 사용액과 같은 숫자가 아닙니다. 개인 잔액에서 나간
          사용도 같은 크레딧을 쓰므로 함께 셉니다.
        </p>
      </section>

      <section aria-labelledby="budget-wallets">
        <h2 className="section-title" id="budget-wallets">
          회원별 지갑
          <span className={styles.sectionNote}>많이 쓴 순서 · 조정은 회원 상세에서</span>
        </h2>
        <AdminTable
          columns={walletColumns}
          rows={budget.wallets}
          rowKey={(wallet) => wallet.user_id}
          rowHref={(wallet) => withQuarter(`/admin/members/${wallet.user_id}`, selected.id)}
          empty="이 분기에 승인된 지갑이 없습니다. 참여 신청을 승인하면 생깁니다."
          caption="회원별 지갑"
        />
      </section>
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
