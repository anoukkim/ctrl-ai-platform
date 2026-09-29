"use client";

/**
 * 서버 상태 카드.
 *
 * 화면이 그려진 뒤 상태를 확인해야 하므로 Client Component입니다.
 * 브라우저에서 직접 호출하기 때문에, "지금 이 브라우저에서" 백엔드에
 * 닿는지를 그대로 보여 줍니다.
 *
 * 이 프로토타입에서 실제로 네트워크를 쓰는 유일한 부분입니다. 백엔드가
 * 꺼져 있어도 다른 화면은 아무 영향을 받지 않고, 이 카드만 "연결 안 됨"으로
 * 바뀝니다.
 */

import { useCallback, useEffect, useState } from "react";

import { API_BASE_URL, ApiError, fetchHealth, type HealthResponse } from "@/lib/api";

import styles from "./BackendStatus.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; health: HealthResponse }
  | { phase: "error"; message: string };

/**
 * 오류를 한국어 한 줄로 바꿉니다.
 *
 * 서버에 닿지 못하면 브라우저가 "Failed to fetch" 같은 영어 메시지를 주는데,
 * 화면 전체가 한국어이므로 그대로 두지 않습니다.
 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  // fetch는 서버에 닿지 못했을 때 TypeError를 던집니다.
  if (error instanceof TypeError) return "서버에 연결할 수 없습니다";
  return "알 수 없는 오류가 발생했습니다";
}

export default function BackendStatus() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  // 처음 그려질 때, 그리고 `reloadKey`가 바뀔 때마다 실행됩니다.
  // 효과 본문에서 바로 "확인 중"으로 바꾸지 않습니다. 처음 상태가 이미
  // "확인 중"이고, 효과 안에서 곧바로 상태를 바꾸는 것은 React가 경고하는
  // 방식이기 때문입니다. 아래 "다시 확인" 버튼이 그 일을 합니다.
  useEffect(() => {
    // 화면을 벗어난 뒤 늦게 도착한 응답이 상태를 바꾸지 않도록 취소합니다.
    const controller = new AbortController();

    fetchHealth(controller.signal)
      .then((health) => setState({ phase: "ready", health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: "error", message: describeError(error) });
      });

    return () => controller.abort();
  }, [reloadKey]);

  const refresh = useCallback(() => {
    setState({ phase: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <section className={styles.card} aria-labelledby="backend-status-title">
      <div className={styles.header}>
        <h2 className={styles.title} id="backend-status-title">
          서버 상태
        </h2>
        <div className={styles.headerRight}>
          <StatusBadge state={state} />
          <button
            className="btn btn-sm"
            onClick={refresh}
            disabled={state.phase === "loading"}
            type="button"
          >
            {state.phase === "loading" ? "확인 중…" : "다시 확인"}
          </button>
        </div>
      </div>

      <div className={styles.rows}>
        <Row label="주소" value={`${API_BASE_URL}/api/health`} mono />

        {state.phase === "ready" && (
          <>
            <Row label="서비스" value={state.health.service} mono />
            <Row label="버전" value={state.health.version} mono />
            <Row label="환경" value={state.health.environment} mono />
            <Row
              label="데이터베이스"
              value={
                state.health.database.status === "ok"
                  ? "연결됨"
                  : `연결할 수 없음 (${state.health.database.detail ?? "원인 미상"})`
              }
            />
          </>
        )}

        {state.phase === "error" && <Row label="오류" value={state.message} />}
      </div>

      {state.phase === "error" && (
        <p className={styles.hint}>
          백엔드에 연결할 수 없습니다. 이 카드 말고 다른 화면은 백엔드 없이도 그대로
          동작하므로, 화면을 살펴보는 데에는 문제가 없습니다. 직접 실행하려면{" "}
          <code>backend</code> 폴더에서{" "}
          <code>uvicorn app.main:app --reload --port 8000</code>을 실행해 주세요.
        </p>
      )}

      {state.phase === "ready" && state.health.database.status !== "ok" && (
        <p className={styles.hint}>
          백엔드는 실행 중이지만 PostgreSQL에 연결할 수 없습니다. 저장소 최상위 폴더에서{" "}
          <code>docker compose up -d</code>를 실행해 주세요.
        </p>
      )}
    </section>
  );
}

function StatusBadge({ state }: { state: State }) {
  if (state.phase === "loading") {
    return (
      <span className="badge badge-muted">
        <span className={styles.dot} aria-hidden="true" />
        확인 중
      </span>
    );
  }

  if (state.phase === "error") {
    return (
      <span className="badge badge-error" role="status">
        <span className={styles.dot} aria-hidden="true" />
        연결 안 됨
      </span>
    );
  }

  const isOk = state.health.status === "ok";
  return (
    <span className={`badge ${isOk ? "badge-ok" : "badge-warn"}`} role="status">
      <span className={styles.dot} aria-hidden="true" />
      {isOk ? "정상" : "일부 장애"}
    </span>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${mono ? "mono" : ""}`}>{value}</span>
    </div>
  );
}
