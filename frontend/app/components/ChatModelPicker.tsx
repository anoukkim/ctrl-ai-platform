"use client";

/**
 * Chat 입력창 옆의 모델 고르기.
 *
 * 모델은 **대화마다** 정합니다. 새 대화는 기본 모델로 시작하고, 바꾸면
 * 그 대화의 다음 답장부터 적용됩니다 — 이미 받은 답장은 그것을 쓴 모델과
 * 금액을 그대로 갖고 있습니다.
 *
 * 목록에는 이 회원이 고를 수 있는 모델만 옵니다(`/api/chat/info`). 각
 * 줄에는 이름, 한 줄 설명, "답장 1회 약 N원"이 있습니다. 어림값이라는 것을
 * 아래에 적어 둡니다: 실제 차감은 쓴 토큰만큼입니다.
 *
 * 고르는 창은 입력창이 바닥에 있어서 위로 열립니다. 바깥을 누르거나 Esc를
 * 누르면 닫힙니다.
 */

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { ChatModelOption } from "@/lib/chat";
import { formatKrw } from "@/lib/quarters";

import styles from "./chat-model-picker.module.css";

interface Props {
  models: ChatModelOption[];
  /** 지금 이 대화가 쓰는 모델. 고른 모델을 더는 쓸 수 없으면 null. */
  current: ChatModelOption | null;
  onChange: (model: ChatModelOption) => void;
  disabled?: boolean;
}

export function costLabel(model: ChatModelOption): string {
  return model.estimated_reply_krw === null
    ? "요금 정보 없음"
    : `답장 1회 약 ${formatKrw(model.estimated_reply_krw)}`;
}

export default function ChatModelPicker({ models, current, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (models.length === 0) return null;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${current ? "" : styles.triggerWarn}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={current ? `모델: ${current.label}. 바꾸기` : "모델을 골라 주세요"}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.triggerLabel}>{current ? current.label : "모델을 골라 주세요"}</span>
        {current && <span className={styles.triggerCost}>{costLabel(current)}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.popover}>
          <ul className={styles.list} id={listId} role="listbox" aria-label="모델">
            {models.map((model) => {
              const selected = current?.id === model.id;
              return (
                <li key={model.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={`${styles.option} ${selected ? styles.optionSelected : ""}`}
                    onClick={() => {
                      setOpen(false);
                      if (!selected) onChange(model);
                    }}
                  >
                    <span className={styles.optionHead}>
                      <span className={styles.optionLabel}>{model.label}</span>
                      {model.is_default && <span className="badge badge-muted">기본</span>}
                      {model.admin_only && <span className="badge badge-warn">관리자만</span>}
                      {selected && <Check size={14} aria-hidden="true" className={styles.check} />}
                    </span>
                    <span className={styles.optionDescription}>{model.description}</span>
                    <span className={styles.optionCost}>{costLabel(model)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={styles.footnote}>
            금액은 어림값입니다. 대화가 길어질수록 조금씩 늘고, 실제로는 쓴 만큼만 차감됩니다.
            모델을 바꾸면 이 대화의 다음 답장부터 적용됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
