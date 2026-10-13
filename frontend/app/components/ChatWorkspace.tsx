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
 * 입력창 옆에서 **대화마다** 모델을 고릅니다(`ChatModelPicker`). 새 대화는
 * 기본 모델로 시작하고, 바꾸면 다음 답장부터 적용됩니다. 답장마다 그것을
 * 쓴 모델 이름이 작게 붙습니다.
 *
 * 처음에는 환영 인사와 **기능 둘러보기** 카드(`lib/chat-examples.ts`)를
 * 보여 주고, 대화가 한 번이라도 오가면 감춥니다. 카드는 예시 문장을
 * 입력창에 채울 뿐 보내지 않습니다.
 *
 * 답장은 Markdown으로 그립니다(`ChatMarkdown`). 회원이 쓴 글은 쓴 그대로
 * 보여 줍니다.
 *
 * 이번 분기에 참여하지 않는 회원도 지난 대화는 읽을 수 있습니다. 보내기,
 * 새 대화, 이름 바꾸기, 지우기만 막힙니다 — 실제 차단은 백엔드의
 * `require_active_member`가 하고, 여기서는 이유를 설명합니다.
 */

import {
  ChartColumn,
  FileText,
  Globe,
  ListIcon,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  SendHorizontal,
  Square,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  ACTION_LABEL,
  actionHref,
  createConversation,
  currentModel,
  deleteConversation,
  getChatInfo,
  getConversation,
  listConversations,
  modelLabel,
  renameConversation,
  sendMessage,
  setConversationModel,
  type ChatAction,
  type ChatInfo,
  type ChatMessage,
  type ChatMessageStatus,
  runningEstimateKrw,
  type ChatModelOption,
  type Conversation,
  setConversationTool,
  type LongHistory,
  type ReplyReceipt,
  type ReplySource,
  type ToolKind,
  type StreamEstimate,
} from "@/lib/chat";
import { describeError } from "@/lib/http";
import { CHAT_EXAMPLES, type ChatExample } from "@/lib/chat-examples";
import { NOT_PARTICIPATING_HINT, formatKrw } from "@/lib/quarters";

import BrandMark from "./BrandMark";
import ChatMarkdown from "./ChatMarkdown";
import ChatModelPicker from "./ChatModelPicker";
import TestModeNotice from "./TestModeNotice";
import styles from "./ChatWorkspace.module.css";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import { useMayCreate, useMyQuarter } from "./MyQuarterProvider";
import WalletCheck from "./WalletCheck";
import NotParticipatingBanner from "./NotParticipatingBanner";
import Skeleton from "./Skeleton";
import EmptyState from "./EmptyState";

/** 기능 둘러보기 카드의 아이콘과 아이콘 칸의 색. */
const EXAMPLE_ICON: Record<ChatExample["icon"], LucideIcon> = {
  table: Table2,
  file: FileText,
  chart: ChartColumn,
  page: Globe,
};

const EXAMPLE_TONE: Record<ChatExample["icon"], string> = {
  table: "toneAccent",
  file: "toneAccent",
  chart: "toneVideo",
  page: "toneBuild",
};

/** 입력창이 늘어날 수 있는 최대 줄 수. 그보다 길어지면 안에서 스크롤됩니다. */
const MAX_ROWS = 6;

/**
 * 중지되거나 연결이 끊긴 답장의 저장본(영수증 포함)을 다시 읽어 올 때까지
 * 기다리는 간격. 정산이 늦으면 다음 간격으로 다시 시도하고, 다 지나도
 * 없으면(내용 없이 중지) 지갑만 새로 읽습니다.
 */
const SETTLE_DELAYS_MS = [900, 1500, 3000];

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
  /** 답장을 쓴 모델의 ID. 내 메시지와 오고 있는 답장은 null. */
  modelId: string | null;
  /** 1회 비용 한도에 닿아 멈춘 답장이면 그 한도(원). */
  cappedKrw?: number | null;
  /** 답장의 영수증 — 장부의 숫자(live-cost-display). */
  receipt?: ReplyReceipt | null;
  /** 웹 검색이 인용한 출처(chat-plus-tools). */
  sources?: ReplySource[] | null;
  /** 오고 있는 답장 옆의 어림값(원). 끝나면 영수증이 대신합니다. */
  estimateKrw?: number | null;
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
    modelId: message.model_id,
    cappedKrw: message.capped_krw ?? null,
    receipt: message.receipt ?? null,
    sources: message.sources ?? null,
  };
}

/**
 * 영수증 한 줄. 입력은 새로 처리한 토큰(캐시 쓰기 포함), 캐시 읽기는
 * 캐시가 켜져 있던 답장에만 보입니다. 합계는 장부가 차감한 금액 —
 * 어림값이 아닙니다.
 */
export function receiptLine(receipt: ReplyReceipt): string {
  const parts = [
    `입력 ${(receipt.input_tokens + (receipt.cache_write_tokens ?? 0)).toLocaleString()}토큰`,
    `출력 ${receipt.output_tokens.toLocaleString()}토큰`,
  ];
  if (receipt.cache_read_tokens !== null) {
    parts.push(`캐시 읽기 ${receipt.cache_read_tokens.toLocaleString()}토큰`);
  }
  if ((receipt.web_search_count ?? 0) > 0) {
    parts.push(
      `검색 ${receipt.web_search_count}회 ${formatKrw(receipt.tool_fee_krw ?? 0)}`,
    );
  }
  parts.push(`합계 ${formatKrw(receipt.charged_krw)}`);
  return parts.join(" · ");
}

/** 출처 링크에 보여 줄 도메인. 주소가 이상하면 주소 그대로. */
export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 서버 도구 세 가지의 이름과, 돌고 있을 때·켜기 전에 보여 줄 문장. */
export const TOOL_META: Record<
  ToolKind,
  { label: string; running: string; failed: string }
> = {
  web_search: { label: "웹 검색", running: "검색 중…", failed: "검색이 실패했어요. 검색 없이 답을 이어가요." },
  web_fetch: { label: "페이지 읽기", running: "페이지 읽는 중…", failed: "페이지를 읽지 못했어요." },
  code_execution: { label: "코드 실행", running: "코드 실행 중…", failed: "코드 실행이 실패했어요." },
};

/** 도구를 켜기 전에 보여 줄 비용 안내(chat-plus-tools). 페이지 읽기의
 * 한도는 관리자 설정이라(/chat/info) 숫자를 박아 두지 않습니다. */
export function toolCostEffect(
  kind: ToolKind,
  searchKrw: number | null,
  fetchLimits?: { maxUses: number; maxTokens: number } | null,
): string[] {
  if (kind === "web_search") {
    return [
      `검색 1회당 약 ${searchKrw != null ? formatKrw(searchKrw) : "14원"}이 더 들어요 (한 답장에 최대 3회).`,
      "검색 결과 토큰 비용까지 이 답장의 1회 비용 한도 안에서 함께 계산돼요.",
      "검색어가 검색 서비스로 전달돼요.",
    ];
  }
  if (kind === "web_fetch") {
    const uses = fetchLimits?.maxUses ?? 1;
    const tokens = fetchLimits?.maxTokens ?? 10_000;
    return [
      `대화에 있는 주소의 페이지를 읽어요 (한 답장에 최대 ${uses}회, 페이지당 최대 ${tokens.toLocaleString()}토큰).`,
      "읽은 분량의 토큰 비용이 이 답장에 들어요 — 1회 비용 한도가 낮으면 이 도구를 켠 채 보낼 수 없어요.",
    ];
  }
  return [
    "코드는 Anthropic 서버에서만 실행돼요 — CTRL+AI 서버에서는 아무것도 실행되지 않아요.",
    "실행 결과만큼 이 답장의 토큰 비용이 들어요.",
  ];
}

/** 답장 아래에 붙는 한 줄 설명. 끝까지 온 답장에는 없습니다. */
const STATUS_NOTE: Partial<Record<ChatMessageStatus, string>> = {
  stopped: "중지됨 — 여기까지 쓴 만큼만 차감됩니다.",
  truncated: "답장이 길어 여기서 끊겼습니다. \"계속\"이라고 보내면 이어서 씁니다.",
  refused: "이 질문에는 답할 수 없어요. 다른 방식으로 물어봐 주세요.",
};

/** 한도에 닿아 멈춘 답장은 왜 멈췄는지와 잇는 방법을 말합니다(token-guard). */
export function statusNote(message: ViewMessage): string | undefined {
  if (message.status === "truncated" && message.cappedKrw) {
    return (
      `답장이 1회 비용 한도(${formatKrw(message.cappedKrw)})에 닿아 여기서 멈췄어요. ` +
      "이어서 받으려면 '계속해 줘'라고 보내 주세요."
    );
  }
  return STATUS_NOTE[message.status];
}

export default function ChatWorkspace() {
  const mayCreate = useMayCreate();
  // 답장이 끝나면 사이드바의 지갑이 그 자리에서 줄어듭니다 — done
  // 이벤트가 장부의 값을 들고 오면 그대로 쓰고(live-cost-display),
  // 값이 없는 길(중지, 오류)에서만 다시 읽습니다.
  const { refresh: refreshQuarter, applyWalletRemaining } = useMyQuarter();

  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  /**
   * 지금 대화가 쓰는 모델. 아직 만들지 않은 새 대화라면 회원이 고른 값을
   * 여기 들고 있다가 첫 메시지로 대화를 만들 때 함께 보냅니다. null은 기본.
   */
  const [chosenModelId, setChosenModelId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  /** 대화가 길어졌을 때 입력창 위에 보이는 안내(token-guard). */
  const [longHistory, setLongHistory] = useState<LongHistory | null>(null);
  /** 이 대화의 도구 토글(chat-plus-tools). 새 대화에는 아직 없습니다. */
  const [toolFlags, setToolFlags] = useState<Record<ToolKind, boolean>>({
    web_search: false,
    web_fetch: false,
    code_execution: false,
  });
  /** 지금 돌고 있는 서버 도구 — "검색 중…" 줄. */
  const [toolStatus, setToolStatus] = useState<{ kind: ToolKind; status: string } | null>(null);
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
  // 중지된 답장의 영수증을 뒤늦게 채울 때, 그 사이에 다른 대화로
  // 옮겨 갔으면 덮어쓰지 않도록 지금 열려 있는 대화를 기억합니다.
  const activeIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

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

  // 새 메시지나 조각이 오면 맨 아래로 내립니다. 아직 대화가 없으면
  // 내리지 않습니다 — 좁은 화면에서는 환영 안내가 길어, 내리면 제목이
  // 화면 위로 밀려 올라간 채 열립니다.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread && messages.length > 0) thread.scrollTop = thread.scrollHeight;
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
      setChosenModelId(detail.chat_model_id);
      setLongHistory(detail.long_history ?? null);
      setToolFlags({
        web_search: detail.use_web_search ?? false,
        web_fetch: detail.use_web_fetch ?? false,
        code_execution: detail.use_code_execution ?? false,
      });
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
    setChosenModelId(null);
    setSendError(null);
    setLongHistory(null);
    setToolFlags({ web_search: false, web_fetch: false, code_execution: false });
    textareaRef.current?.focus();
  }, []);

  /**
   * 모델 바꾸기. 이미 있는 대화면 바로 저장하고, 새 대화면 첫 메시지 때
   * 함께 보냅니다. 어느 쪽이든 지난 답장은 그대로입니다.
   */
  const chooseModel = useCallback(
    async (model: ChatModelOption) => {
      setSendError(null);
      if (activeId === null) {
        setChosenModelId(model.id);
        return;
      }
      try {
        const updated = await setConversationModel(activeId, model.id);
        setChosenModelId(updated.chat_model_id);
        setConversations((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      } catch (error) {
        setSendError(describeError(error));
      }
    },
    [activeId],
  );

  /**
   * 기능 둘러보기 카드: 예시 문장을 입력창에 채우고 커서를 끝에 둡니다.
   * 보내지는 않습니다 — 회원이 모델과 예상 비용을 보고 직접 보냅니다.
   * 이미 직접 쓴 글이 있으면 지우지 않고 그 아래에 덧붙입니다. 끝에 붙은
   * 것이 다른 예시뿐이면 그 예시만 바꿔 넣습니다.
   */
  const fillExample = useCallback((example: ChatExample) => {
    setDraft((current) => {
      let typed = current.trimEnd();
      const previous = CHAT_EXAMPLES.find((other) => typed.endsWith(other.prompt.trimEnd()));
      if (previous) typed = typed.slice(0, typed.length - previous.prompt.trimEnd().length).trimEnd();
      return typed ? `${typed}\n\n${example.prompt}` : example.prompt;
    });
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }, []);

  /**
   * 중지되거나 연결이 끊긴 답장의 저장본을 뒤늦게 채웁니다.
   *
   * done 이벤트가 오지 않았으니 영수증도, 정확한 저장본도 화면에 없습니다.
   * 백엔드의 정산이 끝나면 대화에 내 메시지(`savedUserId`) **다음의**
   * 답장이 생기므로 그것을 찾아 **그 말풍선 한 줄만** 바꿉니다 — 전체를
   * 갈아끼우면 그 사이에 같은 대화에서 새로 보낸 말풍선이 지워집니다.
   * 정산이 늦으면 다음 간격으로 다시 시도하고, 저장된 답장이 끝내 없으면
   * (내용 없이 중지) 지갑만 새로 읽습니다. 다른 대화로 옮겨 갔으면
   * 화면은 건드리지 않되 지갑은 맞춰 둡니다.
   */
  const settleStopped = useCallback(
    function settle(
      conversationId: number,
      replyKey: string,
      savedUserId: number | null,
      attempt: number,
    ) {
      window.setTimeout(() => {
        if (activeIdRef.current !== conversationId) {
          void refreshQuarter();
          return;
        }
        getConversation(conversationId)
          .then((detail) => {
            if (activeIdRef.current !== conversationId) {
              void refreshQuarter();
              return;
            }
            const settled =
              savedUserId === null
                ? undefined
                : detail.messages.find(
                    (message) => message.role === "assistant" && message.id > savedUserId,
                  );
            if (settled) {
              setMessages((rows) =>
                rows.map((row) => (row.key === replyKey ? toView(settled) : row)),
              );
              setLongHistory(detail.long_history ?? null);
              void refreshQuarter();
            } else if (attempt + 1 < SETTLE_DELAYS_MS.length) {
              settle(conversationId, replyKey, savedUserId, attempt + 1);
            } else {
              void refreshQuarter();
            }
          })
          .catch(() => {
            // 영수증이 늦는 것뿐 — 다음에 열면 보입니다. 지갑은 맞춰 둡니다.
            void refreshQuarter();
          });
      }, SETTLE_DELAYS_MS[attempt]);
    },
    [refreshQuarter],
  );

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
        const created = await createConversation(chosenModelId);
        conversationId = created.id;
        setActiveId(created.id);
        setChosenModelId(created.chat_model_id);
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
      {
        key: userKey,
        role: "user",
        content: text,
        status: "complete",
        action: null,
        actionTitle: "",
        modelId: null,
      },
      {
        key: replyKey,
        role: "assistant",
        content: "",
        status: "complete",
        action: null,
        actionTitle: "",
        modelId: null,
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

    // 흐르는 답장 옆의 "약 N원"(live-cost-display): start 이벤트의 두
    // 값으로, 흘러온 글자 수만큼 더해 가며 어림합니다. 화면을 조각마다
    // 다시 그리지 않도록 몇 번에 한 번만 반영합니다.
    let estimate: StreamEstimate | null = null;
    let streamedChars = 0;
    let toolKrw = 0; // 끝난 도구 사용이 더한 비용 — 약 N원이 그만큼 뜁니다.
    let lastPaintAt = 0;
    // 저장된 내 메시지의 id — 중지/끊김 뒤 저장된 답장을 찾는 기준.
    let savedUserId: number | null = null;
    const paintEstimate = () => {
      if (estimate === null) return;
      const krw = runningEstimateKrw(estimate, streamedChars) + toolKrw;
      patchReply((row) => (row.estimateKrw === krw ? row : { ...row, estimateKrw: krw }));
    };

    try {
      const outcome = await sendMessage(
        conversationId,
        text,
        {
          onStart: (saved, startEstimate) => {
            savedUserId = saved.id;
            estimate = startEstimate;
            paintEstimate();
          },
          onDelta: (piece) => {
            streamedChars += piece.length;
            patchReply((row) => ({ ...row, content: row.content + piece }));
            const now = Date.now();
            if (now - lastPaintAt >= 300) {
              lastPaintAt = now;
              paintEstimate();
            }
          },
          onTool: (kind, status, addedKrw) => {
            // "검색 중…" 줄. 끝나면 지우고, 실패하면 실패했다고 남깁니다.
            setToolStatus(status === "done" ? null : { kind, status });
            if (addedKrw) {
              toolKrw += addedKrw;
              paintEstimate();
            }
          },
        },
        controller.signal,
      );

      if (outcome.kind === "done") {
        const saved = outcome.message;
        // 영수증은 장부의 숫자(done 이벤트)로 그 자리에서 채웁니다.
        const receipt: ReplyReceipt | null =
          saved && outcome.usage ? { ...outcome.usage, charged_krw: outcome.chargedKrw } : null;
        patchReply(() => (saved ? { ...toView(saved), receipt: receipt ?? saved.receipt ?? null } : null));
        setLongHistory(outcome.longHistory ?? null);
        // 들고 온 잔액이 있으면 그 자리에서 반영하고, 반영할 곳이 없거나
        // (아직 불러오는 중) 잔액이 없으면 새로 읽습니다.
        if (
          outcome.walletRemainingKrw == null ||
          !applyWalletRemaining(outcome.walletRemainingKrw)
        ) {
          void refreshQuarter();
        }
      } else if (outcome.kind === "stopped" || outcome.kind === "disconnected") {
        // 중지했거나 연결이 끊겼습니다 — 어느 쪽이든 백엔드는 그때까지
        // 만든 답장을 저장하고 쓴 만큼 차감하므로, 차감이 없었다고
        // 말하면 안 됩니다. 저장본과 영수증은 정산이 끝난 뒤 가져옵니다.
        patchReply((row) => (row.content ? { ...row, streaming: false, status: "stopped" } : null));
        if (outcome.kind === "disconnected") {
          setSendError(
            `${outcome.detail} 여기까지 온 답장은 저장되고, 쓴 만큼만 차감됩니다.`,
          );
        }
        settleStopped(conversationId, replyKey, savedUserId, 0);
      } else {
        // 백엔드가 보낸 실패 — 이때만 아무것도 차감되지 않은 것이
        // 확실합니다. 실패한 답장은 지우고, 이유를 내 메시지 아래에 붙입니다.
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
      setToolStatus(null);
      void refreshList();
    }
  }, [
    activeId,
    applyWalletRemaining,
    chosenModelId,
    draft,
    mayCreate,
    refreshList,
    refreshQuarter,
    settleStopped,
    streaming,
  ]);

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
              setChosenModelId(null);
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

  const selectedModel = currentModel(info, chosenModelId);

  /**
   * 도구 토글(chat-plus-tools). 켤 때는 비용을 먼저 보여 주고, 끌 때는
   * 바로 끕니다. 토글은 대화의 것이라 — 도구 목록이 바뀌면 프롬프트
   * 캐시가 깨집니다 — 첫 메시지를 보낸 뒤부터 보입니다.
   */
  const toggleTool = useCallback(
    (kind: ToolKind) => {
      if (activeId === null || streaming) return;
      const next = !toolFlags[kind];
      const apply = async () => {
        const updated = await setConversationTool(activeId, kind, next);
        setToolFlags({
          web_search: updated.use_web_search ?? false,
          web_fetch: updated.use_web_fetch ?? false,
          code_execution: updated.use_code_execution ?? false,
        });
      };
      if (!next) {
        void apply().catch((error: unknown) => setSendError(describeError(error)));
        return;
      }
      setConfirmError(null);
      setConfirm({
        title: `${TOOL_META[kind].label} 도구를 켤까요?`,
        effect: toolCostEffect(
          kind,
          selectedModel?.web_search_krw_per_call ?? null,
          info
            ? { maxUses: info.web_fetch_max_uses, maxTokens: info.web_fetch_max_content_tokens }
            : null,
        ),
        confirmLabel: "켜기",
        onConfirm: async () => {
          setConfirmBusy(true);
          try {
            await apply();
            setConfirm(null);
          } catch (error) {
            setConfirmError(describeError(error));
          } finally {
            setConfirmBusy(false);
          }
        },
      });
    },
    [activeId, streaming, toolFlags, selectedModel, info],
  );

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
          <EmptyState
            compact
            icon={MessageSquare}
            title="아직 대화가 없어요"
            text="입력창에 궁금한 것을 적으면 첫 대화가 여기에 생겨요."
            action={{ label: "새 대화 시작", onClick: startNew, disabled: streaming }}
          />
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
              <Skeleton quiet label="대화를 불러오는 중…" />
            ) : !started ? (
              // 아직 대화가 없을 때만 보이는 안내. 대화가 시작되면 사라집니다.
              <div className={styles.empty}>
                <BrandMark size={52} variant="soft" />
                <h1 className={styles.emptyTitle}>CTRL+AI에 오신 것을 환영합니다</h1>
                <p className={styles.emptyText}>
                  코드를 몰라도 괜찮습니다. 만들고 싶은 것을 한국어로 이야기하면 앱이나 짧은
                  영상으로 만들어 보고, 커뮤니티에 나눌 수 있습니다.
                </p>

                <h2 className={styles.examplesTitle}>기능 둘러보기</h2>
                <p className={styles.examplesHint}>
                  카드를 누르면 예시 문장이 입력창에 들어갑니다. 그대로 보내거나 고쳐서 보내
                  보세요.
                </p>
                <div className={styles.shortcuts}>
                  {CHAT_EXAMPLES.map((example) => {
                    const Icon = EXAMPLE_ICON[example.icon];
                    return (
                      <button
                        type="button"
                        className={`${styles.shortcut} ${styles[EXAMPLE_TONE[example.icon]] ?? ""}`}
                        key={example.title}
                        onClick={() => fillExample(example)}
                        disabled={!mayCreate}
                        title={mayCreate ? undefined : NOT_PARTICIPATING_HINT}
                      >
                        <span className={styles.shortcutTile} aria-hidden="true">
                          <Icon className={styles.shortcutIcon} />
                        </span>
                        <span className={styles.shortcutTitle}>{example.title}</span>
                        <span className={styles.shortcutDescription}>{example.description}</span>
                      </button>
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
                        {message.role === "assistant" && message.content ? (
                          <ChatMarkdown
                            text={message.content}
                            streaming={message.streaming}
                            tail={
                              message.streaming ? (
                                <span className={styles.caret} aria-label="답장을 쓰는 중" />
                              ) : undefined
                            }
                          />
                        ) : (
                          message.content
                        )}
                        {message.streaming && !message.content && (
                          // 첫 글자가 오기 전: 세 점이 차례로 뛰는 "쓰는 중"(ui-friendly-motion).
                          <span className={styles.typing}>
                            <span aria-hidden="true" />
                            <span aria-hidden="true" />
                            <span aria-hidden="true" />
                            <span className="sr-only">답장을 쓰는 중</span>
                          </span>
                        )}
                      </div>
                    )}
                    {message.streaming && toolStatus !== null && (
                      // 서버 도구가 돌고 있습니다 — 검색 중… / 페이지
                      // 읽는 중… / 코드 실행 중… (chat-plus-tools).
                      <p className={styles.toolStatus} data-testid="tool-status" role="status">
                        {toolStatus.status === "error"
                          ? TOOL_META[toolStatus.kind].failed
                          : TOOL_META[toolStatus.kind].running}
                      </p>
                    )}
                    {message.streaming && message.estimateKrw != null && (
                      // 흐르는 동안의 어림값. 반드시 약을 붙입니다 —
                      // 정산은 끝난 뒤의 영수증(장부)이 합니다.
                      <p className={styles.liveCost} data-testid="live-cost" aria-live="off">
                        약 {formatKrw(message.estimateKrw)}
                      </p>
                    )}
                    {message.role === "assistant" &&
                      !message.streaming &&
                      (message.sources?.length ?? 0) > 0 && (
                        <ol className={styles.sources} data-testid="sources">
                          {message.sources!.map((source, order) => (
                            <li key={`${order}-${source.url}`}>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={source.title || source.url}
                              >
                                {order + 1}. {sourceDomain(source.url)}
                              </a>
                            </li>
                          ))}
                        </ol>
                      )}
                    {message.role === "assistant" && !message.streaming && message.receipt && (
                      <p className={styles.receipt} data-testid="receipt">
                        {receiptLine(message.receipt)}
                      </p>
                    )}
                    {message.role === "assistant" &&
                      !message.streaming &&
                      modelLabel(info, message.modelId) && (
                        <p className={styles.modelNote}>{modelLabel(info, message.modelId)}</p>
                      )}
                    {!message.streaming && statusNote(message) && (
                      <p className={styles.statusNote}>{statusNote(message)}</p>
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
                      <>
                        <p className={styles.errorNote} role="alert">
                          {message.error}
                        </p>
                        <p className={styles.statusNote} data-testid="not-charged">
                          이 시도는 청구되지 않았어요.
                        </p>
                      </>
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
            {/* 배포된 사이트에서 Claude가 아직 목업이면 — 답이 진짜 AI의
                것이 아니라고 입력창 바로 위에서 말합니다. */}
            <TestModeNotice area="chat" />
            {sendError !== null && (
              <p className={styles.errorNote} role="alert">
                {sendError}
              </p>
            )}
            {longHistory !== null && (
              <p className={styles.longHistoryNote} data-testid="long-history">
                대화가 길어져 답장마다 약 {formatKrw(longHistory.extra_krw)}이 더 들어요. 새
                대화로 시작하면 그만큼 아낄 수 있어요.{" "}
                <button
                  className={styles.longHistoryNew}
                  type="button"
                  onClick={startNew}
                  disabled={streaming}
                >
                  새 대화 시작
                </button>
              </p>
            )}
            {info && info.models.length > 0 && (
              <div className={styles.composerTools}>
                <ChatModelPicker
                  models={info.models}
                  current={selectedModel}
                  onChange={(model) => void chooseModel(model)}
                  disabled={!mayCreate || streaming}
                />
                {activeId !== null &&
                  selectedModel &&
                  (selectedModel.tools_web_search ||
                    selectedModel.tools_web_fetch ||
                    selectedModel.tools_code_execution) && (
                    <div className={styles.toolChips} data-testid="tool-chips">
                      {(["web_search", "web_fetch", "code_execution"] as ToolKind[]).map(
                        (kind) => {
                          const allowed =
                            kind === "web_search"
                              ? selectedModel.tools_web_search
                              : kind === "web_fetch"
                                ? selectedModel.tools_web_fetch
                                : selectedModel.tools_code_execution;
                          if (!allowed) return null;
                          const on = toolFlags[kind];
                          return (
                            <button
                              key={kind}
                              type="button"
                              className={`${styles.toolChip} ${on ? styles.toolChipOn : ""}`}
                              aria-pressed={on}
                              disabled={streaming || !mayCreate}
                              title={on ? undefined : "켜면 답장마다 추가 비용이 들 수 있어요"}
                              onClick={() => toggleTool(kind)}
                            >
                              {TOOL_META[kind].label}
                            </button>
                          );
                        },
                      )}
                    </div>
                  )}
                {mayCreate && (
                  <WalletCheck costKrw={selectedModel?.estimated_reply_krw ?? null} />
                )}
              </div>
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
