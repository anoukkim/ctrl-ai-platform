/**
 * chat-thinking-view — 화면 쪽. 요청 모양·장부·거절은 백엔드 테스트가 봅니다
 * (`backend/tests/test_chat_thinking.py`).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { StreamHandlers, StreamOutcome } from "@/lib/chat";

const chatApi = {
  getChatInfo: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  setConversationModel: vi.fn(),
  setConversationTool: vi.fn(),
  setConversationThinking: vi.fn(),
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
    setConversationModel: (...args: unknown[]) => chatApi.setConversationModel(...args),
    setConversationTool: (...args: unknown[]) => chatApi.setConversationTool(...args),
    setConversationThinking: (...args: unknown[]) => chatApi.setConversationThinking(...args),
    renameConversation: (...args: unknown[]) => chatApi.renameConversation(...args),
    deleteConversation: (...args: unknown[]) => chatApi.deleteConversation(...args),
    sendMessage: (...args: unknown[]) => chatApi.sendMessage(...args),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({
    state: { phase: "loading" },
    refresh: async () => {},
    applyWalletRemaining: () => {},
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/NotParticipatingBanner", () => ({ default: () => null }));

const { receiptLine, THINKING_LANGUAGE_NOTE } = await import("@/app/components/ChatWorkspace");
const { thinkingPriceLabel, thinkingSteps } = await import("@/lib/chat");

const SONNET = {
  id: 2,
  model_id: "claude-sonnet-5-5",
  label: "균형 잡힌 답변 (Sonnet 5.5)",
  description: "대부분의 대화에 알맞습니다.",
  admin_only: false,
  is_default: true,
  estimated_reply_krw: 20,
  thinking_extra_krw: 5,
  thinking_basis: "formula" as const,
};
const OPUS = { ...SONNET, id: 3, model_id: "claude-opus-5-5", is_default: false, thinking_extra_krw: 0 };

const CONVERSATION = {
  id: 5,
  title: "생각 대화",
  created_at: "2026-10-14T00:00:00Z",
  last_message_at: "2026-10-14T00:00:00Z",
  chat_model_id: 2,
  show_thinking: false,
};

const REPLY = {
  id: 9,
  role: "assistant" as const,
  content: "답장입니다.",
  status: "complete" as const,
  action: null,
  action_title: "",
  model_id: "claude-sonnet-5-5",
  created_at: "2026-10-14T00:00:00Z",
};

async function openConversation() {
  const { default: ChatWorkspace } = await import("@/app/components/ChatWorkspace");
  render(<ChatWorkspace />);
  await waitFor(() => expect(chatApi.listConversations).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: /생각 대화/ }));
  await waitFor(() => expect(chatApi.getConversation).toHaveBeenCalled());
}

describe("도움 함수", () => {
  test("가격 문구 — 원, 추가 비용 없음, 모름", () => {
    expect(thinkingPriceLabel(SONNET)).toBe("답장마다 +약 5원");
    expect(thinkingPriceLabel(OPUS)).toBe("추가 비용 없음");
    expect(thinkingPriceLabel({ ...SONNET, thinking_extra_krw: null })).toBe("비용이 조금 더 듭니다");
  });

  test("요약을 문단마다 단계로 나누고, 빈 요약은 단계가 없다", () => {
    expect(thinkingSteps("첫째.\n\n둘째.\n \n셋째.")).toEqual(["첫째.", "둘째.", "셋째."]);
    expect(thinkingSteps("")).toEqual([]);
    expect(thinkingSteps(null)).toEqual([]);
  });

  test("영수증의 출력에 생각이 포함됐다고 적는다", () => {
    const line = receiptLine({
      input_tokens: 100,
      output_tokens: 400,
      cache_write_tokens: null,
      cache_read_tokens: null,
      charged_krw: 7,
      input_krw: 0.28,
      output_krw: 5.6,
      thinking_shown: true,
    });
    expect(line).toContain("출력(생각 포함)");
  });
});

describe("생각 과정 보기", () => {
  beforeEach(() => {
    for (const fn of Object.values(chatApi)) fn.mockReset();
    chatApi.getChatInfo.mockResolvedValue({
      is_mock: true,
      rate_limit_per_minute: 10,
      max_message_length: 8000,
      web_fetch_max_uses: 1,
      web_fetch_max_content_tokens: 10_000,
      models: [SONNET, OPUS],
      default_model_id: SONNET.id,
    });
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    chatApi.getConversation.mockResolvedValue({ ...CONVERSATION, messages: [], long_history: null });
  });

  test("켜기 전에 더 드는 어림값을 보여 주고, 확인해야 켠다", async () => {
    chatApi.setConversationThinking.mockResolvedValue({ ...CONVERSATION, show_thinking: true });
    await openConversation();

    const chip = await screen.findByTestId("thinking-toggle");
    // 켜기 전부터 칩이 가격을 말한다.
    expect(chip.textContent).toContain("답장마다 +약 5원");
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(chip);
    expect(chatApi.setConversationThinking).not.toHaveBeenCalled();
    expect(await screen.findByText(/답장마다 \+약 5원 정도 더 들어요/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "켜기" }));
    await waitFor(() => expect(chatApi.setConversationThinking).toHaveBeenCalledWith(5, true));
    await waitFor(() =>
      expect(screen.getByTestId("thinking-toggle").getAttribute("aria-pressed")).toBe("true"),
    );
  });

  test("Opus는 추가 비용이 없어 바로 켠다", async () => {
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      chat_model_id: OPUS.id,
      messages: [],
      long_history: null,
    });
    chatApi.setConversationThinking.mockResolvedValue({
      ...CONVERSATION,
      chat_model_id: OPUS.id,
      show_thinking: true,
    });
    await openConversation();

    const chip = await screen.findByTestId("thinking-toggle");
    expect(chip.textContent).toContain("추가 비용 없음");
    fireEvent.click(chip);
    await waitFor(() => expect(chatApi.setConversationThinking).toHaveBeenCalledWith(5, true));
    expect(screen.queryByRole("button", { name: "켜기" })).toBeNull();
  });

  test("답장 아래에 접혀 있고, 펼치면 번호 달린 단계가 보인다", async () => {
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      show_thinking: true,
      messages: [
        { ...REPLY, thinking: "질문을 정리했어요.\n\n예시를 골랐어요." },
        { ...REPLY, id: 10, thinking: null },
      ],
      long_history: null,
    });
    await openConversation();

    const [header] = await screen.findAllByRole("button", { name: /생각 과정 \(2단계\)/ });
    // 빈 요약의 답장에는 아무것도 없다 — 머리글은 하나뿐.
    expect(screen.getAllByTestId("thinking")).toHaveLength(1);
    expect(header.textContent).toContain(THINKING_LANGUAGE_NOTE);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("thinking-steps")).toBeNull();

    fireEvent.click(header);
    const steps = screen.getByTestId("thinking-steps");
    expect(steps.tagName).toBe("OL");
    expect([...steps.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "질문을 정리했어요.",
      "예시를 골랐어요.",
    ]);
  });

  test("흐르는 동안 생각하는 중… 이 보이고, 끝나면 저장된 요약으로 접힌다", async () => {
    let release: () => void = () => {};
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      show_thinking: true,
      messages: [],
      long_history: null,
    });
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _text: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onThinking?.("질문을 정리했어요.\n\n");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          kind: "done",
          chargedKrw: 7,
          message: { ...REPLY, thinking: "질문을 정리했어요." },
        };
      },
    );
    await openConversation();

    const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지");
    fireEvent.change(box, { target: { value: "설명해 줘" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect((await screen.findByTestId("thinking-live")).textContent).toContain("생각하는 중");
    release();
    expect(await screen.findByRole("button", { name: /생각 과정 \(1단계\)/ })).toBeTruthy();
    expect(screen.queryByTestId("thinking-live")).toBeNull();
  });
});
