"use client";

/**
 * 표의 한 줄에 붙는 "관리" 메뉴.
 *
 * 이전 화면은 줄마다 작은 버튼을 세 개씩 나란히 두었습니다 — 참여 등록,
 * 비활동, 지원금. 서로 붙어 있어 잘못 누르기 쉬웠고, 그 가운데 하나는
 * 바로 반영되는 작업이었습니다.
 *
 * 메뉴 하나로 바꾸면 기본 상태에서는 누를 수 있는 것이 하나뿐이고, 고른
 * 뒤에는 확인창이 한 번 더 막습니다.
 */

import { useEffect, useRef, useState } from "react";

import styles from "../admin.module.css";

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** 계정을 닫는 것처럼 무게가 다른 항목. */
  danger?: boolean;
}

export default function RowMenu({
  items,
  label = "관리",
}: {
  items: RowMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 바깥을 누르면 닫습니다.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.rowMenu} ref={wrapRef}>
      <button
        className="btn btn-sm"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        {label} ▾
      </button>

      {open && (
        <div className={styles.rowMenuList} role="menu">
          {items.map((item) => (
            <button
              className={`${styles.rowMenuItem} ${item.danger ? styles.rowMenuItemDanger : ""}`}
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
