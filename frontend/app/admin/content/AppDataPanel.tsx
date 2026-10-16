"use client";

/**
 * Admin › Content › 데이터 (app-platform P3).
 *
 * 앱 하나가 ctrlai.db에 가진 것: 목록(개인·공유)별 항목 수와 크기, 그리고
 * 모든 방문자가 보는 **공유 항목**(최근 200개). 개인 항목은 방문자 자신의
 * 것이라 세기만 하고 보여 주지 않습니다. 공유 항목은 숨기기(남겨 두고 모두에게
 * 안 보이게)나 지우기 — 둘 다 사유를 적고, 감사 기록에 남습니다. 한 시트
 * 안에서 끝나도록 확인은 그 줄 아래 작은 입력으로 받습니다.
 */

import { useCallback, useEffect, useId, useState } from "react";

import DialogShell from "@/app/components/DialogShell";
import dialog from "@/app/components/confirm-dialog.module.css";
import { useToast } from "@/app/components/ToastProvider";
import { adminDataItem, formatBytes, getAdminAppData, type AdminData, type AdminDataItem } from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";

import styles from "./preview.module.css";

interface Props {
  projectId: number;
  name: string;
  /** 숨기거나 지운 뒤 — 바깥 표의 개수를 다시 읽도록. */
  onChanged: () => void;
  onClose: () => void;
}

type Action = "hide" | "delete";

const LABEL: Record<Action, string> = { hide: "숨기기", delete: "지우기" };

export default function AppDataPanel({ projectId, name, onChanged, onClose }: Props) {
  const id = useId();
  const toast = useToast();
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: AdminDataItem; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    getAdminAppData(projectId)
      .then(setData)
      .catch((caught: unknown) => setError(describeError(caught)));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (pending) setPending(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);

  const start = (item: AdminDataItem, action: Action) => {
    setPending({ item, action });
    setReason("");
    setActionError(null);
  };

  const confirm = async () => {
    if (!pending) return;
    const text = reason.trim();
    if (!text) {
      setActionError("사유를 적어 주세요.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await adminDataItem(pending.item.id, pending.action, text);
      toast.show(result.detail);
      setPending(null);
      load();
      onChanged();
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell onClose={onClose} labelledBy={`${id}-title`} variant="sheet">
      <h2 className={dialog.dialogTitle} id={`${id}-title`}>
        데이터 — {name}
      </h2>
      {error && (
        <p className={dialog.dialogError} role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="small muted">불러오는 중…</p>}
      {data && (
        <>
          <p className={dialog.dialogEffect}>
            게시된 앱의 ctrlai.db — 항목 {data.items.toLocaleString("ko-KR")}개 · {formatBytes(data.bytes)} (앱마다
            2,000개 · 5MB까지). 개인 목록의 항목은 방문자 자신의 것이라 세기만 해요.
          </p>
          {data.collections.length === 0 ? (
            <p className="small muted">아직 저장된 데이터가 없어요.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" data-testid="data-collections">
                <thead>
                  <tr>
                    <th>목록</th>
                    <th>종류</th>
                    <th>항목</th>
                    <th>크기</th>
                  </tr>
                </thead>
                <tbody>
                  {data.collections.map((collection) => (
                    <tr key={collection.name}>
                      <td>
                        <code>{collection.name}</code>
                      </td>
                      <td>{collection.kind === "shared" ? "공유" : "개인"}</td>
                      <td>{collection.items.toLocaleString("ko-KR")}</td>
                      <td>{formatBytes(collection.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="section-title" style={{ marginTop: "1rem" }}>
            공유 항목 {data.shared.length > 0 ? `(최근 ${data.shared.length}개)` : ""}
          </h3>
          {data.shared.length === 0 ? (
            <p className="small muted">공유 목록에 항목이 없어요.</p>
          ) : (
            <ul className={styles.items} data-testid="data-shared">
              {data.shared.map((item) => (
                <li key={item.id} className={styles.item}>
                  <div className={styles.itemHead}>
                    <span className="small muted">
                      <code>{item.collection}</code> · {item.author_username || "—"} · {relativeTime(item.created_at)} ·{" "}
                      {formatBytes(item.size_bytes)}
                      {item.open_reports > 0 && (
                        <>
                          {" "}
                          <span className="badge badge-warn">신고 {item.open_reports}</span>
                        </>
                      )}
                    </span>
                    <span className={styles.itemActions}>
                      <button className="btn btn-sm" type="button" onClick={() => start(item, "hide")} disabled={busy}>
                        숨기기
                      </button>{" "}
                      <button
                        className="btn btn-sm btn-danger"
                        type="button"
                        onClick={() => start(item, "delete")}
                        disabled={busy}
                      >
                        지우기
                      </button>
                    </span>
                  </div>
                  <pre className={styles.content} tabIndex={0}>
                    {JSON.stringify(item.data, null, 1)}
                  </pre>
                  {pending && pending.item.id === item.id && (
                    <form
                      className={styles.itemConfirm}
                      aria-label={`${LABEL[pending.action]} 확인`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void confirm();
                      }}
                    >
                      <label className={dialog.dialogField}>
                        <span className={dialog.fieldLabel}>
                          {pending.action === "hide"
                            ? "숨기기 사유 — 항목은 남고 모든 방문자에게 안 보여요"
                            : "지우기 사유 — 항목이 완전히 지워져요"}
                        </span>
                        <input
                          className="field"
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="예: 욕설"
                          maxLength={200}
                          autoFocus
                        />
                      </label>
                      {actionError && (
                        <p className={dialog.dialogError} role="alert">
                          {actionError}
                        </p>
                      )}
                      <div className={dialog.dialogActions}>
                        <button className="btn" type="button" onClick={() => setPending(null)} disabled={busy}>
                          취소
                        </button>
                        <button
                          className={pending.action === "delete" ? "btn btn-danger" : "btn btn-primary"}
                          type="submit"
                          disabled={busy}
                        >
                          {LABEL[pending.action]}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className={dialog.dialogActions}>
        <button className="btn" type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </DialogShell>
  );
}
