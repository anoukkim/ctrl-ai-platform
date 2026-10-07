"use client";

/**
 * 프롬프트 도움받기 (선택) — Video 작업 공간 오른쪽의 Claude 칸.
 *
 * **처음에는 접혀 있습니다.** 영상은 프롬프트만 적어도 만들 수 있고,
 * Claude는 그 글을 다듬는 데 쓰는 선택 사항이기 때문입니다.
 *
 * 하는 일은 하나, 프롬프트 글을 고쳐 주는 것뿐입니다. 영상을 만들지
 * 않으며 Higgsfield를 부르지도 않습니다 — 백엔드의 `prompt-help`는 Claude
 * 제공자만 부릅니다. 쓸 때마다 Build(Claude) 지원금에서 차감되고, 이
 * 칸이 한 줄로 그렇게 말합니다. 고친 프롬프트는 회원이 "적용"을 눌러야
 * 왼쪽에 들어갑니다.
 */

import { ChevronRight, Lock, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";

import ws from "@/app/components/workspace.module.css";
import { askPromptHelp, describeError } from "@/lib/projects";
import { NOT_PARTICIPATING_HINT } from "@/lib/quarters";

import styles from "./workspace.module.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  body: string;
  revisedPrompt?: string | null;
}

interface Props {
  projectId: string;
  prompt: string;
  mayCreate: boolean;
  /** 고친 프롬프트를 왼쪽 입력란에 넣습니다. */
  onApply: (revised: string) => void;
  /** 차감이 일어났을 때. 사이드바의 남은 금액을 새로 받습니다. */
  onCharged: () => void;
}

export const HELPER_TITLE = "프롬프트 도움받기 (선택)";

export default function PromptHelper({ projectId, prompt, mayCreate, onApply, onCharged }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async () => {
    const request = draft.trim();
    if (!mayCreate || busy || !request) return;

    setBusy(true);
    setError(null);
    const stamp = Date.now();
    setMessages((current) => [...current, { id: `u-${stamp}`, role: "user", body: request }]);
    setDraft("");
    try {
      const answer = await askPromptHelp(projectId, { prompt, request });
      setMessages((current) => [
        ...current,
        {
          id: `a-${stamp}`,
          role: "assistant",
          body: answer.reply,
          revisedPrompt: answer.revised_prompt,
        },
      ]);
      onCharged();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, mayCreate, onCharged, projectId, prompt]);

  if (!open) {
    return (
      <aside className={`${ws.pane} ${ws.paneLast} ${styles.helperCollapsed}`}>
        <button
          className={styles.helperOpen}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
        >
          <Sparkles size={15} aria-hidden="true" />
          <span className={styles.helperOpenLabel}>{HELPER_TITLE}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={`${ws.pane} ${ws.paneLast} ${styles.right}`}>
      <div className={styles.rightInner}>
        <div className={ws.paneHead}>
          <span className={ws.paneHeadTitle}>{HELPER_TITLE}</span>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded={true}
            aria-label="접기"
            title="접기"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
        <div className={ws.paneBody}>
          <p className={styles.helperCharge}>
            Claude는 프롬프트 글만 고쳐 주고 영상은 만들지 않습니다. 쓸 때마다 Build(Claude)
            지원금에서 차감됩니다.
          </p>
          <div className={ws.chatThread}>
            {messages.length === 0 && (
              <p className={styles.chatEmpty}>
                분위기, 카메라 움직임, 인물 구도처럼 바꾸고 싶은 것을 한국어로 적으면
                프롬프트를 고쳐 드립니다.
              </p>
            )}
            {messages.map((message) => (
              <div
                className={`${ws.chatMessage} ${
                  message.role === "user" ? ws.chatUser : ws.chatAssistant
                }`}
                key={message.id}
              >
                <span className={ws.chatRole}>{message.role === "user" ? "나" : "Claude"}</span>
                {message.body}
                {message.revisedPrompt && (
                  <button
                    className={`btn btn-sm ${styles.applyBtn}`}
                    type="button"
                    onClick={() => onApply(message.revisedPrompt as string)}
                    disabled={!mayCreate}
                    title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                  >
                    {!mayCreate && <Lock size={12} aria-hidden="true" />} 수정된 프롬프트 적용
                  </button>
                )}
              </div>
            ))}
            {error && (
              <p className={styles.actionError} role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className={ws.chatComposer}>
          <input
            className="field"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // 한글 조합 중 Enter는 무시합니다.
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={mayCreate ? "어떻게 바꿀까요?" : "이번 분기에는 사용할 수 없습니다"}
            disabled={!mayCreate || busy}
            title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
            aria-label="Claude에게 프롬프트 수정 요청하기"
          />
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => void send()}
            disabled={!mayCreate || busy || !draft.trim()}
            title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
          >
            {mayCreate ? (busy ? "…" : "보내기") : <Lock size={13} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
