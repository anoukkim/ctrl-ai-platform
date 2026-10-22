"use client";

/**
 * Admin › Quarters › 분기 · 예산 — 분기 목록 (admin-ui-unify).
 *
 * 분기를 만들고(오른쪽 판), 고치고, 신청을 열고 닫습니다. 신청 심사는
 * Members의 승인 대기에서 합니다 — 심사가 훨씬 자주 하는 일입니다.
 *
 * 줄마다 숫자를 함께 보여 주는 이유: 분기를 비교할 수 있어야 합니다.
 * "참여 회원 12명에 실제 사용자 3명"은 다음 분기에 무엇을 바꿔야 하는지
 * 말해 주지만, 분기 이름과 기간만으로는 아무것도 알 수 없습니다.
 *
 * 숫자는 전부 백엔드의 묶음 질의에서 옵니다(`/admin/quarters-with-stats`).
 */

import { useCallback, useEffect, useState } from "react";

import { createQuarter, listQuartersWithStats, type QuarterWithStats } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { QUARTER_STATUS_LABEL, formatDate, formatKrw, updateQuarter, type QuarterStatus } from "@/lib/quarters";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import Skeleton from "@/app/components/Skeleton";

import { useAdminQuarter } from "../AdminQuarterProvider";
import { ItemList, ItemRow, Mono, Pill, SubHeading, Tag, type Tone } from "../components/AdminUI";
import ResultMessage, { type Result } from "../components/ResultMessage";
import RowMenu from "../components/RowMenu";

import CloseQuarterDialog from "./CloseQuarterDialog";
import ExtendDeadlineDialog from "./ExtendDeadlineDialog";
import QuarterEditPanel from "./QuarterEditPanel";
import QuarterForm from "./QuarterForm";

import styles from "./quarters.module.css";

export const QUARTER_TONE: Record<QuarterStatus, Tone> = {
  draft: "off",
  application_open: "accent",
  active: "ok",
  closed: "off",
};

export default function QuarterAdmin({
  creating,
  onCreatingChange,
}: {
  /** 새 분기 판이 열려 있는지 — 단추는 화면 위의 PanelBar에 있습니다. */
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
}) {
  const { selected, select, refresh: refreshDashboard } = useAdminQuarter();

  const [quarters, setQuarters] = useState<QuarterWithStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // A failed 새 분기 — shown inside the form panel, which covers the page's message.
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  // 분기 마감 창(cost-clarity) — 열려 있으면 그 분기.
  const [closing, setClosing] = useState<QuarterWithStats | null>(null);
  // 신청 기한 연장 판 (ui-improvements B) — 열려 있으면 그 분기.
  const [extending, setExtending] = useState<QuarterWithStats | null>(null);
  // 분기 수정 판 (admin-ui-unify).
  const [editing, setEditing] = useState<QuarterWithStats | null>(null);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listQuartersWithStats()
      .then((rows) => {
        if (!cancelled) setQuarters(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (succeeded: string, action: () => Promise<unknown>): Promise<string | null> => {
      setBusy(true);
      try {
        await action();
        setResult({ kind: "ok", text: succeeded });
        setQuarters(await listQuartersWithStats());
        await refreshDashboard();
        return null;
      } catch (caught) {
        const text = describeError(caught);
        setResult({ kind: "error", text });
        return text;
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [refreshDashboard],
  );

  const heading = (
    <SubHeading extra="줄을 누르면 그 분기를 보고 있는 분기로 골라요">분기</SubHeading>
  );

  if (error !== null) {
    return (
      <section aria-label="분기">
        {heading}
        <p className={styles.muted}>분기 정보를 불러오지 못했습니다. {error}.</p>
      </section>
    );
  }

  if (quarters === null) {
    return (
      <section aria-label="분기">
        {heading}
        <Skeleton />
      </section>
    );
  }

  const toggleApplications = (quarter: QuarterWithStats) => {
    const closingApps = quarter.status === "application_open";
    setConfirm({
      title: `${quarter.display_name} ${closingApps ? "신청 마감" : "신청 열기"}`,
      effect: closingApps
        ? "회원이 더 이상 이 분기에 신청할 수 없습니다. 분기는 진행 중으로 바뀌고, 승인된 지갑은 그대로 씁니다. 이미 올라온 신청은 남아 심사할 수 있습니다."
        : "회원이 Profile에서 이 분기에 신청할 수 있게 됩니다. 신청 한 번이 1인 지원금 하나를 받습니다.",
      confirmLabel: closingApps ? "신청 마감" : "신청 열기",
      onConfirm: async () => {
        await run(
          closingApps
            ? `${quarter.display_name}의 신청을 마감했습니다. 분기는 진행 중입니다.`
            : `${quarter.display_name}의 신청을 열었습니다.`,
          () =>
            updateQuarter(quarter.id, {
              // 신청 마감 = 진행 중. "closed"는 분기 마감 전용입니다
              // (cost-clarity) — 예전에는 여기서 closed로 바꿔 모든 지갑이
              // 멈췄습니다.
              status: closingApps ? "active" : "application_open",
            }),
        );
      },
    });
  };

  return (
    <section aria-label="분기" style={{ display: "grid", gap: "0.6rem" }}>
      {heading}
      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      <ItemList
        columns={["분기", "기간", "1인 지원금", "참여 · 사용"]}
        testId="quarter-list"
        empty="아직 분기가 없어요. 위의 「새 분기」로 첫 분기를 만들어 주세요."
      >
        {quarters.map((quarter) => (
          <ItemRow
            key={quarter.id}
            testId="quarter-row"
            onClick={() => select(quarter.id)}
            title={quarter.display_name}
            tags={
              <>
                <Pill tone={QUARTER_TONE[quarter.status]}>{QUARTER_STATUS_LABEL[quarter.status]}</Pill>
                {quarter.id === selected?.id && <Tag tone="accent">보고 있는 분기</Tag>}
                {quarter.stats.pending > 0 && <Tag tone="warn">승인 대기 {quarter.stats.pending}</Tag>}
              </>
            }
            sub={
              <>
                <Mono>{quarter.code}</Mono> · 신청{" "}
                {quarter.application_opens_at
                  ? `${formatDate(quarter.application_opens_at)} – ${formatDate(quarter.application_closes_at)}`
                  : "기간 미정"}
                {quarter.stats.applicants > 0 && ` · 신청자 ${quarter.stats.applicants}명`}
              </>
            }
            cells={[
              {
                label: "기간",
                value: (
                  <span className={styles.range}>
                    {formatDate(quarter.starts_at)} – {formatDate(quarter.ends_at)}
                  </span>
                ),
              },
              { label: "1인 지원금", value: formatKrw(quarter.subsidy_limit_krw) },
              {
                label: "참여 · 사용",
                keep: true,
                value: usageLine(quarter),
              },
            ]}
            action={
              <RowMenu
                items={[
                  {
                    label: "보고 있는 분기로",
                    disabled: quarter.id === selected?.id,
                    onSelect: () => select(quarter.id),
                  },
                  {
                    label: "분기 수정…",
                    disabled: busy || quarter.status === "closed",
                    onSelect: () => setEditing(quarter),
                  },
                  {
                    label: quarter.status === "application_open" ? "신청 마감" : "신청 열기",
                    disabled: busy || quarter.status === "closed",
                    onSelect: () => toggleApplications(quarter),
                  },
                  {
                    // 신청 접수 중이면 기한만, 신청을 마감한 뒤면 다시 열면서
                    // 기한을 늦춥니다. 분기 마감(closed)과 준비 중(draft)은 아님.
                    label: quarter.status === "active" ? "신청 다시 열기…" : "신청 기한 연장…",
                    disabled: busy || quarter.status === "closed" || quarter.status === "draft",
                    onSelect: () => setExtending(quarter),
                  },
                  {
                    label: "분기 마감…",
                    disabled: busy || quarter.status === "closed" || quarter.status === "draft",
                    danger: true,
                    onSelect: () => setClosing(quarter),
                  },
                ]}
              />
            }
          />
        ))}
      </ItemList>

      {creating && (
        <QuarterForm
          busy={busy}
          error={createError}
          onCancel={() => {
            setCreateError(null);
            onCreatingChange(false);
          }}
          onSubmit={(input, summary) =>
            setConfirm({
              title: "새 분기 만들기",
              effect: summary,
              confirmLabel: "분기 만들기",
              onConfirm: async () => {
                setCreateError(
                  await run(`${input.display_name} 분기를 만들었습니다.`, async () => {
                    await createQuarter(input);
                    onCreatingChange(false);
                  }),
                );
              },
            })
          }
        />
      )}

      {editing !== null && (
        <QuarterEditPanel
          quarter={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            void run(message, async () => undefined);
          }}
        />
      )}

      {extending !== null && (
        <ExtendDeadlineDialog
          quarter={extending}
          onClose={() => setExtending(null)}
          onExtended={(message) => {
            setExtending(null);
            void run(message, async () => undefined);
          }}
        />
      )}

      {closing !== null && (
        <CloseQuarterDialog
          quarterId={closing.id}
          quarterName={closing.display_name}
          onClose={() => setClosing(null)}
          onClosed={(preview) => {
            setClosing(null);
            void run(
              `${preview.quarter_name}를 마감했습니다. 회수 ${formatKrw(preview.reclaimed_krw)}, 그중 이월 ${formatKrw(preview.carry_over_krw)}.`,
              async () => undefined,
            );
          }}
        />
      )}

      <ConfirmDialog busy={busy} request={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}

/**
 * "참여 12명 · 사용 3명 (25%)". 실제 사용자는 그 분기에 한 번이라도 예산을
 * 쓴 회원 수, 사용률은 실제 사용자 ÷ 참여 회원. 아직 아무도 참여하지 않은
 * 분기에는 셀 것이 없으므로 "–".
 */
function usageLine(quarter: QuarterWithStats): string {
  const { participants, users_with_usage, usage_rate } = quarter.stats;
  if (participants === 0) return "–";
  const rate = usage_rate === null ? "" : ` (${Math.round(usage_rate * 100)}%)`;
  return `참여 ${participants}명 · 사용 ${users_with_usage}명${rate}`;
}
