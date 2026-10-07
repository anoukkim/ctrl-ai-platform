"use client";

/**
 * Admin — Claude 환율과 호출 설정 (시스템 화면, 외부 서비스 아래)
 *
 * Chat 답장과 프롬프트 도움 한 번의 값은 두 숫자로 정해집니다: 모델의
 * 토큰 요금(달러, 100만 토큰당)과 환율(1달러 = 몇 원). 요금은 모델과 함께
 * Admin › Claude Models에서, 환율은 여기서 바꿉니다. 바꾸면 **그 뒤의**
 * 사용분부터 적용되고, 이미 차감된 기록은 그때의 요금과 환율을 그대로
 * 갖고 있습니다. 바꾼 사람과 전후 값은 감사 기록에 남습니다.
 *
 * 위쪽의 생각·한도 값은 읽기 전용입니다. `.env`의 CHAT_* 값이 정하고,
 * 바꾸려면 서버를 다시 시작합니다 — 화면에서 바꿀 수 있게 하면 배포마다
 * 다른 값이 숨어 있게 됩니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import {
  formatWhen,
  getClaudeSettings,
  setExchangeRate,
  type ClaudeSettings,
} from "@/lib/admin";
import { describeError } from "@/lib/http";

import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

const THINKING_LABEL: Record<string, string> = {
  off: "끔 (끌 수 있는 모델에서)",
  on: "켬",
};

export default function ClaudePricingPanel() {
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const apply = useCallback((value: ClaudeSettings) => {
    setSettings(value);
    setRateDraft(value.exchange_rate?.krw_per_usd ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    getClaudeSettings()
      .then((value) => {
        if (!cancelled) apply(value);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  /** 확인창을 띄우고, 확인하면 `run`을 부릅니다. */
  const ask = useCallback(
    (request: Omit<ConfirmRequest, "onConfirm">, run: () => Promise<ClaudeSettings>, done: string) => {
      setConfirmError(null);
      setConfirm({
        ...request,
        onConfirm: async () => {
          setBusy(true);
          try {
            apply(await run());
            setSaved(done);
            setConfirm(null);
          } catch (caught) {
            setConfirmError(describeError(caught));
          } finally {
            setBusy(false);
          }
        },
      });
    },
    [apply],
  );

  const askRate = () => {
    ask(
      {
        title: "환율을 바꿀까요?",
        effect: [
          `1달러 = ${settings?.exchange_rate?.krw_per_usd ?? "?"}원 → ${rateDraft}원`,
          "이후의 모든 Claude 사용분이 새 환율로 원화 계산됩니다. 이미 차감된 기록은 그대로입니다.",
          "이전 환율은 기록으로 남습니다.",
        ],
        confirmLabel: "환율 바꾸기",
      },
      () => setExchangeRate(rateDraft),
      "환율을 저장했습니다.",
    );
  };

  return (
    <section aria-labelledby="admin-claude-pricing">
      <h2 className="section-title" id="admin-claude-pricing">
        Claude 환율과 설정
        <span className={styles.sectionNote}>
          Chat 답장과 프롬프트 도움은 쓴 토큰만큼 동아리 지원(Build)에서 차감됩니다
        </span>
      </h2>

      {error !== null && (
        <div className="card">
          <p className="small muted">Claude 설정을 불러오지 못했습니다. {error}.</p>
        </div>
      )}
      {error === null && settings === null && <p className="small muted">불러오는 중…</p>}

      {settings !== null && (
        <div className={`card ${styles.pricingCard}`}>
          <dl className={styles.factTiles}>
            <div>
              <dt>기본 모델</dt>
              <dd>
                {settings.default_model_label
                  ? `${settings.default_model_label}${settings.is_mock ? " (mock — 이 요금으로 계산)" : ""}`
                  : `목록 비어 있음 — ${settings.fallback_model || "설정 안 됨"}`}
              </dd>
            </div>
            <div>
              <dt>생각(thinking)</dt>
              <dd>
                {THINKING_LABEL[settings.thinking] ?? settings.thinking} · 노력 {settings.effort}
              </dd>
            </div>
            <div>
              <dt>답장 한도</dt>
              <dd className="numeric">
                출력 {settings.max_output_tokens.toLocaleString()} 토큰 · 대화 기록{" "}
                {settings.context_tokens.toLocaleString()} 토큰
              </dd>
            </div>
            <div>
              <dt>회원당 보내기</dt>
              <dd className="numeric">1분에 {settings.rate_limit_per_minute}개</dd>
            </div>
          </dl>
          <p className={styles.pricingNote}>
            생각과 한도는 .env의 CHAT_* 값으로 정하고 서버를 다시 시작하면 바뀝니다. 모델과
            모델별 요금, 회원이 고를 수 있는 모델은{" "}
            <Link href="/admin/claude-models">{sectionLabel("claude-models")}</Link>에서
            정합니다.
          </p>

          <div className={styles.rateBlock}>
            <label className={styles.rateLabel} htmlFor="claude-exchange-rate">
              환율 (1달러 = 원)
            </label>
            <div className={styles.rateRow}>
              <input
                className={`field numeric ${styles.rateField}`}
                id="claude-exchange-rate"
                inputMode="decimal"
                value={rateDraft}
                onChange={(event) => setRateDraft(event.target.value)}
              />
              <button
                className="btn btn-sm"
                type="button"
                disabled={!rateDraft || rateDraft === settings.exchange_rate?.krw_per_usd}
                onClick={askRate}
              >
                저장
              </button>
            </div>
            {settings.rate_history.length > 0 && (
              <ul className={styles.rateHistory}>
                {settings.rate_history.map((rate) => (
                  <li key={rate.set_at} className="numeric">
                    {formatWhen(rate.set_at)} · {Number(rate.krw_per_usd).toLocaleString()}원
                    {rate.set_by_username ? ` · ${rate.set_by_username}` : " · 처음 값"}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {saved !== null && (
            <p className={`${styles.result} ${styles.resultOk} ${styles.pricingSaved}`} role="status">
              {saved}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        busy={busy}
        error={confirmError}
      />
    </section>
  );
}
