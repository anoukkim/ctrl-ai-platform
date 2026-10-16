"use client";

/**
 * 사이드바 계정 영역의 종 (feat-notifications, owner-polish 2).
 *
 * 안 읽은 수를 달고, 누르면 최근 알림 몇 개가 작은 창으로 열립니다 — 각
 * 줄을 누르면 읽음으로 표시되고 그 일이 있는 곳(앱, Usage…)으로 갑니다.
 * "모두 읽음"과 Profile의 전체 목록으로 가는 링크가 있습니다.
 *
 * 숫자는 처음, 창이 다시 보일 때, 1분마다, 그리고 같은 창의 다른 곳이
 * 읽음 처리를 알릴 때 다시 받습니다. 실패는 조용히 — 종은 그대로 0.
 * 움직임은 없습니다(동작 줄이기와 무관하게).
 */

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  KIND_GLYPH,
  NOTIFICATIONS_CHANGED,
  announceNotificationsChanged,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  type Notification,
  type NotificationList,
} from "@/lib/notifications";
import { relativeTime } from "@/lib/relative-time";

import styles from "./notifications.module.css";

export const POLL_MS = 60_000;
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
    const onChanged = () => refreshCount();
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
    try {
      const got = await listNotifications();
      setList(got);
      setUnread(got.unread);
    } catch {
      setError("알림을 불러오지 못했어요.");
    }
  }, []);

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

  const pick = async (row: Notification) => {
    if (row.read_at === null) {
      try {
        await markRead(row.id);
        setList((current) =>
          current
            ? {
                unread: Math.max(0, current.unread - 1),
                items: current.items.map((item) =>
                  item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item,
                ),
              }
            : current,
        );
        setUnread((n) => Math.max(0, n - 1));
        announceNotificationsChanged();
      } catch {
        /* 읽음 표시가 안 돼도 가는 건 갑니다 */
      }
    }
    setOpen(false);
    if (row.link) {
      onNavigate?.();
      router.push(row.link);
    }
  };

  const readAll = async () => {
    try {
      await markAllRead();
      setUnread(0);
      setList((current) =>
        current
          ? { unread: 0, items: current.items.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })) }
          : current,
      );
      announceNotificationsChanged();
    } catch {
      setError("모두 읽음으로 바꾸지 못했어요.");
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
      {open && (
        <div ref={panelRef} className={styles.panel} role="dialog" aria-labelledby={titleId}>
          <div className={styles.panelHead}>
            <span id={titleId}>알림</span>
            <button className="btn btn-sm" type="button" onClick={() => void readAll()} disabled={unread === 0}>
              모두 읽음
            </button>
          </div>
          {error ? (
            <p className={styles.panelEmpty} role="alert">
              {error}
            </p>
          ) : list === null ? (
            <p className={styles.panelEmpty}>불러오는 중…</p>
          ) : items.length === 0 ? (
            <p className={styles.panelEmpty}>아직 알림이 없어요. 게시, 신청 승인, 지원금 사용 요약이 여기에 쌓여요.</p>
          ) : (
            <ul className={styles.panelList}>
              {items.map((row) => (
                <li key={row.id}>
                  <NotificationRow row={row} onPick={() => void pick(row)} />
                </li>
              ))}
            </ul>
          )}
          <div className={styles.panelFoot}>
            <Link href="/profile#notifications" onClick={() => { setOpen(false); onNavigate?.(); }}>
              Profile에서 전체 보기
            </Link>
          </div>
        </div>
      )}
    </span>
  );
}

/** 한 줄 — 종의 창과 Profile 목록이 같이 씁니다. */
export function NotificationRow({ row, onPick }: { row: Notification; onPick: () => void }) {
  const unread = row.read_at === null;
  return (
    <button
      className={styles.row}
      type="button"
      onClick={onPick}
      aria-label={`${unread ? "안 읽음 · " : ""}${row.title}`}
      data-unread={unread ? "true" : undefined}
    >
      <span className={`${styles.dot} ${unread ? styles.dotUnread : ""}`} aria-hidden="true" />
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
