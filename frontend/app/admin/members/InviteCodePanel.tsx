"use client";

/**
 * Admin › Members — 초대 코드 (invite-only-signup).
 *
 * 가입하려면 초대 코드가 있어야 합니다. 여기서 코드를 만들고(자동으로
 * 만든 읽기 쉬운 코드, 또는 직접 정한 코드), 몇 명이 쓸 수 있는지와
 * 언제까지인지 정하고, 누가 그 코드로 가입했는지 봅니다.
 *
 * 사용 중지는 **새 가입만** 막습니다. 이미 그 코드로 가입한 계정은 그대로
 * 이고, 그 사람들을 비활동이나 탈퇴로 바꾸는 일은 위의 회원 목록에서
 * 따로 합니다. 만들기, 사용 중지, 다시 사용은 모두 감사 기록에 남습니다.
 *
 * Admin의 새 구역이 아니라 Members 화면 안의 한 칸입니다 — 초대는 회원을
 * 들이는 일이라 회원 화면에 있는 것이 맞습니다.
 */

import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import {
  INVITE_STATUS_BADGE,
  INVITE_STATUS_LABEL,
  createInvite,
  listInvites,
  setInviteActive,
  signupLink,
  type Invite,
} from "@/lib/invites";

import ResultMessage, { type Result } from "../components/ResultMessage";

import styles from "../admin.module.css";

const EMPTY = { code: "", label: "", maxUses: "1", expiresAt: "" };

export default function InviteCodePanel() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [result, setResult] = useState<Result | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInvites(await listInvites());
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listInvites()
      .then((rows) => {
        if (!cancelled) setInvites(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(describeError(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    (request: Omit<ConfirmRequest, "onConfirm">, action: () => Promise<string>) => {
      setConfirmError(null);
      setConfirm({
        ...request,
        onConfirm: async () => {
          setBusy(true);
          try {
            const message = await action();
            await load();
            setResult({ kind: "ok", text: message });
            setConfirm(null);
          } catch (error) {
            setConfirmError(describeError(error));
          } finally {
            setBusy(false);
          }
        },
      });
    },
    [load],
  );

  const maxUses = Number(draft.maxUses);
  const draftValid = Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 1000;

  const askCreate = () => {
    const code = draft.code.trim().toUpperCase();
    const expires = draft.expiresAt ? new Date(draft.expiresAt) : null;
    run(
      {
        title: "초대 코드를 만들까요?",
        effect: [
          code ? `코드: ${code}` : "코드는 읽기 쉬운 형태로 자동으로 만들어집니다.",
          maxUses === 1 ? "한 사람만 가입할 수 있습니다." : `최대 ${maxUses}명이 가입할 수 있습니다.`,
          expires ? `${formatWhen(expires.toISOString())}까지 쓸 수 있습니다.` : "만료 없이 쓸 수 있습니다.",
          "이 코드를 가진 사람은 누구나 가입할 수 있으니, 동아리 안에서만 나눠 주세요.",
        ],
        confirmLabel: "만들기",
      },
      async () => {
        const made = await createInvite({
          code,
          label: draft.label.trim(),
          max_uses: maxUses,
          expires_at: expires ? expires.toISOString() : null,
        });
        setDraft(EMPTY);
        return `초대 코드 ${made.code}를 만들었습니다.`;
      },
    );
  };

  const askSwitch = (invite: Invite) => {
    const turningOff = invite.is_active;
    run(
      turningOff
        ? {
            title: `${invite.code} 사용을 중지할까요?`,
            effect: [
              "이 코드로는 더 이상 가입할 수 없습니다.",
              `이미 이 코드로 가입한 ${invite.uses}명의 계정은 그대로입니다.`,
            ],
            confirmLabel: "사용 중지",
            danger: true,
          }
        : {
            title: `${invite.code}를 다시 쓸 수 있게 할까요?`,
            effect: "만료되지 않았고 남은 자리가 있으면 이 코드로 다시 가입할 수 있습니다.",
            confirmLabel: "다시 사용",
          },
      async () => {
        await setInviteActive(invite.id, !turningOff);
        return turningOff
          ? `${invite.code} 사용을 중지했습니다.`
          : `${invite.code}를 다시 쓸 수 있습니다.`;
      },
    );
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setResult({ kind: "ok", text: `${what}를 복사했습니다.` });
    } catch {
      setResult({ kind: "error", text: `${what}를 복사하지 못했습니다. 직접 선택해 복사해 주세요.` });
    }
  };

  return (
    <section aria-labelledby="admin-invites" className={styles.inviteSection}>
      <h2 className="section-title" id="admin-invites">
        초대 코드
        <span className={styles.sectionNote}>
          가입하려면 초대 코드가 필요합니다. 사용 중지는 새 가입만 막습니다.
        </span>
      </h2>

      <div className={`card ${styles.modelEditor}`}>
        <div className={styles.modelEditorGrid}>
          <label className={styles.modelEditorField}>
            <span>코드 (비우면 자동으로 만듭니다)</span>
            <input
              className="field numeric"
              value={draft.code}
              maxLength={40}
              placeholder="CTRL-XXXX-XXXX"
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
          </label>
          <label className={styles.modelEditorField}>
            <span>이름표 (예: 2026 Q4 공지용)</span>
            <input
              className="field"
              value={draft.label}
              maxLength={100}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <label className={styles.modelEditorField}>
            <span>최대 가입 수 (1이면 1회용)</span>
            <input
              className={`field numeric ${styles.priceInput}`}
              inputMode="numeric"
              value={draft.maxUses}
              onChange={(e) => setDraft({ ...draft, maxUses: e.target.value })}
            />
          </label>
          <label className={styles.modelEditorField}>
            <span>만료 (선택)</span>
            <input
              className="field"
              type="datetime-local"
              value={draft.expiresAt}
              onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
            />
          </label>
        </div>
        <div className={styles.modelEditorActions}>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            disabled={!draftValid || busy}
            onClick={askCreate}
          >
            초대 코드 만들기
          </button>
          {!draftValid && <span className="small dim">최대 가입 수는 1~1000명입니다.</span>}
        </div>
      </div>

      <ResultMessage result={result} onDismiss={() => setResult(null)} />

      {loadError !== null && <p className="small muted">초대 코드를 불러오지 못했습니다. {loadError}.</p>}
      {invites !== null && invites.length === 0 && (
        <p className="small muted">아직 만든 초대 코드가 없습니다.</p>
      )}

      {invites !== null && invites.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">코드</th>
                <th scope="col">이름표</th>
                <th scope="col">사용</th>
                <th scope="col">만료</th>
                <th scope="col">상태</th>
                <th scope="col">가입한 사람</th>
                <th scope="col">
                  <span className="sr-only">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>
                    <span className={`numeric ${styles.inviteCode}`}>{invite.code}</span>
                  </td>
                  <td>{invite.label || "—"}</td>
                  <td className="numeric">
                    {invite.uses} / {invite.max_uses}
                  </td>
                  <td className="numeric">
                    {invite.expires_at ? formatWhen(invite.expires_at) : "없음"}
                  </td>
                  <td>
                    <span className={`badge ${INVITE_STATUS_BADGE[invite.status]}`}>
                      {INVITE_STATUS_LABEL[invite.status]}
                    </span>
                  </td>
                  <td className={styles.inviteSignups}>
                    {invite.signups.length === 0
                      ? "—"
                      : invite.signups.map((member) => member.display_name).join(", ")}
                  </td>
                  <td>
                    <span className={styles.inviteActions}>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => void copy(invite.code, "코드")}
                      >
                        코드 복사
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() =>
                          void copy(signupLink(window.location.origin, invite.code), "가입 링크")
                        }
                      >
                        링크 복사
                      </button>
                      <button
                        className={`btn btn-sm ${invite.is_active ? "btn-danger" : ""}`}
                        type="button"
                        disabled={busy}
                        onClick={() => askSwitch(invite)}
                      >
                        {invite.is_active ? "사용 중지" : "다시 사용"}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        busy={busy}
        error={confirmError}
      />
    </section>
  );
}
