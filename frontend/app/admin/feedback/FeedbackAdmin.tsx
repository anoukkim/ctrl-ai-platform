"use client";

/**
 * Admin — 의견 (/admin/feedback)
 *
 * 회원이 어느 화면에서든 "의견 보내기"로 남긴 글입니다(prep-beta-launch).
 * 회원이 의견을 보내는 유일한 길(의견 보내기)의 글을 운영진만 읽는
 * 짧은 메모입니다. 답장이나 처리 상태는 아직 없습니다.
 *
 * 붙은 스크린샷(feedback-screenshots)은 썸네일로, 누르면 크게 봅니다 —
 * 저장본을 여는 길은 이 화면뿐입니다(회원은 403). 지우기는 글과 사진을
 * 함께 지우고 감사 기록에 남깁니다.
 *
 * 분기와 상관없는 목록입니다. 최신 글이 위에 옵니다.
 */

import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import ImageLightbox from "@/app/components/ImageLightbox";
import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import SharedPageHeader from "@/app/components/PageHeader";
import Skeleton from "@/app/components/Skeleton";
import { useToast } from "@/app/components/ToastProvider";
import { formatWhen } from "@/lib/admin";
import { describeError } from "@/lib/http";
import {
  deleteFeedback,
  feedbackImageUrl,
  listFeedback,
  type FeedbackAdminItem,
  type FeedbackImage,
} from "@/lib/site";

import AdminTable, { type Column } from "../components/AdminTable";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

function imageNote(image: FeedbackImage): string {
  const mb = image.size / (1024 * 1024);
  const size = mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(image.size / 1024))}KB`;
  return `${size} · ${image.width}×${image.height}`;
}

export default function FeedbackAdmin() {
  const toast = useToast();
  const [items, setItems] = useState<FeedbackAdminItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<{ item: FeedbackAdminItem; index: number } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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

  const askDelete = useCallback(
    (item: FeedbackAdminItem) => {
      const who = item.username ? `@${item.username}` : "삭제된 계정";
      const shots = item.images.length;
      setConfirmError(null);
      setConfirm({
        title: "의견 지우기",
        effect: [
          `${who}의 의견을 지웁니다: ${item.body.length > 60 ? `${item.body.slice(0, 60)}…` : item.body}`,
          shots > 0 ? `붙은 사진 ${shots}장도 함께 지워집니다. 되돌릴 수 없어요.` : "되돌릴 수 없어요.",
          "감사 기록에 남습니다.",
        ],
        confirmLabel: "지우기",
        danger: true,
        onConfirm: async () => {
          setBusy(true);
          setConfirmError(null);
          try {
            await deleteFeedback(item.id);
            setItems((rows) => (rows ? rows.filter((row) => row.id !== item.id) : rows));
            setConfirm(null);
            toast.show("의견을 지웠습니다.");
          } catch (caught) {
            setConfirmError(describeError(caught));
          } finally {
            setBusy(false);
          }
        },
      });
    },
    [toast],
  );

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
      key: "images",
      header: "사진",
      render: (item) =>
        item.images.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <div className={styles.feedbackShots} data-testid="feedback-shots">
            {item.images.map((image, index) => (
              <button
                className={styles.feedbackShot}
                type="button"
                key={image.id}
                onClick={() => setViewing({ item, index })}
                aria-label={`사진 크게 보기: ${image.name}`}
                title={image.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 백엔드가 주는 회원 사진 */}
                <img src={feedbackImageUrl(image.id)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        ),
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
        rowActions={(item) => (
          <button className="btn btn-sm" type="button" onClick={() => askDelete(item)}>
            지우기
          </button>
        )}
        empty={items.length === 0 ? "아직 받은 의견이 없습니다." : "조건에 맞는 의견이 없습니다."}
      />

      {viewing && (
        <ImageLightbox
          images={viewing.item.images.map((image) => ({
            src: feedbackImageUrl(image.id),
            name: image.name,
            note: imageNote(image),
          }))}
          index={viewing.index}
          onClose={() => setViewing(null)}
        />
      )}

      <ConfirmDialog busy={busy} error={confirmError} request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function PageHeader() {
  return (
    <SharedPageHeader
      eyebrow="Admin"
      title={sectionLabel("feedback")}
      subtitle="회원이 화면 어디에서든 '의견 보내기'로 남긴 글과 스크린샷입니다. 운영진만 읽습니다."
    />
  );
}
