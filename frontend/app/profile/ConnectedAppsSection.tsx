"use client";

/**
 * Profile › 연결된 앱 (app-platform P2).
 *
 * "CTRL+AI로 로그인"을 허용한 회원 앱들. 앱마다 허용한 일과 날짜, 그리고
 * 연결 끊기 — 끊으면 그 앱의 로그인이 바로 끝나고, 다시 쓰려면 다시
 * 허용해야 합니다. 앱은 이메일·아이디·잔액을 받은 적이 없습니다.
 */

import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useToast } from "@/app/components/ToastProvider";
import { describeError } from "@/lib/http";
import { listAppConsents, revokeAppConsent, type AppConsent } from "@/lib/app-platform";
import { formatRelative } from "@/lib/projects";

import styles from "./profile.module.css";

export default function ConnectedAppsSection() {
  const toast = useToast();
  const [rows, setRows] = useState<AppConsent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAppConsents()
      .then((next) => {
        setRows(next);
        setError(null);
      })
      .catch((caught: unknown) => setError(describeError(caught)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const askRevoke = (row: AppConsent) => {
    setConfirmError(null);
    setConfirm({
      title: `'${row.app_name}' 연결 끊기`,
      effect: [
        "이 앱에서 바로 로그아웃되고, 앱이 내 이름을 더 받지 않아요.",
        "앱에 남긴 데이터는 지워지지 않아요. 다시 쓰려면 앱에서 다시 허용하면 돼요.",
      ],
      confirmLabel: "연결 끊기",
      danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          const result = await revokeAppConsent(row.id);
          toast.show(result.detail);
          setConfirm(null);
          load();
        } catch (caught) {
          setConfirmError(describeError(caught));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <section className="card" aria-labelledby="connected-apps-title">
      <h2 className="section-title" id="connected-apps-title">
        연결된 앱
      </h2>
      {error && (
        <p className="small" role="alert">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="small muted">불러오는 중…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="small muted">
          아직 연결한 앱이 없어요. CtrlAIApps의 앱에서 &lsquo;CTRL+AI로 로그인&rsquo;을 허용하면 여기에 보여요.{" "}
          <a href="/help/apps">앱 기능 상자 안내</a>
        </p>
      )}
      {rows?.map((row) => (
        <div className={styles.connection} key={row.id} data-testid="connected-app">
          <span>
            <p className={styles.connectionName}>
              {row.app_url ? (
                <a href={row.app_url} target="_blank" rel="noreferrer">
                  {row.app_name}
                </a>
              ) : (
                row.app_name
              )}
            </p>
            <p className={styles.connectionHint}>
              {row.scopes
                .map((scope) =>
                  scope.key === "ai" ? "AI 사용" : scope.key === "profile" ? "표시 이름" : scope.key === "data" ? "데이터 저장" : scope.key,
                )
                .join(" · ")}
              {" · "}
              {formatRelative(row.granted_at)} 허용
            </p>
          </span>
          <span className={styles.connectionRight}>
            <button className="btn btn-sm" type="button" onClick={() => askRevoke(row)}>
              연결 끊기
            </button>
          </span>
        </div>
      ))}
      <p className="small dim" style={{ marginTop: "0.6rem" }}>
        앱 안에서 쓴 AI 비용은 Usage에 &lsquo;앱 · 앱 이름&rsquo;으로 남아요.
      </p>
      <ConfirmDialog busy={busy} error={confirmError} request={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}
