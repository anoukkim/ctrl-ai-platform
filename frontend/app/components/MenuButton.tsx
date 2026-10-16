"use client";

/**
 * 단추 하나가 여는 작은 메뉴 (quality-tuning Q3 — Builder의 "내보내기 ▾", "⋯").
 *
 * 키보드: 단추에서 Enter·Space·↓로 열면 첫 항목에 초점, ↑↓·Home·End로
 * 움직이고, Esc나 Tab이면 닫힌 뒤 초점이 단추로 돌아갑니다. 바깥을 누르면
 * 닫힙니다. 화면 읽기 프로그램에는 menu / menuitem으로 읽힙니다.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import styles from "./menu-button.module.css";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** 마우스를 올리면 보이는 한 줄 설명. */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  /** 단추에 보이는 것 — 글자나 아이콘. */
  children: React.ReactNode;
  /** 아이콘만 있는 단추의 이름(화면 읽기 프로그램용). */
  label?: string;
  title?: string;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
  disabled?: boolean;
}

export default function MenuButton({
  children,
  label,
  title,
  items,
  align = "end",
  className = "btn btn-sm",
  disabled = false,
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const focusItem = useCallback(
    (index: number) => {
      const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);
      if (enabled.length === 0) return;
      const target = enabled.includes(index)
        ? index
        : index < 0
          ? enabled[enabled.length - 1]
          : enabled[0];
      itemRefs.current[target]?.focus();
    },
    [items],
  );

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  useEffect(() => {
    if (open) focusItem(0);
  }, [open, focusItem]);

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const current = itemRefs.current.findIndex((node) => node === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusNext(current, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusNext(current, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(-1);
    }
  }

  function focusNext(from: number, step: 1 | -1) {
    for (let i = 1; i <= items.length; i += 1) {
      const index = (from + step * i + items.length) % items.length;
      if (!items[index].disabled) {
        itemRefs.current[index]?.focus();
        return;
      }
    }
  }

  return (
    <span className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        className={className}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children}
      </button>
      {open && (
        <ul
          className={`${styles.menu} ${align === "end" ? styles.alignEnd : ""}`}
          id={`${id}-menu`}
          role="menu"
          aria-label={label ?? (typeof children === "string" ? children : undefined)}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <li key={item.label} role="none">
              <button
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className={`${styles.item} ${item.danger ? styles.danger : ""}`}
                type="button"
                role="menuitem"
                tabIndex={-1}
                title={item.hint}
                disabled={item.disabled}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                <span>{item.label}</span>
                {item.hint && <span className={styles.hint}>{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
