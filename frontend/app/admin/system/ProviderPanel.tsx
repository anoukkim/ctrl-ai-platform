"use client";

/**
 * Admin — 외부 서비스 (시스템 화면 아래쪽)
 *
 * 네 곳입니다: Claude, Higgsfield, GitHub, YouTube. 각 카드가 답하는
 * 질문은 하나입니다 — **지금 쓸 수 있는가.**
 *
 * 설정만으로는 답할 수 없습니다. 키가 있어도 거부될 수 있고, 어제 되던
 * 서비스가 오늘 멈출 수 있습니다. 그래서 카드는 설정(mock인지 실제인지,
 * 키가 있는지)과 기록(마지막으로 성공한 때, 마지막 오류)을 함께 보여
 * 줍니다.
 *
 * **API 키는 어디에도 나오지 않습니다.** "설정됨"이나 "없음"만 옵니다 —
 * 백엔드가 키를 돌려주는 길 자체가 없습니다.
 *
 * "연결 확인"은 누를 때만 돕니다. 화면을 열 때마다 자동으로 부르면,
 * 보기만 해도 돈이 나가는 화면이 됩니다. mock 모드에서는 아무것도
 * 부르지 않고 mock이라고 알려 줍니다.
 */

import { useCallback, useEffect, useState } from "react";

import {
  checkProvider,
  formatWhenOrNever,
  listProviders,
  type ProviderStatus,
} from "@/lib/admin";
import { describeError } from "@/lib/http";

import styles from "../admin.module.css";

export default function ProviderPanel() {
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** 방금 누른 확인의 결과. 카드 안에 그대로 보여 줍니다. */
  const [checked, setChecked] = useState<Record<string, { ok: boolean; message: string }>>({});

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listProviders()
      .then((rows) => {
        if (!cancelled) setProviders(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const runCheck = useCallback(async (key: string) => {
    setBusyKey(key);
    try {
      const result = await checkProvider(key);
      setChecked((current) => ({
        ...current,
        [key]: { ok: result.ok, message: result.message },
      }));
      // 확인 결과가 기록에도 남으므로 카드의 "마지막 성공"을 다시 읽습니다.
      setProviders(await listProviders());
    } catch (caught) {
      setChecked((current) => ({
        ...current,
        [key]: { ok: false, message: describeError(caught) },
      }));
    } finally {
      setBusyKey(null);
    }
  }, []);

  return (
    <section aria-labelledby="admin-providers">
      <h2 className="section-title" id="admin-providers">
        외부 서비스
        <span className={styles.sectionNote}>
          API 키는 백엔드에만 있습니다 — 이 화면에 나오지 않습니다
        </span>
      </h2>

      {error !== null && (
        <div className="card">
          <p className="small muted">외부 서비스 상태를 불러오지 못했습니다. {error}.</p>
        </div>
      )}

      {error === null && providers === null && <p className="small muted">불러오는 중…</p>}

      {providers !== null && (
        <div className={styles.providerGrid}>
          {providers.map((provider) => {
            const result = checked[provider.key];
            // 실제 연결인데 마지막 기록이 오류면 카드를 강조합니다.
            const failing =
              !provider.is_mock &&
              provider.last_error_at !== null &&
              (provider.last_success_at === null ||
                provider.last_success_at < provider.last_error_at);

            return (
              <div
                className={`${styles.provider} ${failing ? styles.providerFailing : ""}`}
                key={provider.key}
              >
                <div className={styles.providerTop}>
                  <span className={styles.providerName}>
                    {/* 점 하나로 상태를 먼저 보여 줍니다: 실패면 빨강, 실제
                        연결이면 초록, mock이면 회색. */}
                    <span
                      className={`${styles.statusDot} ${
                        failing
                          ? styles.statusDotError
                          : provider.is_mock
                            ? styles.statusDotMuted
                            : styles.statusDotOk
                      }`}
                      aria-hidden="true"
                    />
                    {provider.name}
                  </span>
                  <span className={`badge ${provider.is_mock ? "badge-mock" : "badge-accent"}`}>
                    {provider.is_mock ? "mock (테스트)" : "실제 연결"}
                  </span>
                </div>

                <p className={styles.providerPurpose}>{provider.purpose}</p>

                <dl className={styles.providerFacts}>
                  <div>
                    <dt>API 키</dt>
                    <dd>
                      <span
                        className={`badge ${
                          provider.has_key
                            ? "badge-ok"
                            : provider.is_mock
                              ? "badge-muted"
                              : "badge-warn"
                        }`}
                      >
                        {provider.has_key ? "설정됨" : "없음"}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>마지막 성공</dt>
                    <dd className="numeric">
                      {formatWhenOrNever(provider.last_success_at)}
                      {provider.last_success_label && (
                        <span className={styles.providerSub}>
                          {provider.last_success_label}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>마지막 오류</dt>
                    <dd className="numeric">
                      {provider.last_error_at === null ? (
                        "없음"
                      ) : (
                        <>
                          {formatWhenOrNever(provider.last_error_at)}
                          <span className={styles.providerSub}>
                            {provider.last_error_message}
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                  {/* 남은 잔액은 제공자가 알려 줄 때만 보여 줍니다. 모르는
                      값을 0으로 적으면 잔액이 0인 것처럼 보입니다. */}
                  {provider.balance_label !== null && (
                    <div>
                      <dt>남은 잔액</dt>
                      <dd className="numeric">{provider.balance_label}</dd>
                    </div>
                  )}
                </dl>

                <div className={styles.providerActions}>
                  <button
                    className="btn btn-sm"
                    type="button"
                    disabled={busyKey === provider.key}
                    onClick={() => void runCheck(provider.key)}
                  >
                    {busyKey === provider.key ? "확인 중…" : "연결 확인"}
                  </button>
                  <span className={styles.providerSetting}>{provider.setting}</span>
                </div>

                {result && (
                  <p
                    className={`${styles.providerResult} ${
                      result.ok ? styles.providerResultOk : styles.providerResultError
                    }`}
                    role="status"
                  >
                    {result.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="small dim" style={{ marginTop: "0.7rem" }}>
        연결 확인은 눌렀을 때만 실행되고, 토큰이나 크레딧을 쓰지 않는 가장 가벼운 요청을
        씁니다. mock 모드에서는 외부로 아무것도 보내지 않습니다.
      </p>
    </section>
  );
}
