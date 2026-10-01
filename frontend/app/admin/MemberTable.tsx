"use client";

/**
 * Admin — 회원 목록과 검색.
 *
 * 회원이 늘어도 표가 쓸 만하게 남도록 이름/아이디 검색과 상태 필터를
 * 둡니다. 전역 검색이 아니라 이 화면에 맞는 검색입니다.
 *
 * 아직 목업 데이터입니다. 실제 회원 목록은 Phase 2에서 붙입니다.
 */

import { useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import {
  MEMBERSHIP_LABEL,
  MOCK_MEMBERS,
  ROLE_LABEL,
  type MembershipStatus,
} from "@/lib/mock-data";
import { formatKrw } from "@/lib/quarters";

import styles from "./admin.module.css";

const MEMBERSHIP_BADGE: Record<MembershipStatus, string> = {
  active: "badge-ok",
  inactive: "badge-warn",
  former: "badge-muted",
};

export default function MemberTable() {
  const [query, setQuery] = useState("");
  const [membership, setMembership] = useState("all");

  const visible = MOCK_MEMBERS.filter(
    (member) =>
      matchesQuery(query, member.displayName, member.username) &&
      (membership === "all" || member.membership === membership),
  );

  return (
    <section>
      <h2 className="section-title">회원 관리</h2>

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="이름이나 아이디로 검색"
        resultCount={visible.length}
        totalCount={MOCK_MEMBERS.length}
        filters={[
          {
            key: "membership",
            label: "상태",
            value: membership,
            onChange: setMembership,
            options: [
              { value: "all", label: "전체" },
              ...Object.entries(MEMBERSHIP_LABEL).map(([value, label]) => ({ value, label })),
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
                <th scope="col">분기</th>
                <th scope="col">상태</th>
                <th scope="col">Build 지원금</th>
                <th scope="col">Video 지원금</th>
                <th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((member) => (
                <tr key={member.username}>
                  <td>
                    <span className={styles.memberName}>
                      {member.displayName}
                      <span className={styles.memberHandle}>@{member.username}</span>
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-muted">{ROLE_LABEL[member.role]}</span>
                  </td>
                  <td>{member.quarter}</td>
                  <td>
                    <span className={`badge ${MEMBERSHIP_BADGE[member.membership]}`}>
                      {MEMBERSHIP_LABEL[member.membership]}
                    </span>
                  </td>
                  <td className="numeric">{formatKrw(member.buildBudgetKrw)}</td>
                  <td className="numeric">{formatKrw(member.videoBudgetKrw)}</td>
                  <td>
                    <span className={styles.rowActions}>
                      <button className="btn btn-sm" type="button" disabled>
                        회원 활성화
                      </button>
                      <button className="btn btn-sm" type="button" disabled>
                        분기 참여 등록
                      </button>
                    </span>
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
