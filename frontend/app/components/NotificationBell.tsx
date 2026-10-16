"use client";

/**
 * 사이드바 머리의 종 (feat-notifications, owner-polish 2; owner-polish-3 (c2)).
 *
 * 안 읽은 수를 달고, 누르면 최근 알림이 작은 창으로 열립니다. **여는 순간
 * 숫자가 사라집니다** — 보이는 것을 읽음으로 표시해요("벨 누르면 숫자는
 * 사라지고"). 각 줄을 누르면 그 일이 있는 곳(앱, 영상…)으로 가고, "지우기"는
 * 보이는 알림을 지웁니다 — 기록은 남기지 않아요. 알림은 여기에만 있습니다;
 * Profile에는 설정만 남았습니다.
 *
 * 숫자는 처음, 창이 다시 보일 때, 1분마다, 그리고 같은 창의 다른 곳이
 * 읽음 처리를 알릴 때 다시 받습니다. 실패는 조용히 — 종은 그대로 0.
 * 움직임은 없습니다(동작 줄이기와 무관하게).
 */

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  KIND_GLYPH,
  NOTIFICATIONS_CHANGED,
  announceNotificationsChanged,
  changedElsewhere,
  clearNotifications,
  listNotifications,
  markAllRead,
  unreadCount,
  type Notification,
  type NotificationList,
} from "@/lib/notifications";
import { relativeTime } from "@/lib/relative-time";

import styles from "./notifications.module.css";

export const POLL_MS = 60_000;
const ME = "bell";
/** 작은 창에 보이는 줄 수 — 나머지는 Profile에서. */
export const PANEL_LIMIT = 8;

interface Props {
  className?: string;
  onNavigate?: () => void;
}

export default function NotificationBell({ className = "", onNavigate }: Props) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<NotificationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLSpanElement | null>(null);
  // 늦게 온 옛 응답이 새 상태를 덮지 않도록 요청마다 번호를 붙입니다.
  const seq = useRef(0);
  const titleId = useId();

  const refreshCount = useCallback(() => {
    unreadCount()
      .then(({ unread: n }) => setUnread(n))
      .catch(() => {
        /* 종은 그대로 — 알림은 급하지 않습니다 */
      });
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refreshCount();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCount();
    };
    const onChanged = (event: Event) => {
      if (changedElsewhere(event, ME)) refreshCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [refreshCount]);

  const openPanel = useCallback(async () => {
    setOpen(true);
    setError(null);
    const mine = ++seq.current;
    try {
      const got = await listNotifications();
      if (mine !== seq.current) return;
      // The rows keep their "new" dot for this opening; the badge goes now.
      setList(got);
      setUnread(0);
      if (got.unread > 0) {
        markAllRead()
          .then(() => announceNotificationsChanged(ME))
          .catch(() => {
            /* the badge comes back on the next count if this did not stick */
          });
      }
    } catch {
      if (mine === seq.current) setError("알림을 불러오지 못했어요.");
    }
  }, []);

  // 열리면 초점이 창의 제목으로 — 화면 읽기가 새 창을 알도록.
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // 바깥을 누르거나 Esc를 누르면 닫힙니다.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const pick = (row: Notification) => {
    // Already read by opening the panel; a row just leads somewhere.
    setOpen(false);
    if (row.link) {
      onNavigate?.();
      router.push(row.link);
    }
  };

  // 지우기 (owner-polish-3 (c2)): the rows shown are deleted — no history.
  const clearShown = async () => {
    const ids = (list?.items ?? []).slice(0, PANEL_LIMIT).map((row) => row.id);
    if (ids.length === 0) return;
    try {
      await clearNotifications(ids);
      setList({ unread: 0, items: (list?.items ?? []).filter((row) => !ids.includes(row.id)) });
      setUnread(0);
      announceNotificationsChanged(ME);
    } catch {
      setError("알림을 지우지 못했어요.");
    }
  };

  const label = unread > 0 ? `알림 — 안 읽음 ${unread}개` : "알림";
  const items = list?.items.slice(0, PANEL_LIMIT) ?? [];

  return (
    <span className={styles.bellWrap}>
      <button
        ref={buttonRef}
        className={className}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : void openPanel())}
      >
        <Bell size={16} aria-hidden="true" />
        {unread > 0 && (
          <span className={styles.badge} data-testid="notification-count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open &&
        createPortal(
        <div ref={panelRef} className={styles.panel} role="dialog" aria-labelledby={titleId}>
          <div className={styles.panelHead}>
            <span id={titleId} ref={headingRef} tabIndex={-1}>
              알림
            </span>
            <button className="btn btn-sm" type="button" onClick={() => void clearShown()} disabled={items.length === 0}>
              지우기
            </button>
          </div>
          {error ? (
            <p className={styles.panelEmpty} role="alert">
              {error}
            </p>
          ) : list === null ? (
            <p className={styles.panelEmpty}>불러오는 중…</p>
          ) : items.length === 0 ? (
            <p className={styles.panelEmpty}>아직 알림이 없어요. 게시 완료, 신청 승인, 내 영상의 반응, 신고 처리가 여기에 와요.</p>
          ) : (
            <ul className={styles.panelList}>
              {items.map((row) => (
                <li key={row.id}>
                  <NotificationRow row={row} onPick={() => pick(row)} />
                </li>
              ))}
            </ul>
          )}
          <div className={styles.panelFoot}>
            <span className="small dim">지난 알림은 지우기로 비워요 — 따로 보관하지 않아요.</span>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

/** 한 줄 — 종의 창과 Profile 목록이 같이 씁니다. */
export function NotificationRow({ row, onPick }: { row: Notification; onPick: () => void }) {
  const unread = row.read_at === null;
  return (
    <button className={styles.row} type="button" onClick={onPick} data-unread={unread ? "true" : undefined}>
      <span className={`${styles.dot} ${unread ? styles.dotUnread : ""}`} aria-hidden="true" />
      {/* 화면 읽기에는 글로 — 점만으로는 안 읽음을 알 수 없습니다. 이름 전체(제목·설명·시각)가 읽힙니다. */}
      {unread && <span className="sr-only">안 읽음 · </span>}
      <span className={styles.text}>
        <span className={`${styles.title} ${unread ? "" : styles.titleRead}`}>
          <span aria-hidden="true">{KIND_GLYPH[row.kind] ?? "•"} </span>
          {row.title}
        </span>
        {row.body && <span className={styles.body}>{row.body}</span>}
        <span className={styles.time}>{relativeTime(row.created_at)}</span>
      </span>
    </button>
  );
}
