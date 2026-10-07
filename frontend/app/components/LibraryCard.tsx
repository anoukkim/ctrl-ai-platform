"use client";

/**
 * 목록 화면의 작업물 카드 하나 — 이름, 상태 배지, ⋯ 메뉴.
 *
 * Project Builder와 Video Generator의 목록이 **같은 것을 씁니다.** 두
 * 목록은 같은 모양의 카드를 쓰고 있었고, 이름 바꾸기와 삭제를 양쪽에
 * 따로 적을 이유가 없습니다.
 *
 * 카드는 더 이상 `<Link>`가 아닙니다. 링크 안에 단추를 넣는 것은 올바른
 * HTML이 아니고, 메뉴를 누를 때마다 프로젝트가 열리는 결과가 됩니다.
 * 대신 평범한 칸 위에 카드를 덮는 링크를 깔고, 메뉴와 이름 칸만 그
 * 위로 올립니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { describeError } from "@/lib/http";

import styles from "./library.module.css";

/** 메뉴 한 줄. `href`가 있으면 링크로 그립니다 — WorkspaceTitle과 같습니다. */
export interface CardAction {
  label: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}

export interface LibraryCardProps {
  href: string;
  name: string;
  /** 상태 배지. 제품마다 다르므로 그대로 받습니다. */
  badge: ReactNode;
  /** 설명과 아래쪽 메타 줄. */
  children: ReactNode;
  mayEdit: boolean;
  lockedHint: string;
  /** 거절되면 throw. 한국어 문구를 카드 안에 보여 줍니다. */
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
  /** 다운로드처럼 참여 여부와 상관없는 동작들. */
  extraActions?: CardAction[];
  /**
   * 카드의 그림 자리. 장식이라 읽어 주지 않습니다.
   * `top`은 카드 위쪽 전체 — 두 목록 모두 이것을 씁니다(Builder는 빗금
   * 자리, Video는 버전의 실제 화면). `side`는 왼쪽의 좁은 칸입니다.
   */
  thumbnail?: ReactNode;
  thumbnailPlacement?: "top" | "side";
}

const NOTE_MS = 2400;

export default function LibraryCard({
  href,
  name,
  badge,
  children,
  mayEdit,
  lockedHint,
  onRename,
  onDelete,
  extraActions = [],
  thumbnail,
  thumbnailPlacement = "top",
}: LibraryCardProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const startEditing = useCallback(() => {
    setOpen(false);
    setError(null);
    setDraft(name);
    setEditing(true);
    cancelledRef.current = false;
  }, [name]);

  const save = useCallback(async () => {
    if (cancelledRef.current) return;

    const next = draft.trim();
    if (next === name) {
      setEditing(false);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onRename(next);
      setEditing(false);
      setNote("이름을 바꿨습니다");
    } catch (caught) {
      setError(describeError(caught));
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }, [draft, name, onRename]);

  const cancelEditing = useCallback(() => {
    cancelledRef.current = true;
    setEditing(false);
    setError(null);
    setDraft(name);
  }, [name]);

  const confirmDelete = useCallback(() => {
    setOpen(false);
    onDelete();
  }, [onDelete]);

  return (
    <article
      className={`${styles.card} ${open ? styles.cardOpen : ""} ${
        thumbnail && thumbnailPlacement === "side" ? styles.cardSide : ""
      }`}
    >
      {/* 카드를 덮는 링크. 이름 칸을 쓰는 동안에는 깔지 않습니다 —
          글자를 고치려 눌렀을 뿐인데 화면이 바뀌면 안 됩니다. */}
      {!editing && <Link aria-label={name} className={styles.cardLink} href={href} />}

      {thumbnail && (
        <div
          aria-hidden="true"
          className={thumbnailPlacement === "side" ? styles.cardThumbSide : styles.cardThumbTop}
        >
          {thumbnail}
        </div>
      )}

      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          {/* 이름과 상태 배지는 한 덩어리로 왼쪽에 붙습니다. 이름이 길면
              말줄임표로 줄고, 배지는 이름 바로 뒤에 남습니다. ⋯은 오른쪽에
              혼자 있습니다 (ui-library-cards 1). */}
          <div className={styles.cardTitle}>
          {editing ? (
            <input
              aria-label="이름"
              className={styles.cardNameInput}
              disabled={busy}
              maxLength={60}
              onBlur={() => void save()}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // 조합이 끝난 뒤에만 보냅니다 — 한글 마지막 글자가 잘립니다.
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void save();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditing();
                }
              }}
              ref={inputRef}
              value={draft}
              autoFocus
            />
          ) : (
            <span className={styles.cardName} title={name}>
              {name}
            </span>
          )}

          <span className={styles.cardBadge}>{badge}</span>
          </div>

          <div className={styles.cardMenu} ref={menuRef}>
            <button
              aria-expanded={open}
              aria-haspopup="menu"
              aria-label={`${name} 메뉴`}
              className={styles.cardMenuButton}
              onClick={() => setOpen((value) => !value)}
              title="더보기"
              type="button"
            >
              <span aria-hidden="true">⋯</span>
            </button>

            {open && (
              <ul className={styles.cardMenuList} role="menu">
                <li role="none">
                  <button
                    className={styles.cardMenuItem}
                    disabled={!mayEdit}
                    onClick={startEditing}
                    role="menuitem"
                    title={mayEdit ? undefined : lockedHint}
                    type="button"
                  >
                    이름 바꾸기
                  </button>
                </li>

                {extraActions.map((action) => (
                  <li key={action.label} role="none">
                    {action.href ? (
                      <a
                        className={styles.cardMenuItem}
                        download
                        href={action.href}
                        onClick={() => setOpen(false)}
                        role="menuitem"
                        title={action.title}
                      >
                        {action.label}
                      </a>
                    ) : (
                      <button
                        className={styles.cardMenuItem}
                        disabled={action.disabled}
                        onClick={action.onSelect}
                        role="menuitem"
                        title={action.title}
                        type="button"
                      >
                        {action.label}
                      </button>
                    )}
                  </li>
                ))}

                <li role="none">
                  <button
                    className={`${styles.cardMenuItem} ${styles.cardMenuItemDanger}`}
                    disabled={!mayEdit}
                    onClick={confirmDelete}
                    role="menuitem"
                    title={mayEdit ? undefined : lockedHint}
                    type="button"
                  >
                    삭제
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>

        {note && <span className={styles.cardNote}>{note}</span>}
        {error && (
          <span className={styles.cardError} role="alert">
            {error}
          </span>
        )}

        {children}
      </div>
    </article>
  );
}
