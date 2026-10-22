"use client";

/**
 * Admin › Community › 앱 › 데이터 (app-platform P3 → admin-ui-unify).
 *
 * 앱 하나가 ctrlai.db에 가진 것: 목록(개인·공유)별 항목 수와 크기, 그리고
 * 모든 방문자가 보는 **공유 항목**(최근 200개). 개인 항목은 방문자 자신의
 * 것이라 세기만 하고 보여 주지 않습니다. 공유 항목은 숨기기(남겨 두고 모두에게
 * 안 보이게)나 지우기 — 둘 다 사유를 적고, 감사 기록에 남습니다. 오른쪽 판
 * 안에서 끝나도록 확인은 그 항목 아래 작은 입력으로 받습니다.
 */

import { useCallback, useEffect, useState } from "react";

import dialog from "@/app/components/confirm-dialog.module.css";
import { useToast } from "@/app/components/ToastProvider";
import { adminDataItem, formatBytes, getAdminAppData, type AdminData, type AdminDataItem } from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";

import { ItemList, ItemRow, Mono, PanelSection, SidePanel, Tag } from "../components/AdminUI";

import styles from "./preview.module.css";

interface Props {
  projectId: number;
  name: string;
  /** 숨기거나 지운 뒤 — 바깥 화면의 개수를 다시 읽도록. */
  onChanged: () => void;
  onClose: () => void;
}

type Action = "hide" | "delete";

const LABEL: Record<Action, string> = { hide: "숨기기", delete: "지우기" };

export default function AppDataPanel({ projectId, name, onChanged, onClose }: Props) {
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

  // Escape while a reason is being typed cancels that form only — caught
  // before the side panel's own Escape (window, bubble) can close everything.
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPending(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending]);

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
    <SidePanel
      title={`데이터 — ${name}`}
      subtitle={
        data
          ? `ctrlai.db · 항목 ${data.items.toLocaleString("ko-KR")}개 · ${formatBytes(data.bytes)} (앱마다 2,000개 · 5MB까지)`
          : undefined
      }
      onClose={onClose}
      width="wide"
      testId="app-data-panel"
      footer={
        <button className="btn btn-sm" type="button" onClick={onClose}>
          닫기
        </button>
      }
    >
      {error && (
        <p className={dialog.dialogError} role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="small muted">불러오는 중…</p>}
      {data && (
        <>
          <PanelSection title="목록">
            <ItemList
              testId="data-collections"
              empty={data.collections.length === 0 ? "아직 저장된 데이터가 없어요." : undefined}
            >
              {data.collections.map((collection) => (
                <ItemRow
                  key={collection.name}
                  title={<Mono>{collection.name}</Mono>}
                  tags={collection.kind === "shared" ? <Tag tone="accent">공유</Tag> : <Tag>개인</Tag>}
                  cells={[
                    { label: "항목", value: collection.items.toLocaleString("ko-KR"), keep: true },
                    { label: "크기", value: formatBytes(collection.bytes) },
                  ]}
                />
              ))}
            </ItemList>
            <p className="small muted" style={{ margin: 0 }}>
              개인 목록의 항목은 방문자 자신의 것이라 세기만 해요.
            </p>
          </PanelSection>

          <PanelSection title={`공유 항목${data.shared.length > 0 ? ` (최근 ${data.shared.length}개)` : ""}`}>
            {data.shared.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                공유 목록에 항목이 없어요.
              </p>
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
                            <Tag tone="warn">신고 {item.open_reports}</Tag>
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
          </PanelSection>
        </>
      )}
    </SidePanel>
  );
}
