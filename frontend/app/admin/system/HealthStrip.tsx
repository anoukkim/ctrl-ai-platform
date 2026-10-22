"use client";

import { useAdminQuarterOptional } from "../AdminQuarterProvider";

/**
 * Admin › System — 연결 상태 카드 줄 (ui-improvements B; admin-ui-unify:
 * the kit's `StatusStrip` look, one card per place).
 *
 * 오너: "걍 연결상태를 전체적으로 health를 보고 싶은데". 서버(API) ·
 * 데이터베이스 · Claude · Higgsfield · GitHub · YouTube를 점 하나씩으로
 * 한 줄에 보여 줍니다 — 초록(연결됨) · 빨강(마지막 기록이 오류, 또는 닿지
 * 않음) · 회색(mock, 또는 아직 모름).
 *
 * 자료는 이미 있는 두 곳에서 옵니다: `/api/health`(서버·DB — 화면이 열려
 * 있는 동안 30초마다 다시 묻고, 실패하면 3초 간격으로 세 번 더)와
 * `/admin/providers`(외부 서비스의 마지막 성공·오류 기록). 화면을 열 때
 * 외부 서비스를 실제로 부르지는 않습니다 — 보기만 해도 돈이 나가는 화면을
 * 만들지 않기 위해서입니다. "모두 확인"을 누르면 네 곳의 연결 확인을
 * 차례로 돌립니다(mock은 아무것도 보내지 않고, Claude는 토큰을 쓰지 않는
 * 모델 목록 요청).
 */

import { useCallback, useEffect, useState } from "react";

import { fetchHealth, type HealthResponse } from "@/lib/api";
import {
  checkProvider,
  formatWhenOrNever,
  listProviders,
  type BackupLine,
  type ProviderStatus,
} from "@/lib/admin";
import { describeError } from "@/lib/http";

import { PanelBar, Pill, type Tone as PillTone } from "../components/AdminUI";
import kit from "../components/AdminUI.module.css";
import { providerStatusItem } from "../components/providerStatus";

/** `data-tone` on each card (tests and e2e read it): green · red · grey. */
type Tone = "ok" | "error" | "muted";

interface Light {
  key: string;
  name: string;
  tone: Tone;
  /** 카드 아래의 한 줄 — "연결됨", "mock", "오류 · 2026.10.16" 같은 말. */
  detail: string;
  /** 카드의 상태 표(없으면 `tone`에서). */
  state?: string;
  pill?: PillTone;
}

const PILL: Record<Tone, PillTone> = { ok: "ok", error: "err", muted: "off" };
const STATE: Record<Tone, string> = { ok: "정상", error: "문제", muted: "—" };

/** 외부 서비스 하나의 색. ProviderPanel의 카드와 같은 규칙입니다. */
export function providerTone(provider: ProviderStatus): Tone {
  if (provider.is_mock) return "muted";
  const failing =
    provider.last_error_at !== null &&
    (provider.last_success_at === null || provider.last_success_at < provider.last_error_at);
  if (failing) return "error";
  return provider.last_success_at !== null || provider.has_key ? "ok" : "error";
}

function providerDetail(provider: ProviderStatus): string {
  if (provider.is_mock) return "mock (테스트)";
  const tone = providerTone(provider);
  if (tone === "error") {
    return provider.last_error_at === null
      ? "API 키 없음"
      : `오류 · ${formatWhenOrNever(provider.last_error_at)}`;
  }
  return provider.last_success_at === null
    ? "키 설정됨 · 아직 확인 전"
    : `연결됨 · ${formatWhenOrNever(provider.last_success_at)}`;
}

/**
 * 백업 한 줄 (admin-consolidation v3 (4)) — 서버의 백업 스크립트가 끝날 때
 * 남긴 기록에서. 서버 안 백업이 없거나 알림 기준보다 오래됐으면 빨강. 서버 밖
 * 백업은 설정했을 때만(기록이 한 번이라도 있을 때만) 따집니다.
 */
export function backupLight(lines: BackupLine[] | undefined, isDevelopment: boolean): Light | null {
  if (lines === undefined) return null;
  const local = lines.find((line) => line.kind === "local");
  const offsite = lines.find((line) => line.kind === "offsite");
  if (!local?.at) {
    return {
      key: "backup",
      name: "백업",
      tone: isDevelopment ? "muted" : "error",
      detail: isDevelopment ? "개발 환경 — 백업 없음" : "기록 없음 · deploy/backup.sh",
    };
  }
  const offsiteLate = Boolean(offsite?.at) && Boolean(offsite?.late);
  const where = offsite?.at ? ` · 서버 밖 ${formatWhenOrNever(offsite.at)}` : "";
  return {
    key: "backup",
    name: "백업",
    tone: local.late || offsiteLate ? "error" : "ok",
    detail: `${local.late ? "늦음 · " : ""}${formatWhenOrNever(local.at)}${where}`,
  };
}

/**
 * A provider's card: the shared `providerStatusItem` wording (테스트 모드 ·
 * 키 없음 · 오류), with our colour rule on top — a success after the last
 * error is green again.
 */
function providerLight(provider: ProviderStatus): Light {
  const tone = providerTone(provider);
  const item = providerStatusItem(provider, { mock: "mock — 바깥으로 아무것도 보내지 않아요 · 비용 0" });
  if (tone === "ok" || item === null) {
    return {
      key: provider.key,
      name: provider.name,
      tone,
      detail: providerDetail(provider),
      state: provider.last_success_at === null ? "확인 전" : "연결됨",
    };
  }
  return {
    key: provider.key,
    name: provider.name,
    tone,
    detail:
      item.tone === "ok"
        ? providerDetail(provider)
        : String(item.note ?? providerDetail(provider)) +
          (provider.last_error_at !== null && item.tone === "err" ? ` · ${formatWhenOrNever(provider.last_error_at)}` : ""),
    state: tone === "error" && item.tone !== "err" ? "오류" : String(item.state),
    pill: tone === "error" ? "err" : item.tone,
  };
}

/** 서버·DB 확인이 실패한 뒤 다시 묻는 간격, 그 횟수, 그리고 평소의 간격. */
export const HEALTH_RETRY_MS = 3_000;
export const HEALTH_RETRIES = 3;
export const HEALTH_REFRESH_MS = 30_000;

interface HealthStripProps {
  /** 테스트용 — 실패 뒤 다시 묻는 간격(ms). */
  retryMs?: number;
  /** 테스트용 — 평소에 다시 묻는 간격(ms). */
  refreshMs?: number;
}

export default function HealthStrip({ retryMs = HEALTH_RETRY_MS, refreshMs = HEALTH_REFRESH_MS }: HealthStripProps = {}) {
  const dashboard = useAdminQuarterOptional()?.dashboard;
  const thumbs = dashboard?.thumbnail_server;
  const backup = backupLight(dashboard?.backups, dashboard?.is_development ?? false);
  const [health, setHealth] = useState<HealthResponse | null | "down">(null);
  /** 서버가 마지막으로 답한 때 — 빨간 카드에 "마지막 연결"로 보여 줍니다. */
  const [reachedAt, setReachedAt] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    // 서버·DB는 한 번 묻고 마는 게 아니라 계속 묻습니다 (fix-health-strip-retry,
    // 2026-10-22): 배포로 API가 몇 초 재시작하는 사이나 잠깐의 네트워크
    // 끊김에 열린 화면이 "연결할 수 없음"으로 굳어 버렸고, 새로 고치기 전에는
    // 돌아오지 않았습니다. 실패하면 곧 다시(HEALTH_RETRIES번), 그 뒤로는
    // 느리게 — /api/health는 SELECT 1 하나라 비용이 없습니다.
    const ask = async () => {
      controller = new AbortController();
      try {
        const value = await fetchHealth(controller.signal);
        if (cancelled) return;
        failures = 0;
        setHealth(value);
        setReachedAt(new Date().toISOString());
        timer = setTimeout(() => void ask(), refreshMs);
      } catch {
        if (cancelled) return;
        failures += 1;
        setHealth("down");
        timer = setTimeout(() => void ask(), failures < HEALTH_RETRIES ? retryMs : refreshMs);
      }
    };
    void ask();

    listProviders()
      .then((rows) => {
        if (!cancelled) setProviders(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [version, retryMs, refreshMs]);

  const checkAll = useCallback(async () => {
    if (providers === null) return;
    setChecking(true);
    try {
      // 차례로: 동시에 네 곳을 부르면 한도에 걸릴 수 있고, 어차피 몇 초입니다.
      for (const provider of providers) {
        await checkProvider(provider.key).catch(() => undefined);
      }
      setCheckedAt(new Date().toISOString());
      setVersion((value) => value + 1);
    } finally {
      setChecking(false);
    }
  }, [providers]);

  const lights: Light[] = [
    {
      key: "api",
      name: "서버",
      tone: health === null ? "muted" : health === "down" ? "error" : "ok",
      state: health === null ? "확인 중" : health === "down" ? "닿지 않음" : "연결됨",
      detail:
        health === null
          ? "확인 중"
          : health === "down"
            ? `연결할 수 없음 · 다시 확인 중${reachedAt !== null ? ` · 마지막 연결 ${formatWhenOrNever(reachedAt)}` : ""}`
            : `환경 · ${health.environment}`,
    },
    {
      key: "db",
      name: "데이터베이스",
      tone: health === null ? "muted" : health === "down" || health.database.status !== "ok" ? "error" : "ok",
      state:
        health === null ? "확인 중" : health === "down" ? "알 수 없음" : health.database.status === "ok" ? "연결됨" : "닿지 않음",
      detail:
        health === null
          ? "확인 중"
          : health === "down"
            ? "서버 너머라 알 수 없음"
            : health.database.status === "ok"
              ? "PostgreSQL"
              : `연결할 수 없음 (${health.database.detail ?? "원인 미상"})`,
    },
    // admin-consolidation v3: the thumbnail server, when it is on.
    ...(thumbs && thumbs !== "off"
      ? [
          {
            key: "thumbs",
            name: "썸네일 서버",
            tone: (thumbs === "ok" ? "ok" : "error") as Tone,
            state: thumbs === "ok" ? "정상" : "응답 없음",
            detail: thumbs === "ok" ? "서버가 앱 썸네일을 찍어요" : "그동안 브라우저가 찍어요",
          },
        ]
      : []),
    ...(backup ? [backup] : []),
    ...(providers ?? []).map(providerLight),
  ];

  const problems = lights.filter((light) => light.tone === "error").length;

  return (
    <section aria-label="연결 상태" data-testid="health-strip" className={kit.stack}>
      <PanelBar
        left={
          <span data-testid="health-overall">
            <Pill tone={problems > 0 ? "err" : "ok"}>{problems > 0 ? `문제 ${problems}곳` : "모두 정상"}</Pill>
          </span>
        }
        note={checkedAt !== null ? `확인함 · ${formatWhenOrNever(checkedAt)}` : "외부 서비스는 마지막 기록으로 보여요"}
        help={
          <p style={{ margin: 0 }}>
            서버·데이터베이스는 지금 묻고, 외부 서비스의 색은 마지막 성공·오류 기록으로 정해요 — 화면을 열기만 해서는
            바깥으로 아무것도 보내지 않아요. &lsquo;모두 확인&rsquo;을 누르면 외부 서비스를 차례로 확인해요(mock은 아무것도
            보내지 않고, Claude는 토큰을 쓰지 않는 모델 목록 요청). 테스트 모드(mock)는 비용이 0이에요.
          </p>
        }
        actions={
          <button
            className="btn btn-sm"
            type="button"
            disabled={checking || providers === null}
            onClick={() => void checkAll()}
          >
            {checking ? "확인 중…" : "모두 확인"}
          </button>
        }
      />

      {error !== null && <p className="small muted" style={{ margin: 0 }}>외부 서비스 상태를 불러오지 못했습니다. {error}.</p>}

      <ul className={kit.status} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {lights.map((light) => (
          <li key={light.key} className={kit.statusCard} data-testid={`health-${light.key}`} data-tone={light.tone}>
            <div className={kit.statusRow}>
              <b>{light.name}</b>
              <Pill tone={light.pill ?? PILL[light.tone]}>{light.state ?? STATE[light.tone]}</Pill>
            </div>
            <small>{light.detail}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
