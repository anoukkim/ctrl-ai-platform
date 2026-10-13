"use client";

/**
 * Profile › 연결한 서비스 › Google (google-login).
 *
 * 로그인한 회원이 자기 계정에 Google을 연결하는 곳입니다. 연결은 Google의
 * 계정 번호(sub)로 이어지고, 이메일은 어느 계정이 연결됐는지 보여 주는
 * 데만 씁니다. 비밀번호로 가입한 회원은 여기서 Google을 연결해 두면 다음부터
 * Google로 들어올 수 있습니다.
 *
 * Google에서 돌아오면 주소에 `?google=linked` 같은 결과가 붙어 옵니다.
 */

import { useEffect, useState } from "react";

import {
  GOOGLE_LINK_URL,
  GOOGLE_RESULT_MESSAGE,
  fetchGoogleConnection,
  type GoogleConnection,
} from "@/lib/auth";

import styles from "./profile.module.css";

export default function GoogleConnectionRow() {
  const [connection, setConnection] = useState<GoogleConnection | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGoogleConnection()
      .then((value) => {
        if (!cancelled) setConnection(value);
      })
      .catch(() => {
        if (!cancelled) setConnection({ available: false, linked: false, email: "" });
      });
    const result = new URLSearchParams(window.location.search).get("google");
    if (result && GOOGLE_RESULT_MESSAGE[result]) {
      queueMicrotask(() => setNote(GOOGLE_RESULT_MESSAGE[result]));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.connection}>
      <div>
        <p className={styles.connectionName}>Google 계정</p>
        <p className={styles.connectionHint}>
          {connection?.linked
            ? `${connection.email}(으)로 로그인합니다.`
            : "연결해 두면 다음부터 Google로 로그인할 수 있어요."}
        </p>
        {note && (
          <p className={styles.connectionHint} role="status">
            {note}
          </p>
        )}
      </div>
      <span className={styles.connectionRight}>
        {connection === null ? null : connection.linked ? (
          <span className="badge badge-ok">연결됨</span>
        ) : connection.available ? (
          <>
            <span className="badge badge-muted">연결 안 됨</span>
            <a className="btn btn-sm" href={GOOGLE_LINK_URL}>
              연결하기
            </a>
          </>
        ) : (
          <>
            <span className="badge badge-muted">준비 중</span>
            <button className="btn btn-sm" type="button" disabled title="Google 로그인이 아직 켜지지 않았습니다">
              연결하기
            </button>
          </>
        )}
      </span>
    </div>
  );
}
