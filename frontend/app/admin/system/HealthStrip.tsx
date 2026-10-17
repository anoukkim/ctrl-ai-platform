"use client";

import { useAdminQuarterOptional } from "../AdminQuarterProvider";

/**
 * Admin › System — 연결 상태 한 줄 (ui-improvements B).
 *
 * 오너: "걍 연결상태를 전체적으로 health를 보고 싶은데". 서버(API) ·
 * 데이터베이스 · Claude · Higgsfield · GitHub · YouTube를 점 하나씩으로
 * 한 줄에 보여 줍니다 — 초록(연결됨) · 빨강(마지막 기록이 오류, 또는 닿지
 * 않음) · 회색(mock, 또는 아직 모름).
 *
 * 자료는 이미 있는 두 곳에서 옵니다: `/api/health`(서버·DB)와
 * `/admin/providers`(외부 서비스의 마지막 성공·오류 기록). 화면을 열 때
 * 외부 서비스를 실제로 부르지는 않습니다 — 보기만 해도 돈이 나가는 화면을
 * 만들지 않기 위해서입니다. "모두 확인"을 누르면 네 곳의 연결 확인을
 * 차례로 돌립니다(mock은 아무것도 보내지 않고, Claude는 토큰을 쓰지 않는
 * 모델 목록 요청).
 */

import { useCallback, useEffect, useState } from "react";

import { fetchHealth, type HealthResponse } from "@/lib/api";
import { checkProvider, formatWhenOrNever, listProviders, type ProviderStatus } from "@/lib/admin";
import { describeError } from "@/lib/http";

import styles from "../admin.module.css";

type Tone = "ok" | "error" | "muted";

interface Light {
  key: string;
  name: string;
  tone: Tone;
  /** 점 아래의 한 줄 — "연결됨", "mock", "오류 · 2026.10.16" 같은 말. */
  detail: string;
}

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

export default function HealthStrip() {
  const thumbs = useAdminQuarterOptional()?.dashboard?.thumbnail_server;
  const [health, setHealth] = useState<HealthResponse | null | "down">(null);
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((value) => {
        if (!cancelled) setHealth(value);
      })
      .catch(() => {
        if (!cancelled) setHealth("down");
      });
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
    };
  }, [version]);

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
      detail:
        health === null ? "확인 중" : health === "down" ? "연결할 수 없음" : `연결됨 · ${health.environment}`,
    },
    {
      key: "db",
      name: "데이터베이스",
      tone: health === null ? "muted" : health === "down" || health.database.status !== "ok" ? "error" : "ok",
      detail:
        health === null
          ? "확인 중"
          : health === "down"
            ? "서버 너머라 알 수 없음"
            : health.database.status === "ok"
              ? "연결됨"
              : `연결할 수 없음 (${health.database.detail ?? "원인 미상"})`,
    },
    // admin-consolidation v3: the thumbnail server, when it is on.
    ...(thumbs && thumbs !== "off"
      ? [
          {
            key: "thumbs",
            name: "썸네일 서버",
            tone: (thumbs === "ok" ? "ok" : "error") as Tone,
            detail: thumbs === "ok" ? "정상" : "응답 없음 · 그동안 브라우저가 찍어요",
          },
        ]
      : []),
    ...(providers ?? []).map((provider) => ({
      key: provider.key,
      name: provider.name,
      tone: providerTone(provider),
      detail: providerDetail(provider),
    })),
  ];

  const problems = lights.filter((light) => light.tone === "error").length;

  return (
    <section className={`card ${styles.healthStrip}`} aria-labelledby="admin-health-title" data-testid="health-strip">
      <div className={styles.healthHead}>
        <h2 className="section-title" id="admin-health-title" style={{ marginBottom: 0 }}>
          연결 상태
          <span className={`badge ${problems > 0 ? "badge-warn" : "badge-ok"}`} data-testid="health-overall">
            {problems > 0 ? `문제 ${problems}곳` : "모두 정상"}
          </span>
        </h2>
        <div className={styles.healthActions}>
          {checkedAt !== null && (
            <span className="small dim">확인함 · {formatWhenOrNever(checkedAt)}</span>
          )}
          <button
            className="btn btn-sm"
            type="button"
            disabled={checking || providers === null}
            onClick={() => void checkAll()}
          >
            {checking ? "확인 중…" : "모두 확인"}
          </button>
        </div>
      </div>

      {error !== null && (
        <p className="small muted">외부 서비스 상태를 불러오지 못했습니다. {error}.</p>
      )}

      <ul className={styles.healthLights}>
        {lights.map((light) => (
          <li key={light.key} className={styles.healthLight} data-testid={`health-${light.key}`} data-tone={light.tone}>
            <span
              className={`${styles.statusDot} ${styles.healthDot} ${
                light.tone === "ok"
                  ? styles.statusDotOk
                  : light.tone === "error"
                    ? styles.statusDotError
                    : styles.statusDotMuted
              }`}
              aria-hidden="true"
            />
            <span className={styles.healthName}>{light.name}</span>
            <span className={styles.healthDetail}>{light.detail}</span>
          </li>
        ))}
      </ul>

      <p className="small dim" style={{ margin: 0 }}>
        회색은 mock(테스트) — 바깥으로 아무것도 보내지 않습니다. 외부 서비스의 색은 마지막
        기록으로 정하고, 모두 확인을 눌러야 지금 상태를 다시 봅니다.
      </p>
    </section>
  );
}
