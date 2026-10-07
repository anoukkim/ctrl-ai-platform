/**
 * Chat 화면과 스트림 읽기.
 *
 * 백엔드는 부르지 않습니다. 스트림 읽기(`sendMessage`)는 가짜 `fetch`가
 * 돌려주는 SSE 본문으로, 화면은 `lib/chat`을 바꿔 끼워 확인합니다.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(outcome).toEqual({ kind: "done", message: SAVED_REPLY, chargedKrw: 3 });
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
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  sendMessage: vi.fn(),
};

vi.mock("@/lib/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat")>();
  return {
    ...actual,
    getChatInfo: (...args: unknown[]) => chatApi.getChatInfo(...args),
    listConversations: (...args: unknown[]) => chatApi.listConversations(...args),
    getConversation: (...args: unknown[]) => chatApi.getConversation(...args),
    createConversation: (...args: unknown[]) => chatApi.createConversation(...args),
    renameConversation: (...args: unknown[]) => chatApi.renameConversation(...args),
    deleteConversation: (...args: unknown[]) => chatApi.deleteConversation(...args),
    sendMessage: (...args: unknown[]) => chatApi.sendMessage(...args),
  };
});

let mayCreate = true;
vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => mayCreate,
  useMyQuarter: () => ({ quarter: null, loading: false, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/NotParticipatingBanner", () => ({ default: () => null }));

const CONVERSATION = {
  id: 5,
  title: "가계부 아이디어",
  created_at: "2026-10-07T00:00:00Z",
  last_message_at: "2026-10-07T00:00:00Z",
};

async function renderChat() {
  const { default: ChatWorkspace } = await import("@/app/components/ChatWorkspace");
  render(<ChatWorkspace />);
  await waitFor(() => expect(chatApi.listConversations).toHaveBeenCalled());
}

function typeAndSend(text: string) {
  const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("ChatWorkspace", () => {
  beforeEach(() => {
    mayCreate = true;
    for (const fn of Object.values(chatApi)) fn.mockReset();
    chatApi.getChatInfo.mockResolvedValue({
      is_mock: true,
      rate_limit_per_minute: 10,
      max_message_length: 8000,
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
    const link = screen.getByRole("link", { name: /Project Builder에서 시작/ });
    expect(link.getAttribute("href")).toContain("/builder?idea=");
    expect(link.getAttribute("href")).toContain("name=%EA%B0%80%EA%B3%84%EB%B6%80");
    expect(chatApi.createConversation).toHaveBeenCalledTimes(1);
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

  test("the stop button aborts the reply and keeps what arrived", async () => {
    let signal: AbortSignal | null = null;
    chatApi.sendMessage.mockImplementation(
      (_id: number, _text: string, handlers: StreamHandlers, sig: AbortSignal) =>
        new Promise<StreamOutcome>((resolve) => {
          signal = sig;
          handlers.onDelta?.("쓰는 중인 답");
          sig.addEventListener("abort", () => resolve({ kind: "stopped" }));
        }),
    );
    await renderChat();

    typeAndSend("길게 설명해 주세요");
    const stop = await screen.findByRole("button", { name: "중지" });
    await act(async () => {
      fireEvent.click(stop);
    });

    expect(signal!.aborted).toBe(true);
    expect(await screen.findByText(/중지됨/)).toBeTruthy();
    expect(screen.getByText("쓰는 중인 답")).toBeTruthy();
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
    expect(
      (screen.getByLabelText("CTRL+AI에게 보낼 메시지") as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });
});
