/**
 * 비어 있는 목록 — 왜 비었는지 한 줄, 할 수 있는 일 하나(ui-friendly-motion).
 *
 * 빈 화면은 처음 온 회원이 가장 먼저 보는 화면입니다. "아직 없습니다"로
 * 끝내지 않고 무엇을 하면 채워지는지, 그 일을 바로 할 단추를 함께 둡니다.
 */

import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import styles from "./empty-state.module.css";

export interface EmptyAction {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export default function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  text: string;
  action?: EmptyAction;
  /** 사이드바나 카드 안처럼 좁은 자리. */
  compact?: boolean;
}) {
  return (
    <div className={`${styles.empty} ${compact ? styles.compact : ""}`} data-testid="empty-state">
      {Icon && <Icon className={styles.icon} aria-hidden="true" />}
      <p className={styles.title}>{title}</p>
      <p className={styles.text}>{text}</p>
      {action &&
        (action.href ? (
          <Link className="btn btn-primary btn-sm" href={action.href}>
            {action.label}
          </Link>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}
