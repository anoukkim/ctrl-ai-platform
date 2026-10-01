"use client";

/**
 * Admin — 회원 관리.
 *
 * 실제 회원 목록입니다. 목업이 아니라 백엔드에서 옵니다.
 *
 * 두 상태를 나란히 보여 줍니다. 서로 다른 질문에 답하기 때문입니다.
 *   계정 상태 — 로그인할 수 있는가
 *   참여 상태 — 이번 분기에 만들 수 있는가
 * 둘을 한 칸에 합치면 "로그인은 되는데 왜 못 만드는가"를 설명할 수 없습니다.
 *
 * 지원금 조정은 원(KRW) 단위입니다. 퍼센트는 금액에서 다시 계산되므로
 * 둘이 어긋날 수 없습니다.
 */

import { useCallback, useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { describeError } from "@/lib/http";
import {
  MEMBERSHIP_LABEL,
  adjustAllocation,
  formatKrw,
  listQuarterMembers,
  setMemberRole,
  setQuarterMembership,
  type MemberWithMembership,
  type MembershipStatus,
  type Quarter,
} from "@/lib/quarters";

import styles from "./admin.module.css";

const MEMBERSHIP_BADGE: Record<MembershipStatus, string> = {
  active: "badge-ok",
  inactive: "badge-warn",
  former: "badge-muted",
};

const ROLE_LABEL = { admin: "관리자", member: "회원" } as const;

export default function MemberTable({ quarter }: { quarter: Quarter | null }) {
  const [members, setMembers] = useState<MemberWithMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<number | null>(null);

  const quarterId = quarter?.id ?? null;

  const reload = useCallback(async () => {
    if (quarterId === null) return;
    try {
      setMembers(await listQuarterMembers(quarterId));
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [quarterId]);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    if (quarterId === null) return;
    let cancelled = false;

    listQuarterMembers(quarterId)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [quarterId]);

  const changeMembership = useCallback(
    async (userId: number, status: MembershipStatus) => {
      if (quarterId === null) return;
      setBusyId(userId);
      try {
        await setQuarterMembership(quarterId, userId, status);
        await reload();
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        setBusyId(null);
      }
    },
    [quarterId, reload],
  );

  const changeRole = useCallback(
    async (userId: number, role: "admin" | "member") => {
      setBusyId(userId);
      try {
        await setMemberRole(userId, role);
        await reload();
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  if (quarter === null) {
    return (
      <section>
        <h2 className="section-title">회원 관리</h2>
        <div className="card">
          <p className="small muted">분기를 먼저 고르면 그 분기의 참여 상태를 관리할 수 있습니다.</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <h2 className="section-title">회원 관리</h2>
        <div className="card">
          <p className="small muted">회원 목록을 불러오지 못했습니다. {error}.</p>
        </div>
      </section>
    );
  }

  if (members === null) {
    return (
      <section>
        <h2 className="section-title">회원 관리</h2>
        <p className="small muted">불러오는 중…</p>
      </section>
    );
  }

  const visible = members.filter(
    (member) =>
      matchesQuery(query, member.display_name, member.username) &&
      (filter === "all" || (member.membership_status ?? "none") === filter),
  );

  return (
    <section>
      <h2 className="section-title">
        회원 관리
        <span className={styles.applicationCounts}>{quarter.display_name} 기준</span>
      </h2>

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="이름이나 아이디로 검색"
        resultCount={visible.length}
        totalCount={members.length}
        filters={[
          {
            key: "membership",
            label: "참여",
            value: filter,
            onChange: setFilter,
            options: [
              { value: "all", label: "전체" },
              ...Object.entries(MEMBERSHIP_LABEL).map(([value, label]) => ({ value, label })),
              { value: "none", label: "미참여" },
            ],
          },
        ]}
      />

      {visible.length === 0 ? (
        <div className="card">
          <p className="small muted">조건에 맞는 회원이 없습니다.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">회원</th>
                <th scope="col">역할</th>
                <th scope="col">계정</th>
                <th scope="col">참여</th>
                <th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => (
                <tr key={member.user_id}>
                  <td>
                    <span className={styles.memberName}>
                      {member.display_name}
                      <span className={styles.memberHandle}>@{member.username}</span>
                    </span>
                  </td>
                  <td>
                    <button
                      className={`badge badge-muted ${styles.toggle}`}
                      type="button"
                      disabled={busyId === member.user_id}
                      onClick={() =>
                        void changeRole(member.user_id, member.role === "admin" ? "member" : "admin")
                      }
                      title="눌러서 역할을 바꿉니다"
                    >
                      {ROLE_LABEL[member.role]}
                    </button>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        member.account_status === "former" ? "badge-muted" : "badge-ok"
                      }`}
                    >
                      {member.account_status === "former" ? "탈퇴" : "사용 가능"}
                    </span>
                  </td>
                  <td>
                    {member.membership_status ? (
                      <span className={`badge ${MEMBERSHIP_BADGE[member.membership_status]}`}>
                        {MEMBERSHIP_LABEL[member.membership_status]}
                      </span>
                    ) : (
                      <span className="badge badge-mock">미참여</span>
                    )}
                  </td>
                  <td>
                    <span className={styles.rowActions}>
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={busyId === member.user_id || member.membership_status === "active"}
                        onClick={() => void changeMembership(member.user_id, "active")}
                      >
                        참여 등록
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={
                          busyId === member.user_id || member.membership_status === "inactive"
                        }
                        onClick={() => void changeMembership(member.user_id, "inactive")}
                      >
                        비활동
                      </button>
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={busyId === member.user_id}
                        onClick={() =>
                          setEditing(editing === member.user_id ? null : member.user_id)
                        }
                      >
                        지원금
                      </button>
                    </span>

                    {editing === member.user_id && (
                      <AllocationEditor
                        quarterId={quarter.id}
                        userId={member.user_id}
                        name={member.display_name}
                        onDone={() => {
                          setEditing(null);
                          void reload();
                        }}
                        onError={setError}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * 지원금 조정 — 원 단위.
 *
 * 퍼센트가 아니라 금액을 직접 적습니다. 회원이 Usage에서 보는 것이 금액이고,
 * 퍼센트는 금액에서 다시 계산되므로 둘이 어긋날 수 없습니다.
 */
function AllocationEditor({
  quarterId,
  userId,
  name,
  onDone,
  onError,
}: {
  quarterId: number;
  userId: number;
  name: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [build, setBuild] = useState("");
  const [video, setVideo] = useState("");
  const [busy, setBusy] = useState(false);

  const buildKrw = Number(build.replaceAll(",", "")) || 0;
  const videoKrw = Number(video.replaceAll(",", "")) || 0;

  async function save() {
    setBusy(true);
    try {
      await adjustAllocation(quarterId, userId, buildKrw, videoKrw, "Admin 화면에서 조정");
      onDone();
    } catch (caught) {
      onError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <div className={styles.allocationPanel}>
      <p className="small muted">{name}의 지원금을 원 단위로 정합니다.</p>
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel}>Build (원)</label>
        <input
          className="field"
          inputMode="numeric"
          value={build}
          onChange={(event) => setBuild(event.target.value)}
          placeholder="70000"
        />
      </div>
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel}>Video (원)</label>
        <input
          className="field"
          inputMode="numeric"
          value={video}
          onChange={(event) => setVideo(event.target.value)}
          placeholder="30000"
        />
      </div>
      <p className="small dim">합계 {formatKrw(buildKrw + videoKrw)}</p>
      <span className={styles.rowActions}>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "저장 중…" : "저장"}
        </button>
        <button className="btn btn-sm" type="button" onClick={onDone} disabled={busy}>
          취소
        </button>
      </span>
    </div>
  );
}
