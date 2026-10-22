"use client";

/**
 * 비밀번호 재설정 (admin-consolidation v3 (4)) — 회원 패널의 계정 칸.
 *
 * 지금까지는 서버 셸의 `set_password`뿐이었습니다. 누르면 서버가 임시
 * 비밀번호를 만들어 **한 번만** 보여 주고(서버에는 해시만), 그 회원의 모든
 * 로그인을 끝내고 로그인 잠금도 풉니다. 관리자는 본인에게 직접 전하고,
 * 회원은 로그인한 뒤 Profile › 로그인 방법에서 바꿉니다. 감사 기록에는
 * 했다는 사실만 남고 비밀번호는 남지 않습니다.
 *
 * 회원 정보를 다시 읽는 `run()`을 거치지 않습니다: 다시 읽기가 실패하면
 * 화면이 오류로 바뀌며 이 칸이 사라지고, 이미 바뀐 비밀번호를 아무도 못 보게
 * 됩니다. 비밀번호 칸은 낭독 영역(role="status") 밖에 두어 화면 낭독기가
 * 소리 내어 읽지 않게 합니다.
 */

import { useState } from "react";

import type { ConfirmRequest } from "@/app/components/ConfirmDialog";
import { resetMemberPassword, type MemberDetail, type PasswordReset as Reset } from "@/lib/admin";
import { describeError } from "@/lib/http";

import styles from "../members.module.css";

interface Props {
  member: MemberDetail;
  busy: boolean;
  askToConfirm: (request: ConfirmRequest) => void;
  closeConfirm: () => void;
}

export default function PasswordReset({ member, busy, askToConfirm, closeConfirm }: Props) {
  const [issued, setIssued] = useState<Reset | null>(null);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = () =>
    askToConfirm({
      title: `비밀번호 재설정 — ${member.display_name}`,
      effect: [
        "임시 비밀번호를 새로 만들어 한 번만 보여 드려요. 지금 비밀번호는 더 이상 쓸 수 없어요.",
        "이 회원의 모든 기기와 회원 앱에서 로그아웃되고, 로그인 잠금도 풀려요.",
        "Google로도 로그인하는 회원이면 Google 쪽은 그대로예요 — 의심되면 회원에게 Google 계정도 확인하게 해 주세요.",
        "임시 비밀번호는 본인에게 직접 전하고, 로그인한 뒤 Profile에서 바꾸게 해 주세요.",
        "감사 기록에 남습니다 (비밀번호는 남지 않아요).",
      ],
      confirmLabel: "임시 비밀번호 만들기",
      danger: true,
      onConfirm: async () => {
        setWorking(true);
        setError(null);
        try {
          setCopied(false);
          setIssued(await resetMemberPassword(member.user_id));
        } catch (caught) {
          setError(describeError(caught));
        } finally {
          setWorking(false);
          closeConfirm();
        }
      },
    });

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.temporary_password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div data-testid="password-reset" className={styles.detail} style={{ gap: "0.5rem" }}>
      <div>
        <button className="btn btn-sm" type="button" disabled={busy || working} onClick={ask}>
          비밀번호 재설정
        </button>
      </div>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {issued !== null && (
        <div className={styles.box} data-testid="temporary-password">
          <p className="small" role="status" style={{ margin: 0 }}>
            @{issued.username}의 임시 비밀번호를 만들었어요 — 이 창을 닫으면 다시 볼 수 없어요.
          </p>
          <div className={styles.line}>
            <code className={styles.password}>{issued.temporary_password}</code>
            <button className="btn btn-sm" type="button" onClick={() => void copy()}>
              {copied ? "복사했어요" : "복사"}
            </button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setIssued(null)}>
              닫기
            </button>
          </div>
          <p className={styles.note}>
            로그인 {issued.sessions_ended}곳{issued.app_sessions_ended ? `, 회원 앱 ${issued.app_sessions_ended}곳` : ""}을 끝냈어요. 본인에게 직접 전하고, Profile › 로그인 방법에서 바꾸게 해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
