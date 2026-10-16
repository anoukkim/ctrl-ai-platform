"use client";

/**
 * Profile › 알림의 목록 (feat-notifications, owner-polish 2).
 *
 * 최근 것부터, 안 읽은 줄은 점으로, 누르면 읽음이 되고 그 일이 있는 곳으로
 * 갑니다. "모두 읽음"은 한 번에. 종(사이드바)과 같은 줄 모양을 씁니다.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { NotificationRow } from "@/app/components/NotificationBell";
import { describeError } from "@/lib/http";
import {
  NOTIFICATIONS_CHANGED,
  announceNotificationsChanged,
  changedElsewhere,
  listNotifications,
  markAllRead,
  markRead,
  type Notification,
  type NotificationList,
} from "@/lib/notifications";

import styles from "./profile.module.css";

/** Profile에 보이는 줄 수 — 서버는 50개까지 주고, 90일 지난 것은 지웁니다. */
export const FEED_LIMIT = 30;
const ME = "feed";

type State = { phase: "loading" } | { phase: "ready"; list: NotificationList } | { phase: "error"; message: string };

export default function NotificationFeed() {
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "loading" });
  // 늦게 온 옛 응답이 새 상태를 덮지 않도록.
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    listNotifications()
      .then((list) => {
        if (mine === seq.current) setState({ phase: "ready", list });
      })
      .catch((error: unknown) => {
        if (mine === seq.current) setState({ phase: "error", message: describeError(error) });
      });
  }, []);

  useEffect(() => {
    load();
    // 종이 읽음 처리하면 여기도 새로 — 내 신호에는 내가 이미 상태를 바꿨습니다.
    const onChanged = (event: Event) => {
      if (changedElsewhere(event, ME)) load();
    };
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
  }, [load]);

  const pick = async (row: Notification) => {
    if (row.read_at === null) {
      try {
        await markRead(row.id);
        setState((current) =>
          current.phase === "ready"
            ? {
                phase: "ready",
                list: {
                  unread: Math.max(0, current.list.unread - 1),
                  items: current.list.items.map((item) =>
                    item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item,
                  ),
                },
              }
            : current,
        );
        announceNotificationsChanged(ME);
      } catch {
        /* 가는 건 갑니다 */
      }
    }
    if (row.link) router.push(row.link);
  };

  const readAll = async () => {
    try {
      await markAllRead();
      setState((current) =>
        current.phase === "ready"
          ? {
              phase: "ready",
              list: {
                unread: 0,
                items: current.list.items.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })),
              },
            }
          : current,
      );
      announceNotificationsChanged(ME);
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    }
  };

  if (state.phase === "loading") return <p className="small muted">알림을 불러오는 중…</p>;
  if (state.phase === "error") {
    return (
      <p className="small" role="alert">
        {state.message}
      </p>
    );
  }
  const { list } = state;
  const items = list.items.slice(0, FEED_LIMIT);
  return (
    <div className={styles.feed} data-testid="notification-feed">
      <div className={styles.feedHead}>
        <span className="small dim">
          {list.unread > 0 ? `안 읽음 ${list.unread}개` : items.length > 0 ? "모두 읽었어요" : ""}
        </span>
        {items.length > 0 && (
          <button className="btn btn-sm" type="button" onClick={() => void readAll()} disabled={list.unread === 0}>
            모두 읽음
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="small dim">아직 알림이 없어요. 게시가 끝나거나 참여 신청이 승인되면, 그리고 지원금을 쓴 날의 요약이 여기에 쌓여요.</p>
      ) : (
        <ul className={styles.feedList}>
          {items.map((row) => (
            <li key={row.id}>
              <NotificationRow row={row} onPick={() => void pick(row)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
