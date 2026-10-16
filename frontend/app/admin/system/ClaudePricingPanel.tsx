"use client";

/**
 * Admin › System — 환율, 채팅 한도, 서버 설정 (.env). 외부 서비스 아래.
 *
 * 관심사 하나에 구역 하나, 같은 값은 한 번만 (fix-ui-polish-admin,
 * 2026-10-14):
 *   환율            — 고칠 수 있음. 답장 한 번의 값 = 모델 토큰 요금 × 환율.
 *   채팅 한도        — 고칠 수 있음 (생각 깊이마다 최대 출력과 1회 한도 —
 *                     채팅과 빌더 따로, 대화 기억, 응답 대기, 긴 대화 경고,
 *                     하루 한도, 동시 호출, 페이지 읽기 한도).
 *   서버 설정 (.env) — 읽기 전용. `.env`의 CHAT_* 값이 정하고, 바꾸려면
 *                     서버를 다시 시작합니다 — 화면에서 바꿀 수 있게 하면
 *                     배포마다 다른 값이 숨어 있게 됩니다.
 * 기본 모델과 모델별 요금은 Admin › AI Models에 있고 여기서는 그리로
 * 연결만 합니다. 고친 값은 **그 뒤의** 사용분부터 적용되고, 바꾼 사람과
 * 전후 값은 감사 기록에 남습니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import {
  formatWhen,
  getClaudeSettings,
  setChatLimits,
  setExchangeRate,
  type ClaudeSettings,
  type DepthSurface,
  type DepthTable,
} from "@/lib/admin";
import { DEPTH_LABEL } from "@/lib/depth";
import { describeError } from "@/lib/http";

import { sectionLabel } from "../sections";

import styles from "../admin.module.css";
import Skeleton from "@/app/components/Skeleton";

const THINKING_LABEL: Record<string, string> = {
  off: "끔 (끌 수 있는 모델에서)",
  on: "켬",
};

const DEPTH_SURFACES: DepthSurface[] = ["chat", "builder"];
const DEPTH_SURFACE_LABEL: Record<DepthSurface, string> = { chat: "채팅", builder: "빌더" };
const DEPTH_LEVELS = ["low", "medium", "high", "max"] as const;

export default function ClaudePricingPanel() {
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [limitsDraft, setLimitsDraft] = useState({
    reply_cap_krw: "",
    long_history_tokens: "",
    daily_cap_krw: "",
    provider_concurrency: "",
    web_fetch_max_uses: "",
    web_fetch_max_content_tokens: "",
    web_search_max_uses: "",
    app_ai_daily_cap_krw: "",
    context_tokens: "",
    timeout_seconds: "",
  });
  /** 생각 깊이 표(quality-tuning Q1): 채팅·빌더 × 깊이마다 최대 출력과 1회 한도. */
  const [depthDraft, setDepthDraft] = useState<Record<string, string>>({});

  const apply = useCallback((value: ClaudeSettings) => {
    setSettings(value);
    setRateDraft(value.exchange_rate?.krw_per_usd ?? "");
    setLimitsDraft({
      reply_cap_krw: String(value.chat_limits.reply_cap_krw),
      long_history_tokens: String(value.chat_limits.long_history_tokens),
      daily_cap_krw: String(value.chat_limits.daily_cap_krw),
      provider_concurrency: String(value.chat_limits.provider_concurrency),
      web_fetch_max_uses: String(value.chat_limits.web_fetch_max_uses),
      web_fetch_max_content_tokens: String(value.chat_limits.web_fetch_max_content_tokens),
      web_search_max_uses: String(value.chat_limits.web_search_max_uses ?? 5),
      app_ai_daily_cap_krw: String(value.chat_limits.app_ai_daily_cap_krw ?? 2000),
      context_tokens: String(value.chat_limits.context_tokens ?? 64000),
      timeout_seconds: String(value.chat_limits.timeout_seconds ?? 180),
    });
    const table: Record<string, string> = {};
    const levels = value.chat_limits.depth_levels;
    if (levels) {
      for (const surface of DEPTH_SURFACES) {
        for (const level of DEPTH_LEVELS) {
          table[`${surface}.${level}.max_tokens`] = String(levels[surface][level].max_tokens);
          table[`${surface}.${level}.cap_krw`] = String(levels[surface][level].cap_krw);
          table[`${surface}.${level}.total_cap_krw`] = String(levels[surface][level].total_cap_krw ?? 0);
        }
      }
    }
    setDepthDraft(table);
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

  const depthTable = (): DepthTable | undefined => {
    if (Object.keys(depthDraft).length === 0) return undefined;
    const out = {} as DepthTable;
    for (const surface of DEPTH_SURFACES) {
      out[surface] = {} as DepthTable[DepthSurface];
      for (const level of DEPTH_LEVELS) {
        out[surface][level] = {
          max_tokens: Number(depthDraft[`${surface}.${level}.max_tokens`]),
          cap_krw: Number(depthDraft[`${surface}.${level}.cap_krw`]),
          // 비워 둔 칸은 "그대로": 0은 이어 쓰기를 끄는 값이라 직접 적어야 합니다.
          total_cap_krw:
            (depthDraft[`${surface}.${level}.total_cap_krw`] ?? "").trim() === ""
              ? (settings?.chat_limits.depth_levels?.[surface]?.[level]?.total_cap_krw ?? 0)
              : Number(depthDraft[`${surface}.${level}.total_cap_krw`]),
        };
      }
    }
    return out;
  };

  /** 깊이 표가 서버의 값과 다른지. */
  const depthChanged = (): boolean => {
    const levels = settings?.chat_limits.depth_levels;
    if (!levels) return false;
    return DEPTH_SURFACES.some((surface) =>
      DEPTH_LEVELS.some((level) => {
        // 비워 둔 전체 칸은 "그대로"라 바뀐 것으로 치지 않습니다 (depthTable과 같은 규칙).
        const totalDraft = (depthDraft[`${surface}.${level}.total_cap_krw`] ?? "").trim();
        const totalServer = levels[surface][level].total_cap_krw ?? 0;
        return (
          Number(depthDraft[`${surface}.${level}.max_tokens`]) !== levels[surface][level].max_tokens ||
          Number(depthDraft[`${surface}.${level}.cap_krw`]) !== levels[surface][level].cap_krw ||
          (totalDraft === "" ? totalServer : Number(totalDraft)) !== totalServer
        );
      }),
    );
  };

  const askLimits = () => {
    const table = depthTable();
    const next = {
      depth_levels: table,
      context_tokens: Number(limitsDraft.context_tokens),
      timeout_seconds: Number(limitsDraft.timeout_seconds),
      reply_cap_krw: Number(limitsDraft.reply_cap_krw),
      long_history_tokens: Number(limitsDraft.long_history_tokens),
      daily_cap_krw: Number(limitsDraft.daily_cap_krw),
      provider_concurrency: Number(limitsDraft.provider_concurrency),
      web_fetch_max_uses: Number(limitsDraft.web_fetch_max_uses),
      web_fetch_max_content_tokens: Number(limitsDraft.web_fetch_max_content_tokens),
      web_search_max_uses: Number(limitsDraft.web_search_max_uses),
      app_ai_daily_cap_krw: Number(limitsDraft.app_ai_daily_cap_krw),
    };
    const won = (value: number) => (value > 0 ? `${value.toLocaleString()}원` : "끔 (0)");
    ask(
      {
        title: "채팅 한도를 바꿀까요?",
        effect: [
          `답장 1회 비용 한도: ${won(next.reply_cap_krw)} — 답장이 이 금액에 닿으면 멈추고, 쓴 만큼만 차감됩니다.`,
          `긴 대화 경고: 입력 ${next.long_history_tokens.toLocaleString()} 토큰부터 (0이면 경고 없음)`,
          `하루 한도: ${won(next.daily_cap_krw)} — 회원마다, 모든 유료 기능 합산 (KST 기준)`,
          `동시 호출: ${next.provider_concurrency}개 — 서버 프로세스마다, AI 호출을 한 번에 이만큼만`,
          `페이지 읽기: 한 답장에 ${next.web_fetch_max_uses}회, 페이지당 ${next.web_fetch_max_content_tokens.toLocaleString()}토큰 — 1회 비용 한도가 미리 떼어 두는 양이라, 줄이면 낮은 한도에서도 쓸 수 있습니다`,
          `웹 검색: 한 답장에 최대 ${next.web_search_max_uses}회 — 검색 요금과 결과가 1회 비용 한도 안에 미리 잡힙니다`,
          `앱 AI 하루 한도: ${won(next.app_ai_daily_cap_krw)} — 방문자마다, 회원 앱들 안에서 쓴 AI 합산 (KST 기준)`,
          `대화 기억: ${next.context_tokens.toLocaleString()}토큰 · 응답 대기 ${next.timeout_seconds}초`,
          ...(table
            ? DEPTH_SURFACES.map(
                (surface) =>
                  `${DEPTH_SURFACE_LABEL[surface]} 생각 깊이: ` +
                  DEPTH_LEVELS.map(
                    (level) =>
                      `${DEPTH_LABEL[level]} ${table[surface][level].max_tokens.toLocaleString()}토큰/${won(table[surface][level].cap_krw)}` +
                      (table[surface][level].total_cap_krw ? `/전체 ${won(table[surface][level].total_cap_krw ?? 0)}` : ""),
                  ).join(" · "),
              )
            : []),
          "감사 기록에 남습니다.",
        ],
        confirmLabel: "한도 바꾸기",
      },
      () => setChatLimits(next),
      "채팅 한도를 저장했습니다.",
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

  const loading = (
    <>
      {error !== null && (
        <div className="card">
          <p className="small muted">설정을 불러오지 못했습니다. {error}.</p>
        </div>
      )}
      {error === null && settings === null && <Skeleton />}
    </>
  );

  return (
    <>
      <section aria-labelledby="admin-exchange-rate">
        <h2 className="section-title" id="admin-exchange-rate">
          환율
          <span className={styles.sectionNote}>
            답장 한 번의 값 = 모델의 토큰 요금 × 환율, 동아리 지원 지갑에서 차감
          </span>
        </h2>

        {loading}

        {settings !== null && (
          <div className={`card ${styles.pricingCard}`}>
            <p className={styles.pricingNote}>
              기본 모델과 모델별 요금, 회원이 고를 수 있는 모델은{" "}
              <Link href="/admin/ai-models">{sectionLabel("ai-models")}</Link>에서 정합니다.
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
            {saved?.startsWith("환율") && (
              <p className={`${styles.result} ${styles.resultOk} ${styles.pricingSaved}`} role="status">
                {saved}
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="admin-chat-limits">
        <h2 className="section-title" id="admin-chat-limits">
          채팅 한도
          <span className={styles.sectionNote}>0은 그 한도를 끕니다</span>
        </h2>

        {loading}

        {settings !== null && (
          <div className={`card ${styles.pricingCard}`}>
            <div className={styles.rateBlock}>
              <div className={styles.limitsGrid} aria-labelledby="admin-chat-limits">
                <label className={styles.limitField}>
                  <span>대화 기억 (토큰, 4,000–400,000)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.context_tokens}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({ ...current, context_tokens: event.target.value }))
                    }
                  />
                </label>
                <label className={styles.limitField}>
                  <span>응답 대기 (초, 30–600)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.timeout_seconds}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({ ...current, timeout_seconds: event.target.value }))
                    }
                  />
                </label>
                <label className={styles.limitField}>
                  <span>긴 대화 경고 (입력 토큰)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.long_history_tokens}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({
                        ...current,
                        long_history_tokens: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.limitField}>
                  <span>하루 한도 (원, 회원마다)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.daily_cap_krw}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({ ...current, daily_cap_krw: event.target.value }))
                    }
                  />
                </label>
                <label className={styles.limitField}>
                  <span>동시 호출 (프로세스마다, 1 이상)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.provider_concurrency}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({
                        ...current,
                        provider_concurrency: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.limitField}>
                  <span>페이지 읽기 (한 답장에 몇 회, 1–5)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.web_fetch_max_uses}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({
                        ...current,
                        web_fetch_max_uses: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.limitField}>
                  <span>웹 검색 (한 답장에 몇 회, 1–10)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.web_search_max_uses}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({
                        ...current,
                        web_search_max_uses: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.limitField}>
                  <span>앱 AI 하루 한도 (원, 방문자마다, 0 = 끔)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.app_ai_daily_cap_krw}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({
                        ...current,
                        app_ai_daily_cap_krw: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.limitField}>
                  <span>페이지당 토큰 (1,000–100,000)</span>
                  <input
                    className="field numeric"
                    inputMode="numeric"
                    value={limitsDraft.web_fetch_max_content_tokens}
                    onChange={(event) =>
                      setLimitsDraft((current) => ({
                        ...current,
                        web_fetch_max_content_tokens: event.target.value,
                      }))
                    }
                  />
                </label>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={
                    [
                      limitsDraft.context_tokens,
                      limitsDraft.timeout_seconds,
                      ...Object.values(depthDraft),
                      limitsDraft.long_history_tokens,
                      limitsDraft.daily_cap_krw,
                      limitsDraft.provider_concurrency,
                      limitsDraft.web_fetch_max_uses,
                      limitsDraft.web_fetch_max_content_tokens,
                      limitsDraft.web_search_max_uses,
                      limitsDraft.app_ai_daily_cap_krw,
                    ].some((value) => value.trim() === "" || !Number.isInteger(Number(value))) ||
                    Number(limitsDraft.provider_concurrency) < 1 ||
                    Number(limitsDraft.web_fetch_max_uses) < 1 ||
                    Number(limitsDraft.web_search_max_uses) < 1 ||
                    Number(limitsDraft.web_search_max_uses) > 10 ||
                    Number(limitsDraft.web_fetch_max_content_tokens) < 1000 ||
                    (!depthChanged() &&
                      Number(limitsDraft.context_tokens) === (settings.chat_limits.context_tokens ?? 64000) &&
                      Number(limitsDraft.timeout_seconds) === (settings.chat_limits.timeout_seconds ?? 180) &&
                      Number(limitsDraft.app_ai_daily_cap_krw) ===
                        (settings.chat_limits.app_ai_daily_cap_krw ?? 2000) &&
                      Number(limitsDraft.long_history_tokens) ===
                        settings.chat_limits.long_history_tokens &&
                      Number(limitsDraft.daily_cap_krw) === settings.chat_limits.daily_cap_krw &&
                      Number(limitsDraft.provider_concurrency) ===
                        settings.chat_limits.provider_concurrency &&
                      Number(limitsDraft.web_fetch_max_uses) ===
                        settings.chat_limits.web_fetch_max_uses &&
                      Number(limitsDraft.web_fetch_max_content_tokens) ===
                        settings.chat_limits.web_fetch_max_content_tokens &&
                      Number(limitsDraft.web_search_max_uses) ===
                        (settings.chat_limits.web_search_max_uses ?? 5))
                  }
                  onClick={askLimits}
                >
                  저장
                </button>
              </div>
              {Object.keys(depthDraft).length > 0 && (
                <table className={styles.depthTable} data-testid="depth-table">
                  <caption>
                    생각 깊이 — 회원이 고른 깊이마다 최대 출력(토큰), 1회 한도(원), 전체 한도(원). 회원
                    화면의 &ldquo;(최대 M원)&rdquo;이 1회 한도이고, 답장이 거기에 닿으면 서버가 전체 한도까지
                    스스로 이어 씁니다 (채팅만; 0이면 이어 쓰지 않음).
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">기능</th>
                      {DEPTH_LEVELS.map((level) => (
                        <th scope="col" key={level}>
                          {DEPTH_LABEL[level]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DEPTH_SURFACES.map((surface) => (
                      <tr key={surface}>
                        <th scope="row">{DEPTH_SURFACE_LABEL[surface]}</th>
                        {DEPTH_LEVELS.map((level) => (
                          <td key={level} data-level={DEPTH_LABEL[level]}>
                            <label className={styles.depthCell}>
                              <span className="sr-only">
                                {DEPTH_SURFACE_LABEL[surface]} {DEPTH_LABEL[level]} 최대 출력 토큰
                              </span>
                              <input
                                className="field numeric"
                                inputMode="numeric"
                                value={depthDraft[`${surface}.${level}.max_tokens`] ?? ""}
                                onChange={(event) =>
                                  setDepthDraft((current) => ({
                                    ...current,
                                    [`${surface}.${level}.max_tokens`]: event.target.value,
                                  }))
                                }
                              />
                              <span aria-hidden="true">토큰</span>
                            </label>
                            <label className={styles.depthCell}>
                              <span className="sr-only">
                                {DEPTH_SURFACE_LABEL[surface]} {DEPTH_LABEL[level]} 1회 한도 원
                              </span>
                              <input
                                className="field numeric"
                                inputMode="numeric"
                                value={depthDraft[`${surface}.${level}.cap_krw`] ?? ""}
                                onChange={(event) =>
                                  setDepthDraft((current) => ({
                                    ...current,
                                    [`${surface}.${level}.cap_krw`]: event.target.value,
                                  }))
                                }
                              />
                              <span aria-hidden="true">원</span>
                            </label>
                            {surface === "chat" && (
                              <label className={styles.depthCell}>
                                <span className="sr-only">
                                  {DEPTH_SURFACE_LABEL[surface]} {DEPTH_LABEL[level]} 전체 한도 원
                                </span>
                                <input
                                  className="field numeric"
                                  inputMode="numeric"
                                  value={depthDraft[`${surface}.${level}.total_cap_krw`] ?? ""}
                                  onChange={(event) =>
                                    setDepthDraft((current) => ({
                                      ...current,
                                      [`${surface}.${level}.total_cap_krw`]: event.target.value,
                                    }))
                                  }
                                />
                                <span aria-hidden="true">원 전체</span>
                              </label>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className={styles.pricingNote}>
                답장이 그 깊이의 1회 한도에 닿으면 서버가 같은 답장 안에서 스스로 이어 씁니다 — 호출마다
                1회 한도 아래에서, 호출마다 지갑을 먼저 확인하고, 답장 전체가 전체 한도에 닿거나 지갑이
                모자라면 거기서 멈춥니다(회원은 &lsquo;이어서 쓰기&rsquo;로 이어 받을 수 있어요). 최대 출력은
                1,024–64,000토큰, 1회 한도는 10–5,000원, 전체 한도는 0(이어 쓰지 않음) 또는 1회 한도 이상
                50,000원 이하로 정해요. 긴 대화 경고는
                입력창 위에 &lsquo;새 대화로 시작하면 아낄 수 있어요&rsquo;를 띄웁니다. 하루 한도는 회원마다
                모든 유료 기능을 합산해 적용됩니다 (0 = 없음).
                {settings.chat_limits.set_at
                  ? ` 마지막 변경: ${formatWhen(settings.chat_limits.set_at)}${
                      settings.chat_limits.set_by_username
                        ? ` · ${settings.chat_limits.set_by_username}`
                        : ""
                    }`
                  : " 아직 바꾼 적이 없습니다 (기본값)."}
              </p>
            </div>

            {saved?.startsWith("채팅") && (
              <p className={`${styles.result} ${styles.resultOk} ${styles.pricingSaved}`} role="status">
                {saved}
              </p>
            )}
          </div>
        )}
      </section>

      {settings !== null && (
        <section aria-labelledby="admin-env-settings">
          <h2 className="section-title" id="admin-env-settings">
            서버 설정 (.env)
            <span className={styles.sectionNote}>읽기 전용 — .env를 고치고 서버를 다시 시작하면 바뀝니다</span>
          </h2>
          <div className="card">
            <dl className={styles.envList}>
              <dt>회원당 보내기</dt>
              <dd className="numeric">1분에 {settings.rate_limit_per_minute}개</dd>
              <dt>프롬프트 캐시</dt>
              <dd>
                {settings.cache_ttl
                  ? `켜짐 · ${settings.cache_ttl === "1h" ? "1시간" : "5분"} 보관`
                  : "꺼짐"}
              </dd>
              <dt>생각(thinking)</dt>
              <dd>
                {THINKING_LABEL[settings.thinking] ?? settings.thinking} · 노력 {settings.effort} (생각 깊이가 없는 호출의 기본값)
              </dd>
            </dl>
          </div>
        </section>
      )}

      <ConfirmDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        busy={busy}
        error={confirmError}
      />
    </>
  );
}
