"use client";

/**
 * Chat 작업 영역 — 대화 목록, 대화 내용, 입력창.
 *
 * 진짜 대화 앱처럼 움직입니다. 대화 내용이 남은 높이를 전부 차지하고 그
 * 안에서 스크롤되며, 입력창은 바닥에 고정됩니다.
 *
 * 답장은 백엔드가 Claude에게서 받는 대로 조각조각 흘려보내고(`lib/chat.ts`),
 * 화면은 받은 조각을 말풍선에 이어 붙입니다. **중지**는 연결을 끊습니다 —
 * 백엔드는 그때까지 만든 답장을 저장하고 쓴 만큼만 차감합니다.
 *
 * 처음에는 환영 인사와 바로가기 카드를 보여 주고, 대화가 한 번이라도
 * 오가면 감춥니다.
 *
 * 이번 분기에 참여하지 않는 회원도 지난 대화는 읽을 수 있습니다. 보내기,
 * 새 대화, 이름 바꾸기, 지우기만 막힙니다 — 실제 차단은 백엔드의
 * `require_active_member`가 하고, 여기서는 이유를 설명합니다.
 */

import {
  Clapperboard,
  Code2,
  LayoutGrid,
  ListIcon,
  Lock,
  Pencil,
  PlayCircle,
  Plus,
  SendHorizontal,
  Square,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  ACTION_LABEL,
  actionHref,
  createConversation,
  deleteConversation,
  getChatInfo,
  getConversation,
  listConversations,
  renameConversation,
  sendMessage,
  type ChatAction,
  type ChatInfo,
  type ChatMessage,
  type ChatMessageStatus,
  type Conversation,
} from "@/lib/chat";
import { describeError } from "@/lib/http";
import { CHAT_SHORTCUTS } from "@/lib/mock-data";
import { NOT_PARTICIPATING_HINT } from "@/lib/quarters";

import BrandMark from "./BrandMark";
import styles from "./ChatWorkspace.module.css";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import { useMayCreate } from "./MyQuarterProvider";
import NotParticipatingBanner from "./NotParticipatingBanner";

/** 바로가기 카드의 아이콘. 사이드바와 같은 한 벌을 씁니다. */
/** 바로가기 아이콘 칸의 색. 만드는 곳은 영역 색, 둘러보는 곳은 강조색입니다. */
const SHORTCUT_TONE: Record<string, string> = {
  build: "toneBuild",
  video: "toneVideo",
  apps: "toneAccent",
  tube: "toneAccent",
};

const SHORTCUT_ICON: Record<string, LucideIcon> = {
  build: Code2,
  video: Clapperboard,
  apps: LayoutGrid,
  tube: PlayCircle,
};

/** 입력창이 늘어날 수 있는 최대 줄 수. 그보다 길어지면 안에서 스크롤됩니다. */
const MAX_ROWS = 6;

/** 테스트 모드 표시. prep-beta-launch가 다른 화면에도 같은 문구를 씁니다. */
export const TEST_MODE_LABEL = "테스트 모드 – 실제 AI 결과가 아닙니다";

/** 화면에 그리는 한 줄. 저장된 메시지이거나, 아직 오고 있는 답장입니다. */
interface ViewMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  status: ChatMessageStatus;
  action: ChatAction | null;
  actionTitle: string;
  /** 답장이 아직 오고 있습니다. */
  streaming?: boolean;
  /** 이 메시지 다음에 보여 줄 오류. 답장이 실패했을 때 붙습니다. */
  error?: string;
}

function toView(message: ChatMessage): ViewMessage {
  return {
    key: `m${message.id}`,
    role: message.role,
    content: message.content,
    status: message.status,
    action: message.action,
    actionTitle: message.action_title,
  };
}

/** 답장 아래에 붙는 한 줄 설명. 끝까지 온 답장에는 없습니다. */
const STATUS_NOTE: Partial<Record<ChatMessageStatus, string>> = {
  stopped: "중지됨 — 여기까지 쓴 만큼만 차감됩니다.",
  truncated: "답장이 길어 여기서 끊겼습니다. \"계속\"이라고 보내면 이어서 씁니다.",
  refused: "이 질문에는 답할 수 없어요. 다른 방식으로 물어봐 주세요.",
};

export default function ChatWorkspace() {
  const mayCreate = useMayCreate();

  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  /** 스트림 전에 거절된 이유 — 입력창 바로 위에 보여 줍니다. */
  const [sendError, setSendError] = useState<string | null>(null);
  /** 좁은 화면에서 대화 목록을 펼쳤는지. */
  const [listOpen, setListOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const inputId = useId();
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const started = messages.length > 0;

  // 처음 한 번: 테스트 모드인지, 그리고 지난 대화 목록.
  useEffect(() => {
    let cancelled = false;
    getChatInfo()
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch(() => {
        /* 정보가 없어도 대화는 됩니다 */
      });
    listConversations()
      .then((rows) => {
        if (!cancelled) setConversations(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setListError(describeError(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 화면을 떠나면 오고 있던 답장도 멈춥니다.
  useEffect(() => () => abortRef.current?.abort(), []);

  // 새 메시지나 조각이 오면 맨 아래로 내립니다.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  /**
   * 입력한 줄 수에 맞춰 입력창 높이를 조절합니다.
   *
   * 높이를 auto로 되돌린 뒤 scrollHeight를 읽는 것이 핵심입니다. 그러지
   * 않으면 한 번 커진 높이가 줄어들지 않습니다.
   */
  const resize = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;

    node.style.height = "auto";
    const line = parseFloat(getComputedStyle(node).lineHeight) || 22;
    const padding = node.offsetHeight - node.clientHeight;
    const max = line * MAX_ROWS + padding;
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resize();
  }, [draft, resize]);

  const refreshList = useCallback(async () => {
    try {
      setConversations(await listConversations());
      setListError(null);
    } catch (error) {
      setListError(describeError(error));
    }
  }, []);

  const openConversation = useCallback(async (id: number) => {
    if (abortRef.current) return; // 답장이 오는 중에는 옮기지 않습니다
    setListOpen(false);
    setSendError(null);
    setActiveId(id);
    setLoadingConversation(true);
    try {
      const detail = await getConversation(id);
      setMessages(detail.messages.map(toView));
    } catch (error) {
      setMessages([]);
      setSendError(describeError(error));
    } finally {
      setLoadingConversation(false);
    }
  }, []);

  const startNew = useCallback(() => {
    if (abortRef.current) return;
    setListOpen(false);
    setActiveId(null);
    setMessages([]);
    setSendError(null);
    textareaRef.current?.focus();
  }, []);

  const send = useCallback(async () => {
    if (!mayCreate || streaming) return;
    const text = draft.trim();
    if (!text) return;

    setSendError(null);
    setStreaming(true);

    // 처음 보내는 메시지라면 대화부터 만듭니다.
    let conversationId = activeId;
    if (conversationId === null) {
      try {
        const created = await createConversation();
        conversationId = created.id;
        setActiveId(created.id);
        setConversations((rows) => [created, ...rows]);
      } catch (error) {
        setSendError(describeError(error));
        setStreaming(false);
        return;
      }
    }

    const stamp = Date.now();
    const userKey = `u${stamp}`;
    const replyKey = `r${stamp}`;
    setDraft("");
    setMessages((rows) => [
      ...rows,
      { key: userKey, role: "user", content: text, status: "complete", action: null, actionTitle: "" },
      {
        key: replyKey,
        role: "assistant",
        content: "",
        status: "complete",
        action: null,
        actionTitle: "",
        streaming: true,
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const patchReply = (patch: (row: ViewMessage) => ViewMessage | null) =>
      setMessages((rows) =>
        rows.flatMap((row) => {
          if (row.key !== replyKey) return [row];
          const next = patch(row);
          return next ? [next] : [];
        }),
      );

    try {
      const outcome = await sendMessage(
        conversationId,
        text,
        { onDelta: (piece) => patchReply((row) => ({ ...row, content: row.content + piece })) },
        controller.signal,
      );

      if (outcome.kind === "done") {
        const saved = outcome.message;
        patchReply(() => (saved ? toView(saved) : null));
      } else if (outcome.kind === "stopped") {
        patchReply((row) => (row.content ? { ...row, streaming: false, status: "stopped" } : null));
      } else {
        // 실패한 답장은 지우고, 이유를 내 메시지 아래에 붙입니다.
        patchReply(() => null);
        setMessages((rows) =>
          rows.map((row) => (row.key === userKey ? { ...row, error: outcome.detail } : row)),
        );
      }
    } catch (error) {
      // Claude를 부르기 전에 거절됐습니다. 메시지는 저장되지 않았으므로
      // 화면에서도 거두고, 쓴 글은 입력창에 돌려줍니다.
      setMessages((rows) => rows.filter((row) => row.key !== userKey && row.key !== replyKey));
      setDraft(text);
      setSendError(describeError(error));
    } finally {
      abortRef.current = null;
      setStreaming(false);
      void refreshList();
    }
  }, [activeId, draft, mayCreate, refreshList, streaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const saveRename = useCallback(
    async (id: number) => {
      const title = renameDraft.trim();
      setRenamingId(null);
      if (!title) return;
      try {
        const updated = await renameConversation(id, title);
        setConversations((rows) => rows.map((row) => (row.id === id ? updated : row)));
      } catch (error) {
        setListError(describeError(error));
      }
    },
    [renameDraft],
  );

  const askDelete = useCallback(
    (conversation: Conversation) => {
      setConfirmError(null);
      setConfirm({
        title: `"${conversation.title || "새 대화"}" 대화를 지울까요?`,
        effect: [
          "대화 내용이 완전히 지워지고 되살릴 수 없습니다.",
          "이미 쓴 지원금 기록은 Usage에 그대로 남습니다.",
        ],
        confirmLabel: "지우기",
        danger: true,
        onConfirm: async () => {
          setConfirmBusy(true);
          try {
            await deleteConversation(conversation.id);
            setConversations((rows) => rows.filter((row) => row.id !== conversation.id));
            if (activeId === conversation.id) {
              setActiveId(null);
              setMessages([]);
            }
            setConfirm(null);
          } catch (error) {
            setConfirmError(describeError(error));
          } finally {
            setConfirmBusy(false);
          }
        },
      });
    },
    [activeId],
  );

  /** 액션 단추가 들고 갈 아이디어 — 그 답장 바로 앞의 내 메시지. */
  const ideaBefore = (index: number): string => {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") return messages[i].content;
    }
    return "";
  };

  const hint = !mayCreate
    ? "참여 중인 분기가 되면 다시 보낼 수 있습니다. 지난 대화는 그대로 볼 수 있습니다."
    : info?.is_mock
      ? `Enter로 보내고 Shift+Enter로 줄을 바꿉니다. ${TEST_MODE_LABEL}.`
      : "Enter로 보내고 Shift+Enter로 줄을 바꿉니다. 답장마다 동아리 지원(Build)에서 쓴 만큼 차감됩니다.";

  return (
    <div className={styles.layout}>
      <aside className={`${styles.list} ${listOpen ? styles.listOpen : ""}`} aria-label="대화 목록">
        <button className={styles.newChat} type="button" onClick={startNew} disabled={streaming}>
          <Plus size={15} aria-hidden="true" /> 새 대화
        </button>

        {listError !== null && <p className={styles.listNote}>{listError}</p>}
        {listError === null && conversations.length === 0 && (
          <p className={styles.listNote}>아직 대화가 없습니다.</p>
        )}

        {conversations.length > 0 && <p className={`section-label ${styles.listLabel}`}>최근 대화</p>}

        <ul className={styles.listItems}>
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className={`${styles.listItem} ${
                conversation.id === activeId ? styles.listItemActive : ""
              }`}
            >
              {renamingId === conversation.id ? (
                <input
                  className={styles.renameInput}
                  aria-label="대화 이름"
                  value={renameDraft}
                  maxLength={100}
                  autoFocus
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => void saveRename(conversation.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void saveRename(conversation.id);
                    } else if (event.key === "Escape") {
                      setRenamingId(null);
                    }
                  }}
                />
              ) : (
                <button
                  className={styles.listOpenButton}
                  type="button"
                  onClick={() => void openConversation(conversation.id)}
                  disabled={streaming && conversation.id !== activeId}
                  title={conversation.title || "새 대화"}
                >
                  {conversation.title || "새 대화"}
                </button>
              )}
              {mayCreate && renamingId !== conversation.id && (
                <span className={styles.listTools}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="이름 바꾸기"
                    title="이름 바꾸기"
                    disabled={streaming}
                    onClick={() => {
                      setRenameDraft(conversation.title);
                      setRenamingId(conversation.id);
                    }}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                    aria-label="지우기"
                    title="지우기"
                    disabled={streaming}
                    onClick={() => askDelete(conversation)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <div className={styles.chat}>
        <div className={styles.topBar}>
          <button
            type="button"
            className={styles.listToggle}
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
          >
            <ListIcon size={15} aria-hidden="true" /> 대화 목록
          </button>
          {info?.is_mock && <span className="badge badge-mock">{TEST_MODE_LABEL}</span>}
        </div>

        <div className={styles.threadScroll} ref={threadRef} role="log" aria-label="대화 내용">
          <div className={styles.threadInner}>
            {loadingConversation ? (
              <p className={styles.listNote}>대화를 불러오는 중…</p>
            ) : !started ? (
              // 아직 대화가 없을 때만 보이는 안내. 대화가 시작되면 사라집니다.
              <div className={styles.empty}>
                <BrandMark size={52} variant="soft" />
                <h1 className={styles.emptyTitle}>CTRL+AI에 오신 것을 환영합니다</h1>
                <p className={styles.emptyText}>
                  코드를 몰라도 괜찮습니다. 만들고 싶은 것을 한국어로 이야기하면 앱이나 짧은
                  영상으로 만들어 보고, 커뮤니티에 나눌 수 있습니다.
                </p>

                <div className={styles.shortcuts}>
                  {CHAT_SHORTCUTS.map((shortcut) => {
                    const Icon = SHORTCUT_ICON[shortcut.icon];
                    return (
                      <Link
                        className={`${styles.shortcut} ${styles[SHORTCUT_TONE[shortcut.icon]] ?? ""}`}
                        href={shortcut.href}
                        key={shortcut.title}
                      >
                        <span className={styles.shortcutTile} aria-hidden="true">
                          <Icon className={styles.shortcutIcon} />
                        </span>
                        <span className={styles.shortcutTitle}>{shortcut.title}</span>
                        <span className={styles.shortcutDescription}>{shortcut.description}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : (
              <ol className={styles.messages}>
                {messages.map((message, index) => (
                  <li
                    className={`${styles.row} ${
                      message.role === "user" ? styles.rowUser : styles.rowAssistant
                    }`}
                    key={message.key}
                  >
                    <span className={styles.messageRole}>
                      {message.role === "user" ? "나" : "CTRL+AI"}
                    </span>
                    {(message.content || message.streaming) && (
                      <div className={styles.bubble}>
                        {message.content}
                        {message.streaming && (
                          <span className={styles.caret} aria-label="답장을 쓰는 중" />
                        )}
                      </div>
                    )}
                    {!message.streaming && STATUS_NOTE[message.status] && (
                      <p className={styles.statusNote}>{STATUS_NOTE[message.status]}</p>
                    )}
                    {message.action && !message.streaming && (
                      <Link
                        className={styles.suggestion}
                        href={actionHref(message.action, ideaBefore(index), message.actionTitle)}
                      >
                        {ACTION_LABEL[message.action]} <span aria-hidden="true">→</span>
                      </Link>
                    )}
                    {message.error && (
                      <p className={styles.errorNote} role="alert">
                        {message.error}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {/* 입력창은 바닥에 고정됩니다. */}
        <div className={styles.composerArea}>
          <div className={styles.composerInner}>
            <NotParticipatingBanner />
            {sendError !== null && (
              <p className={styles.errorNote} role="alert">
                {sendError}
              </p>
            )}
            <label className="sr-only" htmlFor={inputId}>
              CTRL+AI에게 보낼 메시지
            </label>
            <div className={styles.composer}>
              <textarea
                className={styles.input}
                id={inputId}
                ref={textareaRef}
                rows={1}
                value={draft}
                maxLength={info?.max_message_length}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter로 보내고, Shift+Enter로 줄을 바꿉니다. 한글 입력 중에는
                  // 글자를 조합하는 단계에서 Enter가 눌릴 수 있으므로, 조합이
                  // 끝나지 않았으면(isComposing) 보내지 않습니다.
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  mayCreate ? "만들고 싶은 것을 이야기해 보세요" : "이번 분기에는 보낼 수 없습니다"
                }
                disabled={!mayCreate}
                title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
              />
              {streaming ? (
                <button
                  className={`${styles.send} ${styles.stop}`}
                  type="button"
                  onClick={stop}
                  aria-label="중지"
                  title="중지"
                >
                  <Square size={11} fill="currentColor" aria-hidden="true" />
                </button>
              ) : (
                <button
                  className={styles.send}
                  type="button"
                  onClick={() => void send()}
                  disabled={!mayCreate || !draft.trim()}
                  title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                  aria-label={mayCreate ? "보내기" : "이번 분기에는 보낼 수 없습니다"}
                >
                  {mayCreate ? (
                    <SendHorizontal size={17} aria-hidden="true" />
                  ) : (
                    <Lock size={15} aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
            <p className={styles.hint}>{hint}</p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        busy={confirmBusy}
        error={confirmError}
      />
    </div>
  );
}
