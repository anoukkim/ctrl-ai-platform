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

import AdminTable from "../components/AdminTable";
import ResultMessage, { type Result } from "../components/ResultMessage";

import styles from "../admin.module.css";

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
  const [draft, setDraft] = useState({
    provider: "claude",
    purchased_on: today(),
    amount_usd: "",
    paid_krw: "",
    memo: "",
  });
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
          setResult({ kind: "error", text: describeError(error) });
        } finally {
          setBusy(false);
          setConfirm(null);
        }
      },
    });
  }

  return (
    <>

      <div className={styles.providerGrid}>
        {credit.providers.map((line) => (
          <ProviderCard key={line.provider} line={line} />
        ))}
      </div>

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      <h3 className="section-title" style={{ fontSize: "0.95rem", marginTop: "1.2rem" }}>
        구매 기록
        <span className={styles.sectionNote}>덧붙이기만 · 고치거나 지울 수 없음</span>
      </h3>
      <AdminTable
        columns={[
          { key: "date", header: "구매일", render: (row) => row.purchased_on.replaceAll("-", ".") },
          { key: "provider", header: "제공자", render: (row) => row.provider_label },
          { key: "usd", header: "크레딧", numeric: true, render: (row) => formatUsd(row.amount_usd) },
          { key: "krw", header: "실제 결제", numeric: true, render: (row) => formatKrw(row.paid_krw) },
          { key: "memo", header: "메모", render: (row) => row.memo || "–" },
          { key: "by", header: "기록", render: (row) => `@${row.created_by_username || "–"}` },
        ]}
        rows={credit.purchases}
        rowKey={(row) => row.id}
        empty="아직 구매 기록이 없습니다. 크레딧을 사면 아래에서 적어 주세요."
        caption="크레딧 구매 기록"
      />

      {!open ? (
        <div className={styles.actionRow}>
          <button className="btn btn-sm btn-primary" type="button" onClick={() => setOpen(true)}>
            구매 기록 추가
          </button>
          <a className="btn btn-sm" href={exportUrl.purchases()} download>
            구매 기록 CSV
          </a>
        </div>
      ) : (
        <div className={`card ${styles.quarterForm}`} data-testid="purchase-form">
          <div className={styles.formGrid}>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>제공자</span>
              <select
                className="field"
                value={draft.provider}
                onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>구매일</span>
              <input
                className="field"
                type="date"
                value={draft.purchased_on}
                onChange={(event) => setDraft({ ...draft, purchased_on: event.target.value })}
              />
            </label>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>크레딧 (USD)</span>
              <input
                className="field"
                inputMode="decimal"
                placeholder="10.00"
                value={draft.amount_usd}
                onChange={(event) => setDraft({ ...draft, amount_usd: event.target.value })}
              />
            </label>
            <label className={styles.fieldRow}>
              <span className={styles.fieldLabel}>실제 결제 (원)</span>
              <input
                className="field"
                inputMode="numeric"
                placeholder="카드에 찍힌 금액"
                value={draft.paid_krw}
                onChange={(event) => setDraft({ ...draft, paid_krw: event.target.value })}
              />
            </label>
          </div>
          <label className={styles.fieldRow}>
            <span className={styles.fieldLabel}>메모</span>
            <input
              className="field"
              placeholder="예: 2026 Q4 첫 구매, 영수증 Concur 제출함"
              value={draft.memo}
              onChange={(event) => setDraft({ ...draft, memo: event.target.value })}
            />
          </label>
          <p className={styles.fieldHint}>
            실제 결제는 카드 명세서의 원화 금액(수수료와 은행 환율 포함)입니다. 앞선 기록을
            바로잡을 때만 음수를 쓰고, 메모에 무엇을 바로잡는지 적어 주세요.
          </p>
          <div className={styles.actionRow}>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              disabled={!valid || busy}
              onClick={submit}
            >
              기록하기
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setOpen(false)}>
              취소
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog request={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </>
  );
}

function ProviderCard({ line }: { line: ProviderCredit }) {
  const remaining = Number(line.remaining_usd);
  const low = Number(line.purchased_usd) > 0 && remaining < Number(line.purchased_usd) * 0.2;
  return (
    <div className={styles.provider} data-testid={`credit-${line.provider}`}>
      <p className={styles.providerName}>{line.label}</p>
      <dl className={styles.factGrid}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>구매</dt>
          <dd className={styles.factValue}>
            {formatUsd(line.purchased_usd)}
            <span className="small dim"> · {formatKrw(line.paid_krw)} 결제</span>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>사용 (장부)</dt>
          <dd className={styles.factValue}>
            {line.unpriced_events > 0 && Number(line.used_usd) === 0
              ? "달러 비용 미기록"
              : formatUsd(line.used_usd)}
            <span className="small dim"> · 회원 차감 {formatKrw(line.used_krw)}</span>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>남은 크레딧 (추정)</dt>
          <dd className={styles.factValue} data-testid={`remaining-${line.provider}`}>
            <strong style={low ? { color: "var(--warn-text)" } : undefined}>
              {formatUsd(line.remaining_usd)}
            </strong>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>이번 분기 사용</dt>
          <dd className={styles.factValue}>
            {formatUsd(line.used_usd_quarter)}
            <span className="small dim"> · {formatKrw(line.used_krw_quarter)}</span>
          </dd>
        </div>
      </dl>
      {Number(line.absorbed_usd) > 0 && (
        <p className="small dim">
          그중 {formatUsd(line.absorbed_usd)}는 회원에게 청구하지 않은 실패한 호출(동아리 부담)입니다.
        </p>
      )}
      {line.unpriced_events > 0 && (
        <p className="small dim">
          달러 비용이 없는 사용 {line.unpriced_events.toLocaleString("ko-KR")}건(영상 등)은 원화로만
          셉니다.
        </p>
      )}
      {line.provider === "claude" && (
        <p className="small dim">
          Anthropic 콘솔이 최종 기준입니다 — Console › Billing의 잔액과 다르면 콘솔을 믿고,
          아래 &ldquo;Anthropic 비용과 대조&rdquo;로 어느 날이 다른지 찾으세요.
        </p>
      )}
    </div>
  );
}
