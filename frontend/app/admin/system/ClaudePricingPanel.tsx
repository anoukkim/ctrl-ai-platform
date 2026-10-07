"use client";

/**
 * Admin — Claude 요금 (시스템 화면, 외부 서비스 아래)
 *
 * Chat 답장과 프롬프트 도움 한 번의 값은 두 숫자로 정해집니다: 모델의
 * 토큰 요금(달러, 100만 토큰당)과 환율(1달러 = 몇 원). 둘 다 코드가
 * 아니라 여기서 바꿉니다. 바꾸면 **그 뒤의** 사용분부터 적용되고, 이미
 * 차감된 기록은 그때의 요금과 환율을 그대로 갖고 있습니다. 바꾼 사람과
 * 전후 값은 감사 기록에 남습니다.
 *
 * 위쪽의 모델과 한도는 읽기 전용입니다. `.env`의 ANTHROPIC_MODEL과
 * CHAT_* 값이 정하고, 바꾸려면 서버를 다시 시작합니다 — 화면에서 바꿀 수
 * 있게 하면 배포마다 다른 값이 숨어 있게 됩니다.
 */

import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import {
  formatWhen,
  getClaudeSettings,
  saveClaudePrice,
  setExchangeRate,
  typicalReplyKrw,
  type ClaudeModelPrice,
  type ClaudeSettings,
} from "@/lib/admin";
import { describeError } from "@/lib/http";

import styles from "../admin.module.css";

interface Draft {
  input: string;
  output: string;
}

const THINKING_LABEL: Record<string, string> = {
  off: "끔 (끌 수 있는 모델에서)",
  on: "켬",
};

export default function ClaudePricingPanel() {
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rateDraft, setRateDraft] = useState("");
  const [newModel, setNewModel] = useState({ id: "", input: "", output: "" });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const apply = useCallback((value: ClaudeSettings) => {
    setSettings(value);
    setDrafts(
      Object.fromEntries(
        value.prices.map((price) => [
          price.model_id,
          { input: price.input_usd_per_mtok, output: price.output_usd_per_mtok },
        ]),
      ),
    );
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

  const askPrice = (price: ClaudeModelPrice) => {
    const draft = drafts[price.model_id];
    ask(
      {
        title: `${price.display_name || price.model_id} 요금을 바꿀까요?`,
        effect: [
          `입력 $${price.input_usd_per_mtok} → $${draft.input}, 출력 $${price.output_usd_per_mtok} → $${draft.output} (100만 토큰당)`,
          "이 모델로 하는 이후의 모든 답장 비용이 바뀝니다. 이미 차감된 기록은 그대로입니다.",
          "감사 기록에 남습니다.",
        ],
        confirmLabel: "요금 바꾸기",
      },
      () =>
        saveClaudePrice(price.model_id, {
          input_usd_per_mtok: draft.input,
          output_usd_per_mtok: draft.output,
        }),
      `${price.model_id} 요금을 저장했습니다.`,
    );
  };

  const askNewModel = () => {
    const id = newModel.id.trim();
    ask(
      {
        title: `${id} 모델을 추가할까요?`,
        effect: [
          `입력 $${newModel.input} · 출력 $${newModel.output} (100만 토큰당)`,
          "ANTHROPIC_MODEL을 이 모델로 바꾸면 이 요금으로 계산됩니다.",
        ],
        confirmLabel: "추가",
      },
      async () => {
        const value = await saveClaudePrice(id, {
          input_usd_per_mtok: newModel.input,
          output_usd_per_mtok: newModel.output,
        });
        setNewModel({ id: "", input: "", output: "" });
        return value;
      },
      `${id} 모델을 추가했습니다.`,
    );
  };

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
        Claude 요금
        <span className={styles.sectionNote}>
          Chat 답장과 프롬프트 도움은 쓴 토큰만큼 동아리 지원(Build)에서 차감됩니다
        </span>
      </h2>

      {error !== null && (
        <div className="card">
          <p className="small muted">Claude 요금을 불러오지 못했습니다. {error}.</p>
        </div>
      )}
      {error === null && settings === null && <p className="small muted">불러오는 중…</p>}

      {settings !== null && (
        <div className={`card ${styles.pricingCard}`}>
          <dl className={styles.factTiles}>
            <div>
              <dt>모델</dt>
              <dd className="numeric">
                {settings.is_mock
                  ? `mock — ${settings.priced_as} 요금으로 계산`
                  : settings.model || "설정 안 됨"}
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
            모델과 한도는 .env의 ANTHROPIC_MODEL, CHAT_* 값으로 정하고 서버를 다시 시작하면
            바뀝니다.
          </p>

          <div className={`table-wrap ${styles.priceTable}`}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">모델</th>
                  <th scope="col">입력 $/100만 토큰</th>
                  <th scope="col">출력 $/100만 토큰</th>
                  <th scope="col">답장 1번 약</th>
                  <th scope="col">
                    <span className="sr-only">저장</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settings.prices.map((price) => {
                  const draft = drafts[price.model_id] ?? { input: "", output: "" };
                  const changed =
                    draft.input !== price.input_usd_per_mtok ||
                    draft.output !== price.output_usd_per_mtok;
                  const inUse = price.model_id === settings.priced_as;
                  return (
                    <tr key={price.model_id}>
                      <td>
                        <span className="numeric">{price.model_id}</span>
                        {inUse && (
                          <span className={`badge badge-accent ${styles.inUseBadge}`}>
                            사용 중
                          </span>
                        )}
                      </td>
                      {(["input", "output"] as const).map((field) => (
                        <td key={field}>
                          <input
                            className={`field numeric ${styles.priceField}`}
                            aria-label={`${price.model_id} ${field === "input" ? "입력" : "출력"} 요금`}
                            inputMode="decimal"
                            value={draft[field]}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [price.model_id]: { ...draft, [field]: event.target.value },
                              }))
                            }
                          />
                        </td>
                      ))}
                      <td className="numeric">
                        {settings.exchange_rate
                          ? `${typicalReplyKrw(price, settings.exchange_rate.krw_per_usd).toLocaleString()}원`
                          : "—"}
                      </td>
                      <td>
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={!changed}
                          onClick={() => askPrice(price)}
                        >
                          저장
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>
                    <input
                      className={`field numeric ${styles.priceModelField}`}
                      aria-label="추가할 모델 ID"
                      placeholder="claude-…"
                      value={newModel.id}
                      onChange={(event) => setNewModel({ ...newModel, id: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className={`field numeric ${styles.priceField}`}
                      aria-label="추가할 모델 입력 요금"
                      inputMode="decimal"
                      value={newModel.input}
                      onChange={(event) => setNewModel({ ...newModel, input: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className={`field numeric ${styles.priceField}`}
                      aria-label="추가할 모델 출력 요금"
                      inputMode="decimal"
                      value={newModel.output}
                      onChange={(event) => setNewModel({ ...newModel, output: event.target.value })}
                    />
                  </td>
                  <td />
                  <td>
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={!newModel.id.trim() || !newModel.input || !newModel.output}
                      onClick={askNewModel}
                    >
                      추가
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={styles.pricingNote}>
            &quot;답장 1번 약&quot;은 입력 2,000 · 출력 800 토큰으로 어림한 값입니다.
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
