/**
 * Chat 화면과 스트림 읽기.
 *
 * 백엔드는 부르지 않습니다. 스트림 읽기(`sendMessage`)는 가짜 `fetch`가
 * 돌려주는 SSE 본문으로, 화면은 `lib/chat`을 바꿔 끼워 확인합니다.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { ChatMessage, StreamHandlers, StreamOutcome } from "@/lib/chat";

// ------------------------------------------------------------ 스트림 읽기

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

const SAVED_REPLY: ChatMessage = {
  id: 9,
  role: "assistant",
  content: "안녕하세요!",
  status: "complete",
  action: null,
  action_title: "",
  model_id: "claude-sonnet-5-5",
  created_at: "2026-10-07T00:00:00Z",
};

describe("sendMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reads events even when a chunk ends mid-event", async () => {
    const { sendMessage } = await vi.importActual<typeof import("@/lib/chat")>("@/lib/chat");
    const done = JSON.stringify({ message: SAVED_REPLY, charged_krw: 3 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'event: start\ndata: {"user_message": {"id": 1}}\n\nevent: del',
          'ta\ndata: {"text": "안녕"}\n\nevent: delta\ndata: {"text": "하세요!"}\n\n',
          `event: done\ndata: ${done}\n\n`,
        ]),
      ),
    );

    const pieces: string[] = [];
    const outcome = await sendMessage(
      1,
      "안녕",
      { onDelta: (text) => pieces.push(text) },
      new AbortController().signal,
    );

    expect(pieces.join("")).toBe("안녕하세요!");
    expect(outcome).toEqual({
      kind: "done",
      message: SAVED_REPLY,
      chargedKrw: 3,
      longHistory: null,
      // live-cost-display: 옛 이벤트에는 없던 칸 — 없으면 null로 읽습니다.
      usage: null,
      walletRemainingKrw: null,
    });
  });

  test("an error event is a result, not a throw", async () => {
    const { sendMessage } = await vi.importActual<typeof import("@/lib/chat")>("@/lib/chat");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'event: error\ndata: {"detail": "Claude가 제시간에 답하지 않았습니다.", "kind": "timeout"}\n\n',
        ]),
      ),
    );

    const outcome = await sendMessage(1, "안녕", {}, new AbortController().signal);
    expect(outcome).toEqual({ kind: "error", detail: "Claude가 제시간에 답하지 않았습니다." });
  });

  test("a refusal before the stream throws the backend's Korean message", async () => {
    const { sendMessage } = await vi.importActual<typeof import("@/lib/chat")>("@/lib/chat");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "이번 분기 지원금이 부족합니다." }), { status: 402 }),
      ),
    );

    await expect(sendMessage(1, "안녕", {}, new AbortController().signal)).rejects.toMatchObject({
      message: "이번 분기 지원금이 부족합니다.",
      status: 402,
    });
  });

  test("splitPinned: 고정됨 first, newest pin first, the rest in the server's order (chat-pins)", async () => {
    const { splitPinned } = await vi.importActual<typeof import("@/lib/chat")>("@/lib/chat");
    const base = { title: "", created_at: "2026-10-01T00:00:00Z", last_message_at: "2026-10-01T00:00:00Z", chat_model_id: null };
    const rows = [
      { ...base, id: 1, pinned_at: null },
      { ...base, id: 2, pinned_at: "2026-10-16T01:00:00Z" },
      { ...base, id: 3 },
      { ...base, id: 4, pinned_at: "2026-10-16T02:00:00Z" },
    ];
    const { pinned, rest } = splitPinned(rows);
    expect(pinned.map((row) => row.id)).toEqual([4, 2]);
    expect(rest.map((row) => row.id)).toEqual([1, 3]);
  });

  test("the action link carries the idea and the suggested name", async () => {
    const { actionHref } = await vi.importActual<typeof import("@/lib/chat")>("@/lib/chat");
    expect(actionHref("builder", "가계부 앱 만들고 싶어요", "가계부")).toBe(
      "/builder?idea=%EA%B0%80%EA%B3%84%EB%B6%80+%EC%95%B1+%EB%A7%8C%EB%93%A4%EA%B3%A0+%EC%8B%B6%EC%96%B4%EC%9A%94&name=%EA%B0%80%EA%B3%84%EB%B6%80",
    );
    expect(actionHref("video", "야경", "")).toBe("/video?idea=%EC%95%BC%EA%B2%BD");
  });
});

// ------------------------------------------------------------ 화면

const chatApi = {
  getChatInfo: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  setConversationModel: vi.fn(),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  setConversationPinned: vi.fn(),
  sendMessage: vi.fn(),
  stopReply: vi.fn(),
  followReply: vi.fn(),
};

vi.mock("@/lib/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat")>();
  return {
    ...actual,
    getChatInfo: (...args: unknown[]) => chatApi.getChatInfo(...args),
    listConversations: (...args: unknown[]) => chatApi.listConversations(...args),
    getConversation: (...args: unknown[]) => chatApi.getConversation(...args),
    createConversation: (...args: unknown[]) => chatApi.createConversation(...args),
    setConversationModel: (...args: unknown[]) => chatApi.setConversationModel(...args),
    renameConversation: (...args: unknown[]) => chatApi.renameConversation(...args),
    deleteConversation: (...args: unknown[]) => chatApi.deleteConversation(...args),
    setConversationPinned: (...args: unknown[]) => chatApi.setConversationPinned(...args),
    sendMessage: (...args: unknown[]) => chatApi.sendMessage(...args),
    stopReply: (...args: unknown[]) => chatApi.stopReply(...args),
    followReply: (...args: unknown[]) => chatApi.followReply(...args),
  };
});

let mayCreate = true;
vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => mayCreate,
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/NotParticipatingBanner", () => ({ default: () => null }));

const CONVERSATION = {
  id: 5,
  title: "가계부 아이디어",
  created_at: "2026-10-07T00:00:00Z",
  last_message_at: "2026-10-07T00:00:00Z",
  chat_model_id: 2,
};

const HAIKU = {
  id: 1,
  model_id: "claude-haiku-4-5",
  label: "빠른 답변 (Haiku 4.5)",
  description: "가장 빠르고 저렴합니다.",
  admin_only: false,
  is_default: false,
  estimated_reply_krw: 10,
};
const SONNET = {
  id: 2,
  model_id: "claude-sonnet-5-5",
  label: "균형 잡힌 답변 (Sonnet 5.5)",
  description: "대부분의 대화에 알맞습니다.",
  admin_only: false,
  is_default: true,
  estimated_reply_krw: 20,
};

async function renderChat() {
  const { default: ChatWorkspace } = await import("@/app/components/ChatWorkspace");
  const result = render(<ChatWorkspace />);
  await waitFor(() => expect(chatApi.listConversations).toHaveBeenCalled());
  return result;
}

function typeAndSend(text: string) {
  const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("ChatWorkspace", () => {
  beforeEach(() => {
    mayCreate = true;
    window.localStorage.removeItem("ctrlai.chat-list-collapsed");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    for (const fn of Object.values(chatApi)) fn.mockReset();
    chatApi.getChatInfo.mockResolvedValue({
      is_mock: true,
      rate_limit_per_minute: 10,
      max_message_length: 8000,
      web_fetch_max_uses: 1,
      web_fetch_max_content_tokens: 10_000,
      models: [HAIKU, SONNET],
      default_model_id: SONNET.id,
    });
    chatApi.listConversations.mockResolvedValue([]);
    chatApi.createConversation.mockResolvedValue(CONVERSATION);
  });

  test("a reply streams into its bubble and offers the Builder button", async () => {
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _text: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("좋은 아이디어");
        handlers.onDelta?.("예요!");
        return {
          kind: "done",
          chargedKrw: 2,
          message: {
            ...SAVED_REPLY,
            content: "좋은 아이디어예요!",
            action: "builder",
            action_title: "가계부",
          },
        };
      },
    );
    await renderChat();

    typeAndSend("가계부 앱을 만들고 싶어요");

    expect(await screen.findByText("좋은 아이디어예요!")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Project Builder에서 예시 앱 만들기/ });
    expect(link.getAttribute("href")).toContain("/builder?idea=");
    expect(link.getAttribute("href")).toContain("name=%EA%B0%80%EA%B3%84%EB%B6%80");
    expect(chatApi.createConversation).toHaveBeenCalledTimes(1);
  });

  test("before the first words: '생각하는 중…' with the seconds beside it (owner-polish 14)", async () => {
    let finish!: (outcome: StreamOutcome) => void;
    chatApi.sendMessage.mockImplementation(
      (): Promise<StreamOutcome> =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderChat();

    typeAndSend("안녕");

    const waiting = await screen.findByTestId("waiting-live");
    expect(waiting.textContent).toContain("생각하는 중…");
    expect(screen.getByTestId("working-since").textContent).toMatch(/^\d+초$/);

    finish({ kind: "done", chargedKrw: 1, message: { ...SAVED_REPLY, content: "안녕하세요!" } });
    expect(await screen.findByText("안녕하세요!")).toBeTruthy();
    expect(screen.queryByTestId("waiting-live")).toBeNull();
  });

  test("a reply the server continues by itself: '이어서 쓰는 중… 지금까지 N원', then one bubble with the count (feat-auto-continue)", async () => {
    let finish!: (outcome: StreamOutcome) => void;
    chatApi.sendMessage.mockImplementation(
      (_id: number, _text: string, handlers: StreamHandlers): Promise<StreamOutcome> =>
        new Promise((resolve) => {
          handlers.onStart?.({ ...SAVED_REPLY, id: 41, role: "user", content: "길게" }, { base_krw: 3, won_per_1k_output: 20 });
          handlers.onDelta?.("앞부분 ");
          handlers.onContinue?.(2, 57, { base_krw: 5, won_per_1k_output: 20 });
          handlers.onDelta?.("뒷부분");
          finish = resolve;
        }),
    );
    await renderChat();

    typeAndSend("길게 써 줘");

    const line = await screen.findByTestId("continuing");
    expect(line.textContent).toContain("이어서 쓰는 중… (2번째)");
    expect(line.textContent).toContain("지금까지 57원");
    // The running estimate restarts from what was charged so far.
    expect(screen.getByTestId("live-cost").textContent).toMatch(/약 6\d원/);
    // 중지 stays available while the server continues.
    expect(screen.getByRole("button", { name: "중지" })).toBeTruthy();

    finish({
      kind: "done",
      chargedKrw: 91,
      segments: 3,
      message: { ...SAVED_REPLY, content: "앞부분 뒷부분", segments: 3 },
    });
    expect(await screen.findByText("앞부분 뒷부분")).toBeTruthy();
    expect(screen.queryByTestId("continuing")).toBeNull();
    expect(screen.getByTestId("reply-model").textContent).toContain("3번에 나눠 씀");
    expect(screen.queryByTestId("continue-reply")).toBeNull();
  });

  test("a reply the server stopped continuing says why and offers 이어서 쓰기", async () => {
    chatApi.sendMessage.mockResolvedValue({
      kind: "done",
      chargedKrw: 30,
      segments: 1,
      stopNote: "답장이 전체 비용 한도(30원)에 닿아 여기서 멈췄어요. '이어서 쓰기'로 이어 받을 수 있어요.",
      message: { ...SAVED_REPLY, content: "여기까지", status: "truncated", capped_krw: 30 },
    });
    await renderChat();

    typeAndSend("길게 써 줘");

    expect(await screen.findByText("여기까지")).toBeTruthy();
    expect(screen.getByText(/전체 비용 한도\(30원\)에 닿아/)).toBeTruthy();
    expect(screen.getByTestId("continue-reply")).toBeTruthy();
  });

  test("a failed reply shows the Korean reason under the message", async () => {
    chatApi.sendMessage.mockResolvedValue({
      kind: "error",
      detail: "동아리의 Claude 크레딧이 바닥나 지금은 답할 수 없습니다.",
    });
    await renderChat();

    typeAndSend("안녕하세요");

    expect((await screen.findByRole("alert")).textContent).toContain("크레딧이 바닥나");
    expect(screen.getByText("안녕하세요")).toBeTruthy();
  });

  test("a refusal before the stream gives the text back to the input", async () => {
    chatApi.sendMessage.mockRejectedValue(new ApiError("이번 분기 지원금이 부족합니다.", 402));
    await renderChat();

    typeAndSend("비싼 질문");

    expect((await screen.findByRole("alert")).textContent).toContain("지원금이 부족");
    const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지") as HTMLTextAreaElement;
    expect(box.value).toBe("비싼 질문");
  });

  test("중지 asks the server to stop (any tab) and keeps reading until it is saved as 중지됨", async () => {
    // background-runs: leaving no longer stops a reply, so 중지 is a request
    // to the server; the stream then ends with the saved, stopped reply.
    let signal: AbortSignal | null = null;
    let finish: (outcome: StreamOutcome) => void = () => {};
    chatApi.sendMessage.mockImplementation(
      (_id: number, _text: string, handlers: StreamHandlers, sig: AbortSignal) =>
        new Promise<StreamOutcome>((resolve) => {
          signal = sig;
          finish = resolve;
          handlers.onDelta?.("쓰는 중인 답");
        }),
    );
    chatApi.stopReply.mockImplementation(async () => {
      finish({
        kind: "done",
        message: { ...SAVED_REPLY, id: 31, content: "쓰는 중인 답", status: "stopped" },
        chargedKrw: 4,
      });
      return true;
    });
    await renderChat();

    typeAndSend("길게 설명해 주세요");
    const stop = await screen.findByRole("button", { name: "중지" });
    await act(async () => {
      fireEvent.click(stop);
    });

    expect(chatApi.stopReply).toHaveBeenCalledWith(CONVERSATION.id);
    expect(signal!.aborted).toBe(false);
    expect(await screen.findByText(/중지됨/)).toBeTruthy();
    expect(screen.getByText("쓰는 중인 답")).toBeTruthy();
  });

  test("leaving for another conversation lets the reply go on; coming back follows it", async () => {
    let signal: AbortSignal | null = null;
    chatApi.sendMessage.mockImplementation(
      (_id: number, _text: string, handlers: StreamHandlers, sig: AbortSignal) =>
        new Promise<StreamOutcome>((resolve) => {
          signal = sig;
          handlers.onDelta?.("첫 대화의 답");
          sig.addEventListener("abort", () => resolve({ kind: "stopped" }));
        }),
    );
    const OTHER = { ...CONVERSATION, id: 6, title: "다른 대화" };
    chatApi.listConversations.mockResolvedValue([CONVERSATION, OTHER]);
    let opened = 0;
    chatApi.getConversation.mockImplementation(async (id: number) => {
      if (id === OTHER.id) return { ...OTHER, messages: [] };
      opened += 1;
      return {
        ...CONVERSATION,
        messages: [{ ...SAVED_REPLY, role: "user", id: 1, content: "길게 설명해 주세요" }],
        // The second time it is opened, the reply sent meanwhile is still being written.
        running:
          opened > 1
            ? { run_id: 3, text: "첫 대화의 답 이어서", thinking: "", started_at: "2026-10-17T00:00:00Z" }
            : null,
      };
    });
    let followed: (outcome: unknown) => void = () => {};
    chatApi.followReply.mockImplementation(
      (_id: number, handlers: { onDelta?: (text: string) => void }) =>
        new Promise((resolve) => {
          handlers.onDelta?.(" 끝");
          followed = resolve;
        }),
    );
    await renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "가계부 아이디어" }));
    await screen.findByText("길게 설명해 주세요");
    typeAndSend("또 질문");
    await screen.findByText("첫 대화의 답");

    // Another conversation while the reply streams: allowed, nothing is stopped.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다른 대화" }));
    });
    expect(signal!.aborted).toBe(true);
    expect(chatApi.stopReply).not.toHaveBeenCalled();
    expect(screen.queryByText(/중지됨/)).toBeNull();

    // Back: the reply is still being written — shown with the text so far, followed.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "가계부 아이디어" }));
    });
    expect(await screen.findByText("첫 대화의 답 이어서 끝")).toBeTruthy();
    expect(chatApi.followReply).toHaveBeenCalledWith(CONVERSATION.id, expect.anything(), expect.anything());
    // It ends: the conversation is read again for the saved reply and its receipt.
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      messages: [
        { ...SAVED_REPLY, role: "user", id: 1, content: "길게 설명해 주세요" },
        { ...SAVED_REPLY, id: 40, content: "다 쓴 답이에요" },
      ],
    });
    await act(async () => {
      followed({ kind: "done", messageId: 40 });
    });
    expect(await screen.findByText("다 쓴 답이에요")).toBeTruthy();
  });

  test("Enter while composing Korean does not send", async () => {
    await renderChat();
    const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지");
    fireEvent.change(box, { target: { value: "안녕" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(chatApi.sendMessage).not.toHaveBeenCalled();
  });

  test("test mode is labelled when Claude is the mock", async () => {
    await renderChat();
    expect(await screen.findByText("테스트 모드 – 실제 AI 결과가 아닙니다")).toBeTruthy();
  });

  test("a member not participating can open old conversations but not change them", async () => {
    mayCreate = false;
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      messages: [{ ...SAVED_REPLY, role: "user", id: 1, content: "지난 질문" }],
    });
    await renderChat();

    fireEvent.click(await screen.findByRole("button", { name: "가계부 아이디어" }));

    expect(await screen.findByText("지난 질문")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "지우기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "이름 바꾸기" })).toBeNull();
    // chat-pins: the ⋯ menu stays — pinning is a reading preference; the
    // two changes are disabled with the hint.
    fireEvent.click(screen.getByRole("button", { name: "더보기" }));
    expect((screen.getByRole("menuitem", { name: /이름 바꾸기/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("menuitem", { name: /지우기/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("menuitem", { name: "맨 위에 고정" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(
      (screen.getByLabelText("CTRL+AI에게 보낼 메시지") as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });

  test("the picker starts on the default model and shows its estimated cost", async () => {
    await renderChat();
    const trigger = await screen.findByRole("button", { name: /답장 방식: 균형 잡힌 답변/ });
    expect(trigger.textContent).toContain("균형 잡힌 답변");

    fireEvent.click(trigger);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("가장 빠르고 저렴합니다.");
    expect(options[0].textContent).toContain("1회 약 10원");
    // 깊이 조절이 없는 모델(이 목록의 두 모델)은 막대 대신 한 줄로 말합니다.
    expect(screen.getByTestId("no-depth").textContent).toContain("깊이 조절이 없어요");
    expect(screen.getByTestId("depth-price").textContent).toContain("1회 약 20원");
  });

  test("a model chosen before the first message creates the conversation with it", async () => {
    chatApi.createConversation.mockResolvedValue({ ...CONVERSATION, chat_model_id: HAIKU.id });
    chatApi.sendMessage.mockResolvedValue({
      kind: "done",
      chargedKrw: 1,
      message: { ...SAVED_REPLY, model_id: "claude-haiku-4-5" },
    });
    await renderChat();

    fireEvent.click(await screen.findByRole("button", { name: /답장 방식: 균형 잡힌 답변/ }));
    fireEvent.click(screen.getByRole("button", { name: /빠른 답변/ }));
    typeAndSend("안녕");

    await waitFor(() =>
      expect(chatApi.createConversation).toHaveBeenCalledWith(HAIKU.id, expect.anything(), "medium"),
    );
    expect(chatApi.setConversationModel).not.toHaveBeenCalled();
    // The reply names the model that wrote it.
    expect(await screen.findByText("빠른 답변 (Haiku 4.5)", { selector: "p" })).toBeTruthy();
  });

  test("changing the model of an open conversation saves it for later replies", async () => {
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    chatApi.getConversation.mockResolvedValue({ ...CONVERSATION, messages: [SAVED_REPLY] });
    chatApi.setConversationModel.mockResolvedValue({ ...CONVERSATION, chat_model_id: HAIKU.id });
    await renderChat();

    fireEvent.click(await screen.findByRole("button", { name: "가계부 아이디어" }));
    // The earlier reply keeps the name of the model that wrote it.
    expect(await screen.findByText("균형 잡힌 답변 (Sonnet 5.5)", { selector: "p" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /답장 방식: 균형 잡힌 답변/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /빠른 답변/ }));
    });

    expect(chatApi.setConversationModel).toHaveBeenCalledWith(CONVERSATION.id, HAIKU.id, "medium");
    expect(await screen.findByRole("button", { name: /답장 방식: 빠른 답변/ })).toBeTruthy();
  });

  test("a conversation whose model is no longer offered asks for another", async () => {
    chatApi.listConversations.mockResolvedValue([{ ...CONVERSATION, chat_model_id: 99 }]);
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      chat_model_id: 99,
      messages: [],
    });
    await renderChat();

    fireEvent.click(await screen.findByRole("button", { name: "가계부 아이디어" }));

    expect(await screen.findByRole("button", { name: "답장 방식을 골라 주세요" })).toBeTruthy();
  });

  test("chat-pins: the ⋯ menu pins a conversation, which moves under 고정됨 with a pin", async () => {
    const other = { ...CONVERSATION, id: 6, title: "여행 계획" };
    chatApi.listConversations.mockResolvedValue([CONVERSATION, other]);
    chatApi.setConversationPinned.mockResolvedValue({ ...other, pinned_at: "2026-10-17T00:00:00Z" });
    await renderChat();
    await screen.findByRole("button", { name: "여행 계획" });
    expect(screen.queryByTestId("pinned-label")).toBeNull();

    // The second row's ⋯ → 맨 위에 고정.
    fireEvent.click(screen.getAllByRole("button", { name: "더보기" })[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: "맨 위에 고정" }));
    await waitFor(() => expect(chatApi.setConversationPinned).toHaveBeenCalledWith(6, true));

    // Now 고정됨 holds it, first, with its pin; 최근 대화 keeps the other.
    expect((await screen.findByTestId("pinned-label")).textContent).toBe("고정됨");
    const pinnedList = screen.getByRole("list", { name: "고정된 대화" });
    expect(within(pinnedList).getByRole("button", { name: "여행 계획" })).toBeTruthy();
    expect(within(pinnedList).getByTestId("pin-mark")).toBeTruthy();
    const recent = screen.getByRole("list", { name: "최근 대화" });
    expect(within(recent).queryByRole("button", { name: /여행 계획/ })).toBeNull();
    expect(within(recent).getByRole("button", { name: "가계부 아이디어" })).toBeTruthy();

    // Its menu now offers 고정 해제, and the rename/delete items are still there.
    fireEvent.click(within(pinnedList).getByRole("button", { name: "더보기" }));
    expect(screen.getByRole("menuitem", { name: "고정 해제" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "이름 바꾸기" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "지우기" })).toBeTruthy();
    chatApi.setConversationPinned.mockResolvedValue({ ...other, pinned_at: null });
    fireEvent.click(screen.getByRole("menuitem", { name: "고정 해제" }));
    await waitFor(() => expect(chatApi.setConversationPinned).toHaveBeenLastCalledWith(6, false));
    await waitFor(() => expect(screen.queryByTestId("pinned-label")).toBeNull());
  });

  test("chat-list-collapse: 목록 접기 folds the list to a rail, remembered per browser", async () => {
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    const { container } = await renderChat();
    await screen.findByRole("button", { name: "가계부 아이디어" });
    const layout = container.querySelector("[class*='layout']")!;
    expect(layout.getAttribute("data-list-collapsed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "목록 접기" }));
    expect(layout.getAttribute("data-list-collapsed")).toBe("true");
    expect(layout.className).toContain("layoutCollapsed");
    // The rail keeps 새 대화 (icon only) and the open button; the rows are gone.
    expect(screen.queryByRole("button", { name: "가계부 아이디어" })).toBeNull();
    expect(screen.getByRole("button", { name: "새 대화" }).getAttribute("aria-label")).toBe("새 대화");
    expect(window.localStorage.getItem("ctrlai.chat-list-collapsed")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "목록 펼치기" }));
    expect(screen.getByRole("button", { name: "가계부 아이디어" })).toBeTruthy();
    expect(window.localStorage.getItem("ctrlai.chat-list-collapsed")).toBe("0");
  });

  test("chat-list-collapse: a remembered fold starts folded, and on a narrow screen the drawer still opens the list", async () => {
    window.localStorage.setItem("ctrlai.chat-list-collapsed", "1");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 700 });
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    await renderChat();
    await screen.findByRole("button", { name: "목록 펼치기" });
    expect(screen.queryByRole("button", { name: "가계부 아이디어" })).toBeNull();
    // Narrow screens: the 대화 목록 drawer shows the rows even while folded.
    fireEvent.click(screen.getByRole("button", { name: "대화 목록" }));
    expect(screen.getByRole("button", { name: "가계부 아이디어" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "대화 목록" }).getAttribute("aria-expanded")).toBe("true");
  });

  test("chat-list-collapse: on a wide screen the drawer flag cannot leak rows into the rail", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    await renderChat();
    await screen.findByRole("button", { name: "가계부 아이디어" });
    fireEvent.click(screen.getByRole("button", { name: "목록 접기" }));
    // The narrow-only 대화 목록 button exists in the DOM (CSS hides it): pressing
    // it must not fill the 52px rail with rows.
    fireEvent.click(screen.getByRole("button", { name: "대화 목록" }));
    expect(screen.queryByRole("button", { name: "가계부 아이디어" })).toBeNull();
    expect(screen.getByRole("button", { name: "대화 목록" }).getAttribute("aria-expanded")).toBe("false");
    // The fold button names what it controls.
    const fold = screen.getByRole("button", { name: "목록 펼치기" });
    expect(document.getElementById(fold.getAttribute("aria-controls")!)).toBeTruthy();
  });

  test("chat-pins: 이름 바꾸기 from the ⋯ menu still opens the rename box", async () => {
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    await renderChat();
    await screen.findByRole("button", { name: "가계부 아이디어" });
    fireEvent.click(screen.getByRole("button", { name: "더보기" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));
    expect((screen.getByLabelText("대화 이름") as HTMLInputElement).value).toBe("가계부 아이디어");
  });
});
