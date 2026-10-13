"use client";

/**
 * Admin — 의견 (/admin/feedback)
 *
 * 회원이 어느 화면에서든 "의견 보내기"로 남긴 글입니다(prep-beta-launch).
 * Report Issue가 GitHub으로 보내는 공개 신고라면, 이쪽은 운영진만 읽는
 * 짧은 메모입니다. 읽기만 합니다 — 답장이나 처리 상태는 아직 없습니다.
 *
 * 분기와 상관없는 목록입니다. 최신 글이 위에 옵니다.
 */

import { useEffect, useState } from "react";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import SharedPageHeader from "@/app/components/PageHeader";
import { formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { listFeedback, type FeedbackAdminItem } from "@/lib/site";

import AdminTable, { type Column } from "../components/AdminTable";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";
import Skeleton from "@/app/components/Skeleton";

export default function FeedbackAdmin() {
  const [items, setItems] = useState<FeedbackAdminItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    listFeedback()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <>
        <PageHeader />
        <div className="card">
          <p className="small muted">의견을 불러오지 못했습니다. {error}.</p>
        </div>
      </>
    );
  }

  if (items === null) {
    return (
      <>
        <PageHeader />
        <Skeleton />
      </>
    );
  }

  const visible = items.filter((item) =>
    matchesQuery(query, item.body, item.page, item.display_name ?? "", item.username ?? ""),
  );

  const columns: Column<FeedbackAdminItem>[] = [
    {
      key: "body",
      header: "내용",
      render: (item) => <span className={styles.feedbackBody}>{item.body}</span>,
    },
    {
      key: "author",
      header: "보낸 회원",
      render: (item) =>
        item.username ? (
          <span className={styles.memberName}>
            {item.display_name}
            <span className={styles.memberHandle}>@{item.username}</span>
          </span>
        ) : (
          <span className="muted">삭제된 계정</span>
        ),
    },
    {
      key: "page",
      header: "화면",
      render: (item) => <code className="small">{item.page || "—"}</code>,
    },
    {
      key: "when",
      header: "보낸 때",
      numeric: true,
      render: (item) => formatWhen(item.created_at),
    },
  ];

  return (
    <div className={styles.sections}>
      <PageHeader />

      {items.length > 0 && (
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="내용, 화면, 회원으로 검색"
          resultCount={visible.length}
          totalCount={items.length}
        />
      )}

      <AdminTable
        columns={columns}
        rows={visible}
        rowKey={(item) => item.id}
        empty={items.length === 0 ? "아직 받은 의견이 없습니다." : "조건에 맞는 의견이 없습니다."}
      />
    </div>
  );
}

function PageHeader() {
  return (
    <SharedPageHeader
      eyebrow="Admin"
      title={sectionLabel("feedback")}
      subtitle="회원이 화면 어디에서든 '의견 보내기'로 남긴 글입니다. 운영진만 읽습니다."
    />
  );
}
