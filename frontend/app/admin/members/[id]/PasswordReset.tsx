"use client";

/**
 * 비밀번호 재설정 (admin-consolidation v3 (4)) — 회원 패널의 계정 칸.
 *
 * 지금까지는 서버 셸의 `set_password`뿐이었습니다. 누르면 서버가 임시
 * 비밀번호를 만들어 **한 번만** 보여 주고(서버에는 해시만), 그 회원의 모든
 * 로그인을 끝내고 로그인 잠금도 풉니다. 관리자는 본인에게 직접 전하고,
 * 회원은 로그인한 뒤 Profile › 로그인 방법에서 바꿉니다. 감사 기록에는
 * 했다는 사실만 남고 비밀번호는 남지 않습니다.
 */

import { useState } from "react";

import type { ConfirmRequest } from "@/app/components/ConfirmDialog";
import { resetMemberPassword, type MemberDetail, type PasswordReset as Reset } from "@/lib/admin";

interface Props {
  member: MemberDetail;
  busy: boolean;
  run: (succeeded: string, action: () => Promise<unknown>) => Promise<void>;
  askToConfirm: (request: ConfirmRequest) => void;
}

export default function PasswordReset({ member, busy, run, askToConfirm }: Props) {
  const [issued, setIssued] = useState<Reset | null>(null);
  const [copied, setCopied] = useState(false);

  const ask = () =>
    askToConfirm({
      title: `비밀번호 재설정 — ${member.display_name}`,
      effect: [
        "임시 비밀번호를 새로 만들어 한 번만 보여 드려요. 지금 비밀번호는 더 이상 쓸 수 없어요.",
        "이 회원의 모든 기기에서 로그아웃되고, 로그인 잠금도 풀려요.",
        "임시 비밀번호는 본인에게 직접 전하고, 로그인한 뒤 Profile에서 바꾸게 해 주세요.",
        "감사 기록에 남습니다 (비밀번호는 남지 않아요).",
      ],
      confirmLabel: "임시 비밀번호 만들기",
      danger: true,
      onConfirm: () =>
        run(`${member.display_name}의 임시 비밀번호를 만들었습니다.`, async () => {
          setCopied(false);
          setIssued(await resetMemberPassword(member.user_id));
        }),
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
    <div data-testid="password-reset" style={{ marginTop: "0.7rem", display: "grid", gap: "0.5rem" }}>
      <div>
        <button className="btn btn-sm" type="button" disabled={busy} onClick={ask}>
          비밀번호 재설정
        </button>
      </div>
      {issued !== null && (
        <div className="card" role="status" data-testid="temporary-password">
          <p className="small" style={{ margin: 0 }}>
            @{issued.username}의 임시 비밀번호 — 이 창을 닫으면 다시 볼 수 없어요.
          </p>
          <p style={{ margin: "0.4rem 0", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <code className="mono" style={{ fontSize: "1.05rem", userSelect: "all" }}>
              {issued.temporary_password}
            </code>
            <button className="btn btn-sm" type="button" onClick={() => void copy()}>
              {copied ? "복사했어요" : "복사"}
            </button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setIssued(null)}>
              닫기
            </button>
          </p>
          <p className="small dim" style={{ margin: 0 }}>
            로그인 {issued.sessions_ended}곳을 끝냈어요. 본인에게 직접 전하고, Profile › 로그인 방법에서 바꾸게 해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
