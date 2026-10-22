"use client";

/**
 * 동아리 크레딧 (cost-clarity) — 제공자마다 산 것, 쓴 것, 남은 것(추정).
 *
 * 크레딧은 분기가 아니라 다 쓰거나 만료될 때까지 이어지므로, 남은 크레딧은
 * **모든 구매 − 장부에 기록된 모든 사용**입니다. 우리 장부의 추정일 뿐이고
 * 최종 기준은 제공자의 콘솔입니다(Anthropic Console › Billing).
 *
 * 구매 기록은 덧붙이기만 합니다 — 고치거나 지우는 버튼이 없습니다. 잘못
 * 적었으면 음수 금액과 "정정" 메모로 한 줄을 더 적습니다. 적을 때마다
 * 감사 기록에 남습니다.
 */

import { useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import {
  exportUrl,
  formatUsd,
  recordPurchase,
  type CreditOverview,
  type ProviderCredit,
} from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import {
  DataTable,
  ItemList,
  ItemRow,
  Mono,
  NumField,
  PanelBar,
  PanelSection,
  SidePanel,
  Stack,
  Tag,
} from "../components/AdminUI";
import ResultMessage, { type Result } from "../components/ResultMessage";

import styles from "../quarters/quarters.module.css";

const PROVIDER_OPTIONS = [
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "higgsfield", label: "Higgsfield" },
  { value: "gemini", label: "Google Gemini" },
];

function today(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default function CreditPanel({
  credit,
  onChanged,
}: {
  credit: CreditOverview;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => ({
    provider: "claude",
    purchased_on: today(),
    amount_usd: "",
    paid_krw: "",
    memo: "",
  }));
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const amount = Number(draft.amount_usd);
  const paid = Number(draft.paid_krw.replaceAll(",", ""));
  const valid =
    draft.amount_usd.trim() !== "" &&
    Number.isFinite(amount) &&
    amount !== 0 &&
    Number.isInteger(paid) &&
    draft.paid_krw.trim() !== "" &&
    (amount > 0 || draft.memo.trim() !== "");

  function submit() {
    const label = PROVIDER_OPTIONS.find((option) => option.value === draft.provider)?.label;
    setConfirm({
      title: "크레딧 구매 기록",
      effect: [
        `${label} · ${draft.purchased_on} · ${formatUsd(amount)} · 실제 결제 ${formatKrw(paid)}`,
        "기록은 고치거나 지울 수 없습니다. 틀리면 음수 금액과 정정 메모로 한 줄을 더 적습니다.",
        "감사 기록에 남습니다.",
      ],
      confirmLabel: "기록하기",
      onConfirm: async () => {
        setBusy(true);
        try {
          await recordPurchase({
            provider: draft.provider,
            purchased_on: draft.purchased_on,
            amount_usd: amount.toFixed(2),
            paid_krw: paid,
            memo: draft.memo.trim(),
          });
          setResult({ kind: "ok", text: "구매를 기록했습니다." });
          setDraft((old) => ({ ...old, amount_usd: "", paid_krw: "", memo: "" }));
          setOpen(false);
          onChanged();
        } catch (error) {
          // Shown inside the panel: the page's message sits under it.
          setPanelError(describeError(error));
        } finally {
          setBusy(false);
          setConfirm(null);
        }
      },
    });
  }

  return (
    <Stack>
      <ItemList columns={["제공자", "구매", "사용 (장부)", "남은 크레딧 (추정)", "이번 분기 사용"]} testId="credit-providers">
        {credit.providers.map((line) => (
          <ProviderRow key={line.provider} line={line} />
        ))}
      </ItemList>

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      <PanelBar
        left={<b style={{ fontSize: "0.88rem" }}>구매 기록</b>}
        note="덧붙이기만 · 고치거나 지울 수 없음"
        help={
          <p>
            틀리게 적었으면 음수 금액과 &ldquo;정정&rdquo; 메모로 한 줄을 더 적어요. 적을 때마다 감사 기록에 남아요.
            남은 크레딧은 모든 구매 − 장부의 모든 사용으로 낸 추정이고, 최종 기준은 제공자 콘솔이에요.
          </p>
        }
        actions={
          <>
            <a className="btn btn-sm" href={exportUrl.purchases()} download>
              구매 기록 CSV
            </a>
            <button className="btn btn-sm btn-primary" type="button" onClick={() => {
                setPanelError(null);
                setOpen(true);
              }}>
              구매 기록 추가
            </button>
          </>
        }
      />
      <DataTable testId="credit-purchases">
        <caption className="sr-only">크레딧 구매 기록</caption>
        <thead>
          <tr>
            <th scope="col">구매일</th>
            <th scope="col">제공자</th>
            <th scope="col" data-numeric="">크레딧</th>
            <th scope="col" data-numeric="">실제 결제</th>
            <th scope="col">메모</th>
            <th scope="col">기록</th>
          </tr>
        </thead>
        <tbody>
          {credit.purchases.length === 0 ? (
            <tr>
              <td colSpan={6} className="small dim">
                아직 구매 기록이 없어요. 크레딧을 사면 「구매 기록 추가」로 적어 주세요.
              </td>
            </tr>
          ) : (
            credit.purchases.map((row) => (
              <tr key={row.id}>
                <td>{row.purchased_on.replaceAll("-", ".")}</td>
                <td>{row.provider_label}</td>
                <td data-numeric="">{formatUsd(row.amount_usd)}</td>
                <td data-numeric="">{formatKrw(row.paid_krw)}</td>
                <td>{row.memo || "–"}</td>
                <td>
                  <Mono>@{row.created_by_username || "–"}</Mono>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>

      {open && (
        <SidePanel
          title="크레딧 구매 기록"
          subtitle="덧붙이기만 · 감사 기록에 남아요"
          onClose={() => setOpen(false)}
          testId="purchase-form"
          footer={
            <>
              <button className="btn btn-sm" type="button" onClick={() => setOpen(false)}>
                취소
              </button>
              <button className="btn btn-sm btn-primary" type="button" disabled={!valid || busy} onClick={submit}>
                기록하기
              </button>
            </>
          }
        >
          <PanelSection title="구매">
            <div className={styles.formField}>
              <label htmlFor="purchase-provider">제공자</label>
              <select
                id="purchase-provider"
                value={draft.provider}
                onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formField}>
              <label htmlFor="purchase-date">구매일</label>
              <input
                id="purchase-date"
                type="date"
                value={draft.purchased_on}
                onChange={(event) => setDraft({ ...draft, purchased_on: event.target.value })}
              />
            </div>
          </PanelSection>
          <PanelSection title="금액">
            <NumField
              label="크레딧 (USD)"
              unit="$"
              type="text"
              inputMode="decimal"
              value={draft.amount_usd}
              onChange={(value) => setDraft({ ...draft, amount_usd: value })}
            />
            <NumField
              label="실제 결제 (원)"
              unit="원"
              type="text"
              inputMode="numeric"
              value={draft.paid_krw}
              onChange={(value) => setDraft({ ...draft, paid_krw: value })}
            />
            <p className={styles.hint}>
              실제 결제는 카드 명세서의 원화 금액(수수료와 은행 환율 포함)이에요. 앞선 기록을 바로잡을 때만 음수를 쓰고,
              메모에 무엇을 바로잡는지 적어 주세요.
            </p>
          </PanelSection>
          <PanelSection title="메모">
            <div className={styles.formField}>
              <label htmlFor="purchase-memo">메모</label>
              <input
                id="purchase-memo"
                placeholder="예: 2026 Q4 첫 구매, 영수증 Concur 제출함"
                value={draft.memo}
                onChange={(event) => setDraft({ ...draft, memo: event.target.value })}
              />
            </div>
          </PanelSection>
          {panelError && (
            <p className="small" role="alert" style={{ color: "var(--error-text)", margin: 0 }}>
              {panelError}
            </p>
          )}
        </SidePanel>
      )}

      <ConfirmDialog request={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </Stack>
  );
}

function ProviderRow({ line }: { line: ProviderCredit }) {
  const remaining = Number(line.remaining_usd);
  const low = Number(line.purchased_usd) > 0 && remaining < Number(line.purchased_usd) * 0.2;
  return (
    <ItemRow
      testId={`credit-${line.provider}`}
      title={line.label}
      tags={low ? <Tag tone="warn">얼마 안 남음</Tag> : undefined}
      sub={
        <>
          {Number(line.absorbed_usd) > 0 && (
            <span style={{ display: "block" }}>
              그중 {formatUsd(line.absorbed_usd)}는 회원에게 청구하지 않은 실패한 호출(동아리 부담)이에요.
            </span>
          )}
          {line.unpriced_events > 0 && (
            <span style={{ display: "block" }}>
              달러 비용이 없는 사용 {line.unpriced_events.toLocaleString("ko-KR")}건(영상 등)은 원화로만 세요.
            </span>
          )}
          {line.provider === "claude" && (
            <span style={{ display: "block" }}>
              Anthropic 콘솔이 최종 기준이에요 — Console › Billing의 잔액과 다르면 콘솔을 믿고, 「대조」로 어느 날이
              다른지 찾아요.
            </span>
          )}
        </>
      }
      cells={[
        { label: "구매", value: `${formatUsd(line.purchased_usd)} · ${formatKrw(line.paid_krw)}` },
        {
          label: "사용 (장부)",
          value: `${
            line.unpriced_events > 0 && Number(line.used_usd) === 0 ? "달러 비용 미기록" : formatUsd(line.used_usd)
          } · 회원 차감 ${formatKrw(line.used_krw)}`,
        },
        {
          label: "남은 크레딧 (추정)",
          keep: true,
          value: (
            <strong data-testid={`remaining-${line.provider}`} style={low ? { color: "var(--warn-text)" } : undefined}>
              {formatUsd(line.remaining_usd)}
            </strong>
          ),
        },
        {
          label: "이번 분기 사용",
          value: `${formatUsd(line.used_usd_quarter)} · ${formatKrw(line.used_krw_quarter)}`,
        },
      ]}
    />
  );
}
