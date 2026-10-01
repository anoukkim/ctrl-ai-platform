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
 *
 * **메뉴는 화면 맨 위(`document.body`)에 그립니다.** 표를 감싼 상자가
 * 스크롤되는 상자라서 — 머리글을 고정하려면 그래야 합니다 — 그 안에
 * 그리면 상자 밖으로 나가는 부분이 잘립니다. 아래쪽 줄에서 열면 마지막
 * 항목(탈퇴 처리)이 보이지 않았습니다. 누를 수 없는 메뉴 항목보다 나쁜
 * 것은 있는 줄도 모르는 메뉴 항목입니다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 단추의 실제 자리를 재서 메뉴를 그 아래에 놓습니다. 그림이 끝난 뒤가
  // 아니라 그려지기 직전에 재야, 메뉴가 엉뚱한 곳에 한 번 번쩍이지
  // 않습니다.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    // 화면이 움직이면 메뉴가 단추에서 떨어져 나갑니다. 따라다니게 만드는
    // 것보다 닫는 쪽이 간단하고, 어차피 바로 다시 열 수 있습니다.
    function onScrollOrResize() {
      setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onScrollOrResize);
    // 표 안쪽의 스크롤까지 잡으려면 번지는 단계가 아니라 붙잡는 단계에서
    // 들어야 합니다 — scroll은 위로 번지지 않습니다.
    window.addEventListener("scroll", onScrollOrResize, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  return (
    <div className={styles.rowMenu}>
      <button
        className="btn btn-sm"
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        {label} ▾
      </button>

      {open &&
        position !== null &&
        createPortal(
          <div
            className={styles.rowMenuList}
            ref={listRef}
            role="menu"
            style={{ top: position.top, right: position.right }}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
