"use client";

/**
 * Admin › System — 환율, 서버 설정 (.env) · Admin › Models › 한도 — 채팅 한도.
 *
 * admin-ui-unify: 한도는 PanelBar(? 설명 · "0은 그 한도를 끕니다" · 저장 줄)
 * 아래 SettingsCard 세 장(대화 · 돈 · 도구·서버)과 넓은 "생각 깊이" 카드 —
 * 제목은 틀(AdminFrame)이 그립니다. System 쪽은 Fold 그대로, 안을 같은 부품으로.
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
  refreshExchangeRate,
  setChatLimits,
  setExchangeRate,
  setExchangeRateAuto,
  type ClaudeSettings,
  type DepthSurface,
  type DepthTable,
} from "@/lib/admin";
import { DEPTH_LABEL } from "@/lib/depth";
import { describeError } from "@/lib/http";

import Skeleton from "@/app/components/Skeleton";

import {
  NumField,
  PanelBar,
  SaveBar,
  SettingsCard,
  SettingsGrid,
  Stack,
  StatusStrip,
} from "../components/AdminUI";
import Fold from "../components/Fold";
import local from "../models/models.module.css";
import { sectionLabel } from "../sections";

const THINKING_LABEL: Record<string, string> = {
  off: "끔 (끌 수 있는 모델에서)",
  on: "켬",
};

const DEPTH_SURFACES: DepthSurface[] = ["chat", "builder"];
const DEPTH_SURFACE_LABEL: Record<DepthSurface, string> = { chat: "채팅", builder: "빌더" };
const DEPTH_LEVELS = ["low", "medium", "high", "max"] as const;

/** 생각 깊이 표의 줄: 기능 · 값마다 한 줄, 열은 깊이(낮음 보통 높음 최고). 전체 한도는 채팅만. */
const DEPTH_ROWS: {
  surface: DepthSurface;
  field: "max_tokens" | "cap_krw" | "total_cap_krw";
  label: string;
  unit: string;
  srUnit: string;
}[] = [
  { surface: "chat", field: "max_tokens", label: "출력", unit: "토큰", srUnit: "최대 출력 토큰" },
  { surface: "chat", field: "cap_krw", label: "1회 한도", unit: "원", srUnit: "1회 한도 원" },
  { surface: "chat", field: "total_cap_krw", label: "전체 한도", unit: "원", srUnit: "전체 한도 원" },
  { surface: "builder", field: "max_tokens", label: "출력", unit: "토큰", srUnit: "최대 출력 토큰" },
  { surface: "builder", field: "cap_krw", label: "1회 한도", unit: "원", srUnit: "1회 한도 원" },
];

type LimitsDraft = Record<
  | "reply_cap_krw"
  | "long_history_tokens"
  | "daily_cap_krw"
  | "provider_concurrency"
  | "web_fetch_max_uses"
  | "web_fetch_max_content_tokens"
  | "web_search_max_uses"
  | "app_ai_daily_cap_krw"
  | "context_tokens"
  | "timeout_seconds",
  string
>;

/** 칸마다 서버의 지금 값(옛 응답에 없는 칸은 서버의 기본값). */
function serverLimits(settings: ClaudeSettings): Record<keyof LimitsDraft, number> {
  const limits = settings.chat_limits;
  return {
    reply_cap_krw: limits.reply_cap_krw,
    long_history_tokens: limits.long_history_tokens,
    daily_cap_krw: limits.daily_cap_krw,
    provider_concurrency: limits.provider_concurrency,
    web_fetch_max_uses: limits.web_fetch_max_uses,
    web_fetch_max_content_tokens: limits.web_fetch_max_content_tokens,
    web_search_max_uses: limits.web_search_max_uses ?? 5,
    app_ai_daily_cap_krw: limits.app_ai_daily_cap_krw ?? 2000,
    context_tokens: limits.context_tokens ?? 64000,
    timeout_seconds: limits.timeout_seconds ?? 180,
  };
}

/** 서버의 값과 다른 칸들. */
function changedLimitKeys(draft: LimitsDraft, settings: ClaudeSettings): (keyof LimitsDraft)[] {
  const server = serverLimits(settings);
  return (Object.keys(server) as (keyof LimitsDraft)[]).filter((key) => Number(draft[key]) !== server[key]);
}

/**
 * admin-consolidation v3 (2): System keeps 환율 and 서버 설정 (`part="system"`);
 * 채팅 한도 moved to Models › 한도 (`part="limits"`, shown open).
 */
export default function ClaudePricingPanel({ part = "system" }: { part?: "system" | "limits" }) {
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [limitsDraft, setLimitsDraft] = useState<LimitsDraft>({
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

  /** 깊이 표에서 서버의 값과 다른 칸 수. */
  const depthChangedCount = (): number => {
    const levels = settings?.chat_limits.depth_levels;
    if (!levels) return 0;
    let count = 0;
    for (const surface of DEPTH_SURFACES) {
      for (const level of DEPTH_LEVELS) {
        const server = levels[surface][level];
        // 비워 둔 전체 칸은 "그대로"라 바뀐 것으로 치지 않습니다 (depthTable과 같은 규칙).
        const totalDraft = (depthDraft[`${surface}.${level}.total_cap_krw`] ?? "").trim();
        const totalServer = server.total_cap_krw ?? 0;
        if (Number(depthDraft[`${surface}.${level}.max_tokens`]) !== server.max_tokens) count += 1;
        if (Number(depthDraft[`${surface}.${level}.cap_krw`]) !== server.cap_krw) count += 1;
        if ((totalDraft === "" ? totalServer : Number(totalDraft)) !== totalServer) count += 1;
      }
    }
    return count;
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
          "직접 적은 환율은 고정됩니다 — 자동 반영이 꺼져요. 다시 켜면 하루 한 번 새 환율을 받아 옵니다.",
          "이전 환율은 기록으로 남습니다.",
        ],
        confirmLabel: "환율 바꾸기",
      },
      () => setExchangeRate(rateDraft),
      "환율을 저장했습니다. 자동 반영은 꺼졌어요.",
    );
  };

  // owner-polish-3 (b): 자동 반영 — 하루 한 번 무료 공개 환율(ECB · Frankfurter)을
  // 받아 와요. 5% 넘는 변동은 반영하지 않고 경고로, 실패하면 마지막 환율 그대로.
  const askAuto = (on: boolean) => {
    ask(
      {
        title: on ? "환율 자동 반영을 켤까요?" : "지금 환율을 고정할까요?",
        effect: on
          ? [
              "하루 한 번 공개 환율(ECB, Frankfurter — 무료, 키 없음)을 받아 옵니다.",
              `하루 사이 ${settings?.fx.max_jump_pct ?? 5}%를 넘는 변동은 반영하지 않고 여기에 경고로 보여 줍니다.`,
              "받아 오지 못하면 마지막 환율을 그대로 씁니다. 차감은 멈추지 않아요.",
              "반영될 때마다 감사 기록에 남습니다.",
            ]
          : ["지금 환율이 그대로 유지됩니다. 자동으로 받아 오지 않아요.", "감사 기록에 남습니다."],
        confirmLabel: on ? "자동 반영 켜기" : "환율 고정",
      },
      () => setExchangeRateAuto(on),
      on ? "환율 자동 반영을 켰습니다." : "환율을 고정했습니다.",
    );
  };

  const refreshNow = async () => {
    setBusy(true);
    setSaved(null);
    try {
      const next = await refreshExchangeRate();
      apply(next);
      setSaved(`환율 확인: ${next.fx.outcome_label}.`);
    } catch (caught) {
      setSaved(`환율 확인 실패: ${describeError(caught)}`);
    } finally {
      setBusy(false);
    }
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

  const setLimit = (key: keyof typeof limitsDraft) => (value: string) =>
    setLimitsDraft((current) => ({ ...current, [key]: value }));
  const setDepth = (key: string) => (value: string) => setDepthDraft((current) => ({ ...current, [key]: value }));

  // 저장 단추: 모든 칸이 정수이고 범위의 바닥을 지키며, 하나라도 바뀌었을 때.
  const limitsValid =
    [...Object.values(limitsDraft), ...Object.values(depthDraft)].every(
      (value) => value.trim() !== "" && Number.isInteger(Number(value)),
    ) &&
    Number(limitsDraft.provider_concurrency) >= 1 &&
    Number(limitsDraft.web_fetch_max_uses) >= 1 &&
    Number(limitsDraft.web_search_max_uses) >= 1 &&
    Number(limitsDraft.web_search_max_uses) <= 10 &&
    Number(limitsDraft.web_fetch_max_content_tokens) >= 1000;
  const limitsChanged = settings ? changedLimitKeys(limitsDraft, settings).length + depthChangedCount() : 0;

  return (
    <>
      {part === "system" && (
        <Fold
          id="exchange-rate"
          title="환율"
          note="답장 한 번의 값 = 모델의 토큰 요금 × 환율, 동아리 지원 지갑에서 차감"
          summary={
            settings?.exchange_rate
              ? `1달러 = ${Number(settings.exchange_rate.krw_per_usd).toLocaleString()}원 · ${
                  settings.fx.auto_enabled ? (settings.fx.outcome === "blocked" ? "자동 반영 보류 중" : "자동 반영") : "고정"
                }`
              : undefined
          }
        >
          {loading}

          {settings !== null && (
            <Stack>
              {/* owner-polish-3 (b): 자동 반영의 상태와 스위치 — 환율 칸 위에. */}
              <div data-testid="fx-status">
                <StatusStrip
                  items={[
                    {
                      key: "fx",
                      name: "환율 자동 반영",
                      tone: settings.fx.auto_enabled ? (settings.fx.outcome === "blocked" ? "warn" : "ok") : "off",
                      state: settings.fx.auto_enabled ? "자동 반영" : "고정",
                      note:
                        (settings.fx.is_mock
                          ? "mock — 정해진 환율을 돌려줍니다 (FX_PROVIDER)"
                          : "ECB · Frankfurter (무료, 키 없음), 하루 한 번") +
                        (settings.fx.checked_at
                          ? ` · 마지막 확인 ${formatWhen(settings.fx.checked_at)}${settings.fx.outcome_label ? ` — ${settings.fx.outcome_label}` : ""}`
                          : " · 아직 확인한 적이 없어요"),
                      action: (
                        <span className={local.actions}>
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={busy || !settings.fx.auto_enabled}
                            onClick={() => void refreshNow()}
                          >
                            지금 새로 고침
                          </button>
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={busy}
                            onClick={() => askAuto(!settings.fx.auto_enabled)}
                          >
                            {settings.fx.auto_enabled ? "환율 고정" : "자동 반영 켜기"}
                          </button>
                        </span>
                      ),
                    },
                  ]}
                />
                {settings.fx.note && (
                  <p className="notice" role="status" data-testid="fx-note" style={{ marginTop: "0.6rem" }}>
                    {settings.fx.note}
                  </p>
                )}
              </div>

              <SettingsCard
                title="환율"
                extra={
                  <>
                    모델별 요금은 <Link href="/admin/models">{sectionLabel("ai-models")}</Link>에서
                  </>
                }
              >
                <div className={local.rateRow}>
                  <NumField
                    label="1달러 ="
                    hint="직접 적으면 자동 반영이 꺼져요"
                    unit="원"
                    type="text"
                    inputMode="decimal"
                    value={rateDraft}
                    onChange={setRateDraft}
                    ariaLabel="환율 (1달러 = 원)"
                    testId="claude-exchange-rate"
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
                  <ul className={local.history}>
                    {settings.rate_history.map((rate) => (
                      <li key={rate.set_at}>
                        {formatWhen(rate.set_at)} · {Number(rate.krw_per_usd).toLocaleString()}원
                        {rate.set_by_username
                          ? ` · ${rate.set_by_username}`
                          : rate.source && rate.source !== "seed" && rate.source !== "admin"
                            ? ` · 자동 (${rate.source}${rate.fetched_for ? `, ${rate.fetched_for} 기준` : ""})`
                            : " · 처음 값"}
                      </li>
                    ))}
                  </ul>
                )}
                {saved?.startsWith("환율") && (
                  <p className={local.ok} role="status">
                    {saved}
                  </p>
                )}
              </SettingsCard>
            </Stack>
          )}
        </Fold>
      )}

      {part === "limits" && (
        <>
          {loading}
          {settings !== null && (
            <Stack>
              <PanelBar
                note="0은 그 한도를 끕니다"
                help={
                  <>
                    <p>
                      고친 값은 그 뒤의 사용분부터 적용되고, 바꾼 사람과 전후 값은 감사 기록에 남습니다. 하루 한도는
                      회원마다 모든 유료 기능을 합산하고(KST), 앱 AI 하루 한도는 방문자마다 회원 앱들 안에서 쓴 AI를
                      합산해요. 긴 대화 경고는 입력창 위에 &lsquo;새 대화로 시작하면 아낄 수 있어요&rsquo;를 띄웁니다.
                    </p>
                    <p>
                      생각 깊이: 회원 화면의 &ldquo;(최대 M원)&rdquo;이 1회 한도예요. 답장이 그 깊이의 1회 한도에 닿으면
                      서버가 같은 답장 안에서 스스로 이어 씁니다(채팅만) — 호출마다 1회 한도 아래에서, 호출마다 지갑을
                      먼저 확인하고, 답장 전체가 전체 한도에 닿거나 지갑이 모자라면 거기서 멈춰요(회원은 &lsquo;이어서
                      쓰기&rsquo;로 이어 받을 수 있어요). 최대 출력은 1,024–64,000토큰, 1회 한도는 10–5,000원, 전체 한도는
                      0(이어 쓰지 않음) 또는 1회 한도 이상 50,000원 이하.
                    </p>
                    <p>
                      페이지 읽기와 웹 검색은 1회 비용 한도가 미리 떼어 두는 양이라, 줄이면 낮은 한도에서도 쓸 수
                      있어요. 동시 호출은 서버 프로세스마다 AI 호출을 한 번에 이만큼만 보냅니다.
                      {settings.chat_limits.set_at
                        ? ` 마지막 변경: ${formatWhen(settings.chat_limits.set_at)}${
                            settings.chat_limits.set_by_username ? ` · ${settings.chat_limits.set_by_username}` : ""
                          }`
                        : " 아직 바꾼 적이 없습니다 (기본값)."}
                    </p>
                  </>
                }
                actions={
                  <SaveBar note={limitsChanged > 0 ? `바뀐 값 ${limitsChanged}개` : undefined}>
                    <button
                      className="btn btn-sm btn-primary"
                      type="button"
                      disabled={!limitsValid || limitsChanged === 0}
                      onClick={askLimits}
                    >
                      저장
                    </button>
                  </SaveBar>
                }
              />

              {saved?.startsWith("채팅") && (
                <p className={local.ok} role="status">
                  {saved}
                </p>
              )}

              <SettingsGrid>
                <SettingsCard title="대화">
                  <NumField
                    label="대화 기억"
                    hint="4,000–400,000"
                    unit="토큰"
                    value={limitsDraft.context_tokens}
                    onChange={setLimit("context_tokens")}
                    type="text"
                  />
                  <NumField
                    label="긴 대화 경고"
                    hint="입력이 이만큼부터"
                    unit="토큰"
                    value={limitsDraft.long_history_tokens}
                    onChange={setLimit("long_history_tokens")}
                    type="text"
                  />
                  <NumField
                    label="응답 대기"
                    hint="30–600"
                    unit="초"
                    value={limitsDraft.timeout_seconds}
                    onChange={setLimit("timeout_seconds")}
                    type="text"
                  />
                </SettingsCard>
                <SettingsCard title="돈">
                  <NumField
                    label="하루 한도"
                    hint="회원마다 · 모든 유료 기능"
                    unit="원"
                    value={limitsDraft.daily_cap_krw}
                    onChange={setLimit("daily_cap_krw")}
                    type="text"
                  />
                  <NumField
                    label="앱 AI 하루 한도"
                    hint="방문자마다"
                    unit="원"
                    value={limitsDraft.app_ai_daily_cap_krw}
                    onChange={setLimit("app_ai_daily_cap_krw")}
                    type="text"
                  />
                </SettingsCard>
                <SettingsCard title="도구 · 서버">
                  <NumField
                    label="웹 검색"
                    hint="한 답장에 1–10"
                    unit="회"
                    value={limitsDraft.web_search_max_uses}
                    onChange={setLimit("web_search_max_uses")}
                    type="text"
                  />
                  <NumField
                    label="페이지 읽기"
                    hint="한 답장에 1–5"
                    unit="회"
                    value={limitsDraft.web_fetch_max_uses}
                    onChange={setLimit("web_fetch_max_uses")}
                    type="text"
                  />
                  <NumField
                    label="페이지당 토큰"
                    hint="1,000–100,000"
                    unit="토큰"
                    value={limitsDraft.web_fetch_max_content_tokens}
                    onChange={setLimit("web_fetch_max_content_tokens")}
                    type="text"
                  />
                  <NumField
                    label="동시 호출"
                    hint="서버 프로세스마다, 1 이상"
                    unit="개"
                    value={limitsDraft.provider_concurrency}
                    onChange={setLimit("provider_concurrency")}
                    type="text"
                  />
                </SettingsCard>

                {Object.keys(depthDraft).length > 0 && (
                  <SettingsCard title="생각 깊이" extra="회원이 고른 깊이마다 · 전체 한도 0 = 이어 쓰지 않음" wide>
                    <div className={local.depthWrap}>
                      <table className={local.depth} data-testid="depth-table">
                        <caption className="sr-only">
                          생각 깊이 — 깊이마다 최대 출력(토큰), 1회 한도(원), 전체 한도(원, 채팅만)
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">기능 · 값</th>
                            {DEPTH_LEVELS.map((level) => (
                              <th scope="col" key={level}>
                                {DEPTH_LABEL[level]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {DEPTH_ROWS.map(({ surface, field, label, unit, srUnit }) => (
                            <tr key={`${surface}.${field}`}>
                              <th scope="row">
                                {DEPTH_SURFACE_LABEL[surface]} · {label}
                                <small>{unit}</small>
                              </th>
                              {DEPTH_LEVELS.map((level) => {
                                const key = `${surface}.${level}.${field}`;
                                return (
                                  <td key={level} data-level={DEPTH_LABEL[level]}>
                                    <input
                                      className={local.depthInput}
                                      inputMode="numeric"
                                      aria-label={`${DEPTH_SURFACE_LABEL[surface]} ${DEPTH_LABEL[level]} ${srUnit}`}
                                      value={depthDraft[key] ?? ""}
                                      onChange={(event) => setDepth(key)(event.target.value)}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SettingsCard>
                )}
              </SettingsGrid>
            </Stack>
          )}
        </>
      )}

      {part === "system" && settings !== null && (
        <Fold
          id="env"
          title="서버 설정 (.env)"
          note="읽기 전용 — .env를 고치고 서버를 다시 시작하면 바뀝니다"
          summary={`보내기 1분 ${settings.rate_limit_per_minute}개 · 캐시 ${settings.cache_ttl ? "켜짐" : "꺼짐"}`}
        >
          <SettingsCard title="서버 설정" extra="읽기 전용">
            <dl className={local.envList}>
              <dt>회원당 보내기</dt>
              <dd className="numeric">1분에 {settings.rate_limit_per_minute}개</dd>
              <dt>프롬프트 캐시</dt>
              <dd>{settings.cache_ttl ? `켜짐 · ${settings.cache_ttl === "1h" ? "1시간" : "5분"} 보관` : "꺼짐"}</dd>
              <dt>생각(thinking)</dt>
              <dd>
                {THINKING_LABEL[settings.thinking] ?? settings.thinking} · 노력 {settings.effort} (생각 깊이가 없는 호출의
                기본값)
              </dd>
            </dl>
          </SettingsCard>
        </Fold>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} busy={busy} error={confirmError} />
    </>
  );
}
