"use client";

/**
 * 이 미리보기로 Builder 시작 (chat-to-builder-carry, owner 2026-10-17).
 *
 * 대화에 미리보기가 있으면 "Project Builder에서 예시 앱 만들기"가 이 단추가
 * 돼요 — 미리보기 카드의 「Builder로 보내기」와 같은 길: 그 페이지가
 * index.html이 되고, 이름은 페이지의 제목, 그 대화에서 회원이 한 말은
 * SPEC.md(요구사항)로 함께 가요. 미리보기가 여럿이면 고르는 목록이 열리고,
 * 가장 최근 것이 먼저 골라져 있어요. 회원에게는 무료예요.
 */

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { CARRY_LABEL, type ChatPreview } from "@/lib/chat";
import { describeError } from "@/lib/http";
import { createProjectFromChat } from "@/lib/projects";

import styles from "./ChatWorkspace.module.css";

interface Props {
  previews: ChatPreview[];
  conversationId: number | null;
  conversationTitle: string;
  disabled: boolean;
}

export default function CarryToBuilder({ previews, conversationId, conversationTitle, disabled }: Props) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupId = useId();

  const start = async (preview: ChatPreview) => {
    setBusy(true);
    setError(null);
    try {
      const project = await createProjectFromChat({
        name: conversationTitle.slice(0, 40),
        html: preview.html,
        conversation_id: conversationId,
        reply_id: preview.replyId,
      });
      router.push(`/builder/${project.id}`);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  };

  return (
    <div data-testid="carry-to-builder">
      <button
        type="button"
        className={styles.suggestion}
        disabled={disabled || busy}
        onClick={() => (previews.length > 1 ? setPicking((open) => !open) : void start(previews[0]))}
        aria-expanded={previews.length > 1 ? picking : undefined}
      >
        {CARRY_LABEL} <span aria-hidden="true">→</span>
      </button>
      {picking && (
        <fieldset className={styles.carryPicker}>
          <legend>어느 미리보기로 시작할까요?</legend>
          {previews.map((preview, index) => (
            <label key={`${preview.replyId}-${index}`} className={styles.carryOption}>
              <input
                type="radio"
                name={groupId}
                checked={chosen === index}
                onChange={() => setChosen(index)}
              />
              {preview.title}
              {index === 0 && <span className={styles.carryNewest}> · 가장 최근</span>}
            </label>
          ))}
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void start(previews[chosen])}>
            이 미리보기로 시작
          </button>
        </fieldset>
      )}
      {error && (
        <p className={styles.errorNote} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
