"use client";

/**
 * 작업 공간 위쪽 막대의 제목 — 이름, 건너가기 메뉴, 그리고 동작들.
 *
 * Project Builder와 Video Generator가 **같은 것을 씁니다.** 두 작업
 * 공간은 같은 자리에 같은 모양의 제목을 두고 있었고, 이름 바꾸기와
 * 삭제를 양쪽에 따로 적으면 한쪽만 고치는 날이 옵니다. 댓글 영역을
 * `CommentSection`으로 모은 것과 같은 이유입니다.
 *
 * 이름을 바꾸는 길이 둘입니다. 명세가 그렇게 요구합니다:
 *
 * - **제목을 누르면** 그 자리에서 고칩니다 (Enter 저장, Esc 취소).
 * - **▾ 메뉴의 "이름 바꾸기"** 도 같은 칸을 엽니다.
 *
 * 그래서 제목과 ▾는 서로 다른 단추입니다. 하나로 두면 "제목을 눌러
 * 고친다"와 "눌러서 메뉴를 연다"가 같은 동작을 두고 다투게 됩니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { describeError } from "@/lib/http";

import ws from "./workspace.module.css";

/** 메뉴에서 건너갈 수 있는 다른 작업물 한 줄. */
export interface TitleSibling {
  id: number;
  name: string;
  href: string;
  /** 오른쪽에 작게 붙는 상태 이름. */
  meta: string;
}

/** 메뉴 아래쪽에 들어가는 동작 한 줄. */
export interface TitleAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}

export interface WorkspaceTitleProps {
  name: string;
  currentId: number;
  siblings: TitleSibling[];
  /** 건너가기 목록이 비었을 때 보여 줄 말. */
  emptyLabel: string;
  /**
   * 새 이름을 저장합니다. 거절되면 throw하고, 그 한국어 문구가 제목
   * 옆에 그대로 나옵니다 — 백엔드가 "이름을 입력해 주세요."처럼 이미
   * 사람이 읽을 문장을 돌려줍니다.
   */
  onRename: (name: string) => Promise<void>;
  /** 이름 바꾸기·삭제가 가능한지. 참여하지 않는 분기에는 false입니다. */
  mayEdit: boolean;
  /** 막혔을 때 단추에 붙는 설명. */
  lockedHint: string;
  /** 삭제. 창을 띄우는 쪽은 부모입니다 — 지운 뒤 어디로 갈지도 부모가 압니다. */
  onDelete: () => void;
  /** 다운로드처럼 참여 여부와 상관없는 동작들. */
  extraActions?: TitleAction[];
}

/** 확인 문구가 사라지기까지. 읽을 만큼 길고, 남지 않을 만큼 짧게. */
const NOTE_MS = 2400;

export default function WorkspaceTitle({
  name,
  currentId,
  siblings,
  emptyLabel,
  onRename,
  mayEdit,
  lockedHint,
  onDelete,
  extraActions = [],
}: WorkspaceTitleProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Esc로 빠져나갈 때 이어서 일어나는 blur가 저장을 또 부르지 않도록.
  const cancelledRef = useRef(false);

  // 바깥을 누르면 메뉴를 닫습니다. 고치는 칸은 여기서 닫지 않습니다 —
  // 칸의 blur가 알아서 처리합니다.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
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
    if (!mayEdit) return;
    setOpen(false);
    setError(null);
    setDraft(name);
    setEditing(true);
    cancelledRef.current = false;
  }, [mayEdit, name]);

  const save = useCallback(async () => {
    if (cancelledRef.current) return;

    const next = draft.trim();
    // 바뀐 게 없으면 요청을 보내지 않습니다. 같은 이름을 저장했다고
    // 알리는 것은 거짓은 아니지만 쓸모없는 소음입니다.
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
      // 문구는 백엔드가 준 한국어 문장입니다. 칸은 열어 둡니다 —
      // 고치던 글자를 잃지 않도록.
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
    <div className={ws.switcher} ref={wrapRef}>
      {editing ? (
        <input
          aria-label="이름"
          className={ws.titleInput}
          disabled={busy}
          maxLength={60}
          onBlur={() => void save()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // 한글은 조합이 끝난 뒤에만 보냅니다. 조합 중의 Enter는
            // 마지막 글자를 잘라 버립니다.
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
        <button
          className={ws.switcherButton}
          onClick={startEditing}
          title={mayEdit ? "눌러서 이름 바꾸기" : lockedHint}
          type="button"
        >
          <span className={ws.switcherName}>{name}</span>
        </button>
      )}

      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="작업물 메뉴"
        className={ws.switcherButton}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className={ws.switcherCaret} aria-hidden="true">
          ▾
        </span>
      </button>

      {note && <span className={ws.titleNote}>{note}</span>}
      {error && (
        <span className={ws.titleError} role="alert">
          {error}
        </span>
      )}

      {open && (
        <ul className={ws.switcherMenu} role="menu">
          <li className={ws.switcherLabel} role="none">
            건너가기
          </li>
          {siblings.length === 0 && <li className={ws.switcherEmpty}>{emptyLabel}</li>}
          {siblings.map((item) => (
            <li key={item.id} role="none">
              <Link
                className={`${ws.switcherItem} ${
                  item.id === currentId ? ws.switcherItemActive : ""
                }`}
                href={item.href}
                onClick={() => setOpen(false)}
                role="menuitem"
              >
                <span>{item.name}</span>
                <span className={ws.switcherItemMeta}>{item.meta}</span>
              </Link>
            </li>
          ))}

          <li className={ws.switcherSeparator} role="separator" />

          <li role="none">
            <button
              className={ws.switcherAction}
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
              <button
                className={ws.switcherAction}
                disabled={action.disabled}
                onClick={action.onSelect}
                role="menuitem"
                title={action.title}
                type="button"
              >
                {action.label}
              </button>
            </li>
          ))}

          <li role="none">
            <button
              className={`${ws.switcherAction} ${ws.switcherActionDanger}`}
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
  );
}
