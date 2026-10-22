"use client";

/**
 * Admin › Community › 의견 (prep-beta-launch → admin-ui-unify)
 *
 * 회원이 어느 화면에서든 "의견 보내기"로 남긴 글 — 운영진만 읽는 짧은
 * 메모입니다. 답장이나 처리 상태는 아직 없습니다. 줄을 누르면 오른쪽 판에서
 * 글 전체와 붙은 스크린샷(feedback-screenshots)을 봅니다. 사진은 누르면
 * 크게 — 저장본을 여는 길은 이 화면뿐입니다(회원은 403). 지우기는 글과
 * 사진을 함께 지우고 감사 기록에 남깁니다.
 *
 * 분기와 상관없는 목록이고, 최신 글이 위에 옵니다.
 */

import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import ImageLightbox from "@/app/components/ImageLightbox";
import { matchesQuery } from "@/app/components/SearchBar";
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

import { ItemList, ItemRow, Mono, PanelBar, PanelSection, SidePanel, Stack, Stats, Tag } from "../components/AdminUI";

import adminStyles from "../admin.module.css";
import styles from "../community/community.module.css";

function imageNote(image: FeedbackImage): string {
  const mb = image.size / (1024 * 1024);
  const size = mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(image.size / 1024))}KB`;
  return `${size} · ${image.width}×${image.height}`;
}

const author = (item: FeedbackAdminItem) => (item.username ? `${item.display_name} @${item.username}` : "삭제된 계정");

export default function FeedbackAdmin() {
  const toast = useToast();
  const [items, setItems] = useState<FeedbackAdminItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [shotsOnly, setShotsOnly] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
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
            setOpenId(null);
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
      <div className="card">
        <p className="small muted">의견을 불러오지 못했습니다. {error}.</p>
      </div>
    );
  }

  if (items === null) return <Skeleton />;

  const visible = items.filter(
    (item) =>
      (!shotsOnly || item.images.length > 0) &&
      matchesQuery(query, item.body, item.page, item.display_name ?? "", item.username ?? ""),
  );
  const withShots = items.filter((item) => item.images.length > 0).length;
  const people = new Set(items.map((item) => item.user_id ?? `gone-${item.id}`)).size;
  const open = items.find((item) => item.id === openId) ?? null;

  return (
    <Stack>
      <Stats
        items={[
          { key: "all", value: items.length, label: "받은 의견" },
          { key: "shots", value: withShots, label: "사진 붙은 의견" },
          { key: "people", value: people, label: "보낸 회원" },
        ]}
      />

      <PanelBar
        left={
          <>
            <input
              className={`field ${styles.search}`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="내용, 화면, 회원으로 검색"
              aria-label="의견 검색"
            />
            <button type="button" className="chip" aria-pressed={shotsOnly} onClick={() => setShotsOnly((v) => !v)}>
              사진 있음
            </button>
          </>
        }
        note={query || shotsOnly ? `${visible.length} / ${items.length}개` : "운영진만 읽어요"}
        help={
          <p>
            회원이 화면 어디에서든 &lsquo;의견 보내기&rsquo;로 남긴 글과 스크린샷이에요. 줄을 누르면 글 전체와 사진을 보고,
            사진은 누르면 크게 보여요. 지우기는 글과 사진을 함께 지우고 되돌릴 수 없으며, 감사 기록에 남습니다. 분기와
            상관없이 최신 글이 위에 와요.
          </p>
        }
      />

      <ItemList
        testId="feedback-list"
        empty={
          visible.length === 0 ? (items.length === 0 ? "아직 받은 의견이 없습니다." : "조건에 맞는 의견이 없습니다.") : undefined
        }
      >
        {visible.map((item) => (
          <ItemRow
            key={item.id}
            testId="feedback-item"
            onClick={() => setOpenId(item.id)}
            title={<span className={styles.clip}>{item.body}</span>}
            tags={item.images.length > 0 ? <Tag tone="accent">사진 {item.images.length}장</Tag> : undefined}
            sub={
              <>
                {author(item)} · {formatWhen(item.created_at)} · <Mono>{item.page || "—"}</Mono>
              </>
            }
            action={
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => setOpenId(item.id)}
                aria-label={`의견 열기: ${item.body.slice(0, 30)}`}
              >
                열기
              </button>
            }
          />
        ))}
      </ItemList>

      {open && (
        <SidePanel
          key={open.id}
          title="의견"
          subtitle={
            <>
              {author(open)} · {formatWhen(open.created_at)}
            </>
          }
          onClose={() => setOpenId(null)}
          width="wide"
          testId="feedback-panel"
          footer={
            <>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => askDelete(open)}>
                지우기
              </button>
              <button className="btn btn-sm" type="button" onClick={() => setOpenId(null)}>
                닫기
              </button>
            </>
          }
        >
          <PanelSection title="내용">
            <p className={styles.quote}>{open.body}</p>
            <dl className={styles.facts}>
              <dt>화면</dt>
              <dd>
                <Mono>{open.page || "—"}</Mono>
              </dd>
            </dl>
          </PanelSection>
          {open.images.length > 0 && (
            <PanelSection title={`사진 ${open.images.length}장`}>
              <div className={adminStyles.feedbackShots} data-testid="feedback-shots">
                {open.images.map((image, index) => (
                  <button
                    className={adminStyles.feedbackShot}
                    type="button"
                    key={image.id}
                    onClick={() => setViewing({ item: open, index })}
                    aria-label={`사진 크게 보기: ${image.name}`}
                    title={`${image.name} · ${imageNote(image)}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 백엔드가 주는 회원 사진 */}
                    <img src={feedbackImageUrl(image.id)} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            </PanelSection>
          )}
        </SidePanel>
      )}

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
    </Stack>
  );
}
