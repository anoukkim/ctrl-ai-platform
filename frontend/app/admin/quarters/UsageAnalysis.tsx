"use client";

/**
 * Quarters › 사용 분석 (admin-consolidation v3, owner 2026-10-17) — "어디에 썼나".
 *
 * 원가(제공자가 청구한 달러와 그 원화)와 청구(회원 지갑에서 빠진 원)를 나란히:
 * 제공자별(남은 크레딧, 지금 속도면 언제 다 쓰는지 — 다음에 무엇을 살지),
 * 캐시로 아낀 돈, 기능별, 모델별, 앱 TOP 5, 회원 TOP 5, 지난 30일 추이와 분기
 * 말 예상. 크레딧 구매 기록과 대조, CSV(Concur 포함)는 그 아래 접는 칸에.
 */

import { useCallback, useEffect, useState } from "react";

import Skeleton from "@/app/components/Skeleton";
import {
  concurCsvUrl,
  exportUrl,
  formatUsd,
  getCredit,
  getUsageAnalysis,
  type CreditOverview,
  type QuarterAnalysis,
} from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { formatDate, formatKrw } from "@/lib/quarters";

import { useAdminQuarter, withQuarter } from "../AdminQuarterProvider";
import CachePanel from "../budget/CachePanel";
import CreditPanel from "../budget/CreditPanel";
import ReconcilePanel from "../budget/ReconcilePanel";
import Fold, { FoldGroup } from "../components/Fold";
import {
  DataTable,
  PanelBar,
  Pill,
  SettingsCard,
  SettingsGrid,
  Stack,
  Stats,
  SubHeading,
  Tag,
} from "../components/AdminUI";

import styles from "./quarters.module.css";

export default function UsageAnalysis() {
  const { selected } = useAdminQuarter();
  const [loaded, setLoaded] = useState<{ id: number; analysis: QuarterAnalysis } | null>(null);
  const [credit, setCredit] = useState<CreditOverview | null>(null);
  // The error belongs to the quarter it came from, so a later quarter that
  // loads fine is not hidden behind it.
  const [failed, setFailed] = useState<{ id: number; message: string } | null>(null);
  const analysis = selected && loaded?.id === selected.id ? loaded.analysis : null;
  const error = selected && failed?.id === selected.id ? failed.message : null;

  // A purchase recorded in the fold moves the provider table and the
  // 소진 예상 card too, so both are fetched again.
  const reloadCredit = useCallback(async () => {
    if (!selected) return;
    const [value, overview] = await Promise.all([getUsageAnalysis(selected.id), getCredit(selected.id)]);
    setLoaded({ id: selected.id, analysis: value });
    setCredit(overview);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    Promise.all([getUsageAnalysis(selected.id), getCredit(selected.id)])
      .then(([value, overview]) => {
        if (cancelled) return;
        setLoaded({ id: selected.id, analysis: value });
        setCredit(overview);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setFailed({ id: selected.id, message: describeError(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const bar = (
    <PanelBar
      note={selected ? `${selected.display_name} · 어디에 썼나` : "보고 있는 분기가 없어요"}
      help={
        <>
          <p>
            원가는 제공자가 청구한 달러(와 그 원화), 청구는 회원 지갑에서 빠진 원이에요. 둘은 따로 기록돼서 나란히
            보여요. 남은 크레딧은 모든 구매 − 장부의 모든 사용으로 낸 추정이고, 최종 기준은 제공자 콘솔이에요.
          </p>
          <p>
            소진 예상은 지금 속도로 쓰면 언제 다 쓰는지 — 다음에 무엇을 살지 정할 때 봐요. 크레딧 구매 기록, 캐시, 대조,
            CSV(Concur 포함)는 아래 접는 칸에 있어요. 회원 한 명의 사용 내역은 Members에서 그 회원을 열면 있어요.
          </p>
        </>
      }
    />
  );
  if (!selected) return bar;
  if (error) {
    return (
      <Stack>
        {bar}
        <p className={styles.muted}>사용 분석을 불러오지 못했습니다. {error}.</p>
      </Stack>
    );
  }
  if (!analysis) {
    return (
      <Stack>
        {bar}
        <Skeleton />
      </Stack>
    );
  }

  return (
    <div data-testid="usage-analysis">
      <Stack>
        {bar}
        <Stats
          items={[
            { key: "cost", label: `이번 분기 원가 (${formatUsd(analysis.cost_usd)})`, value: formatKrw(analysis.cost_krw) },
            { key: "charged", label: "회원에게 청구된 금액", value: formatKrw(analysis.charged_krw), tone: "accent" },
            { key: "saved", label: "캐시로 아낀 돈", value: formatKrw(analysis.cache_saved_krw), tone: "ok" },
            {
              key: "runs-out",
              label: "크레딧 소진 예상",
              ...(analysis.providers.some((line) => line.spent)
                ? { value: "이미 소진", tone: "err" as const }
                : { value: analysis.runs_out_on ? formatDate(analysis.runs_out_on) : "—" }),
            },
          ]}
        />

        <section aria-label="제공자별">
          <SubHeading extra="원가와 청구를 나란히 · 남은 크레딧은 추정">제공자별</SubHeading>
          <DataTable testId="usage-providers">
            <thead>
              <tr>
                <th scope="col">제공자</th>
                <th scope="col" data-numeric="">원가</th>
                <th scope="col" data-numeric="">청구</th>
                <th scope="col" data-numeric="">남은 크레딧</th>
                <th scope="col" data-numeric="">소진 예상</th>
              </tr>
            </thead>
            <tbody>
              {analysis.providers.map((line) => (
                <tr key={line.provider}>
                  <td>
                    {line.label}
                    {line.unpriced_events > 0 && (
                      <>
                        {" "}
                        <Tag title="달러 원가가 없는 사용(영상 등)은 원화로만 세요">
                          원가 기록 없음 {line.unpriced_events.toLocaleString("ko-KR")}건
                        </Tag>
                      </>
                    )}
                  </td>
                  <td data-numeric="">{formatUsd(line.cost_usd)}</td>
                  <td data-numeric="">{formatKrw(line.charged_krw)}</td>
                  <td data-numeric="">{line.remaining_usd === null ? "구매 기록 없음" : formatUsd(line.remaining_usd)}</td>
                  <td data-numeric="">
                    {line.spent ? (
                      <Pill tone="err">이미 소진</Pill>
                    ) : line.runs_out_on ? (
                      formatDate(line.runs_out_on)
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </section>

        <SettingsGrid>
          <SettingsCard title="기능별" extra="청구 원">
            {analysis.by_feature.length === 0 ? (
              <p className={styles.muted}>아직 쓴 곳이 없어요.</p>
            ) : (
              <ul className={styles.rank}>
                {analysis.by_feature.map((share) => (
                  <li key={share.label}>
                    <span>{share.label}</span>
                    <span>
                      {formatKrw(share.krw)} · {share.pct}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>
          <SettingsCard title="모델별" extra="청구 원">
            {analysis.by_model.length === 0 ? (
              <p className={styles.muted}>아직 쓴 모델이 없어요.</p>
            ) : (
              <ul className={styles.rank}>
                {analysis.by_model.map((line) => (
                  <li key={line.model_id}>
                    <span>{line.label}</span>
                    <span>{formatKrw(line.krw)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>
          <TopCard title="앱 TOP 5" lines={analysis.top_apps} href={(id) => `/admin/apps/${id}`} quarterId={selected.id} />
          <TopCard title="회원 TOP 5" lines={analysis.top_members} href={(id) => `/admin/members?member=${id}`} quarterId={selected.id} />
          <SettingsCard
            wide
            title="일별 추이"
            extra={
              <>
                지난 30일 · 청구 원
                {analysis.forecast_krw !== null && ` · 이 속도면 분기 말 청구 ${formatKrw(analysis.forecast_krw)}`}
              </>
            }
          >
            <TrendChart days={analysis.daily} />
          </SettingsCard>
        </SettingsGrid>

        <FoldGroup screen="usage-analysis">
          {credit && (
            <Fold id="credit" title="크레딧 구매 기록" note="제공자별 · 남은 크레딧은 추정, 제공자 콘솔이 최종 기준">
              <CreditPanel credit={credit} onChanged={reloadCredit} />
            </Fold>
          )}
          <Fold id="cache" title="캐시" note="모델별 · 날짜별(KST) · 채팅 답장만">
            <CachePanel />
          </Fold>
          {credit && (
            <Fold id="reconcile" title="대조" note="우리 기록과 Anthropic 비용 보고서">
              <ReconcilePanel reportProvider={credit.report_provider} />
            </Fold>
          )}
          <Fold id="export" title="내보내기 (CSV)" note="Excel에서 한글이 깨지지 않게 저장돼요">
            <div className={styles.buttons}>
              <a className="btn btn-sm btn-primary" href={concurCsvUrl(selected.id)} download>
                ⤓ Concur (이 분기 크레딧 구매)
              </a>
              <a className="btn btn-sm" href={exportUrl.members(selected.id)} download>
                회원별
              </a>
              <a className="btn btn-sm" href={exportUrl.daily(selected.id)} download>
                날짜별
              </a>
              <a className="btn btn-sm" href={exportUrl.purchases()} download>
                구매 기록 전체
              </a>
            </div>
          </Fold>
        </FoldGroup>
        <p className={styles.foot}>
          회원 한 명의 사용 내역은 Members에서 그 회원을 열면 있어요 —{" "}
          <a href={withQuarter("/admin/members", selected.id)}>Members</a>.
        </p>
      </Stack>
    </div>
  );
}

function TopCard({
  title,
  lines,
  href,
  quarterId,
}: {
  title: string;
  lines: { id: number; name: string; krw: number }[];
  href: (id: number) => string;
  quarterId: number;
}) {
  return (
    <SettingsCard title={title} extra="청구 원">
      {lines.length === 0 ? (
        <p className={styles.muted}>아직 없어요.</p>
      ) : (
        <ol className={styles.rank}>
          {lines.map((line) => (
            <li key={line.id}>
              <a href={withQuarter(href(line.id), quarterId)}>{line.name}</a>
              <span>{formatKrw(line.krw)}</span>
            </li>
          ))}
        </ol>
      )}
    </SettingsCard>
  );
}

/** The last 30 days as bars (청구 원). */
export function TrendChart({ days }: { days: { day: string; krw: number }[] }) {
  if (days.length === 0) return <p className={styles.muted}>이 분기에는 아직 날이 없어요.</p>;
  const max = Math.max(...days.map((day) => day.krw), 1);
  const total = days.reduce((sum, day) => sum + day.krw, 0);
  return (
    <div
      className={styles.trend}
      role="img"
      aria-label={`지난 ${days.length}일 청구 ${formatKrw(total)}, 하루 가장 많을 때 ${formatKrw(max)}`}
    >
      {days.map((day) => (
        <span key={day.day} title={`${day.day} · ${formatKrw(day.krw)}`} style={{ height: `${Math.max(2, (day.krw / max) * 100)}%` }} />
      ))}
    </div>
  );
}
