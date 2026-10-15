/**
 * token-guard — 화면 쪽. 한도 계산과 차감은 백엔드 테스트가 봅니다
 * (`backend/tests/test_token_guard.py`).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { StreamHandlers, StreamOutcome } from "@/lib/chat";

const chatApi = {
  getChatInfo: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
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
    sendMessage: (...args: unknown[]) => chatApi.sendMessage(...args),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/NotParticipatingBanner", () => ({ default: () => null }));

const CONVERSATION = {
  id: 5,
  title: "긴 대화",
  created_at: "2026-10-14T00:00:00Z",
  last_message_at: "2026-10-14T00:00:00Z",
  chat_model_id: 2,
};

const REPLY = {
  id: 9,
  role: "assistant" as const,
  content: "여기까지 쓴 답장",
  status: "truncated" as const,
  action: null,
  action_title: "",
  model_id: "claude-sonnet-5-5",
  created_at: "2026-10-14T00:00:00Z",
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

beforeEach(() => {
  for (const fn of Object.values(chatApi)) fn.mockReset();
  chatApi.getChatInfo.mockResolvedValue({
    is_mock: true,
    rate_limit_per_minute: 10,
    max_message_length: 8000,
    web_fetch_max_uses: 1,
    web_fetch_max_content_tokens: 10_000,
    models: [],
    default_model_id: null,
  });
  chatApi.listConversations.mockResolvedValue([]);
  chatApi.createConversation.mockResolvedValue(CONVERSATION);
});

describe("1회 비용 한도에 닿은 답장", () => {
  test("한도에 닿아 멈췄다고 말하고, 잇는 방법을 알려 준다", async () => {
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("여기까지 쓴 답장");
        return {
          kind: "done",
          chargedKrw: 95,
          message: { ...REPLY, capped_krw: 100 },
          longHistory: null,
        };
      },
    );
    await renderChat();
    typeAndSend("아주 긴 설명을 부탁해");

    expect(
      await screen.findByText(/답장이 1회 비용 한도\(100원\)에 닿아 여기서 멈췄어요/),
    ).toBeTruthy();
    expect(screen.getByText(/'이어서 쓰기'로 이어 받거나/)).toBeTruthy();
    // 이어서 쓰기(quality-tuning Q1): 마지막 끊긴 답장 아래, 값이 매겨지는 새 답장.
    expect(screen.getByTestId("continue-reply")).toBeTruthy();
  });

  test("전체 출력 한도로 끊긴 답장은 기존 문구를 그대로 쓴다", async () => {
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("여기까지 쓴 답장");
        return { kind: "done", chargedKrw: 12, message: { ...REPLY, capped_krw: null } };
      },
    );
    await renderChat();
    typeAndSend("아주 긴 설명을 부탁해");

    expect(await screen.findByText(/답장이 길어 여기서 끊겼어요/)).toBeTruthy();
    expect(screen.queryByText(/1회 비용 한도/)).toBeNull();
  });
});

describe("긴 대화 경고", () => {
  test("경고가 오면 금액과 새 대화 버튼을 보여 주고, 누르면 새 대화가 된다", async () => {
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      messages: [{ ...REPLY, status: "complete" }],
      long_history: { history_tokens: 12_000, extra_krw: 34 },
    });
    await renderChat();

    fireEvent.click(screen.getByRole("button", { name: /긴 대화/ }));

    const note = await screen.findByTestId("long-history");
    expect(note.textContent).toContain("답장마다 약 34원이 더 들어요");

    fireEvent.click(screen.getByRole("button", { name: "새 대화 시작" }));
    await waitFor(() => expect(screen.queryByTestId("long-history")).toBeNull());
  });

  test("답장이 끝나면 done 이벤트의 값으로 경고가 갱신된다", async () => {
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("답");
        return {
          kind: "done",
          chargedKrw: 5,
          message: { ...REPLY, status: "complete", content: "답" },
          longHistory: { history_tokens: 9_000, extra_krw: 21 },
        };
      },
    );
    await renderChat();
    typeAndSend("안녕");

    const note = await screen.findByTestId("long-history");
    expect(note.textContent).toContain("약 21원");
  });
});
