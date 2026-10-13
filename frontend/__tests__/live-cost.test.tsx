/**
 * live-cost-display — 화면 쪽. 금액이 장부와 맞는지는 백엔드 테스트가
 * 봅니다 (`backend/tests/test_live_cost.py`).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { runningEstimateKrw, type StreamHandlers, type StreamOutcome } from "@/lib/chat";

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

const quarter = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  applyWalletRemaining: vi.fn(),
}));

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({
    state: { phase: "loading" },
    refresh: quarter.refresh,
    applyWalletRemaining: quarter.applyWalletRemaining,
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/NotParticipatingBanner", () => ({ default: () => null }));

const CONVERSATION = {
  id: 7,
  title: "비용 보기",
  created_at: "2026-10-14T00:00:00Z",
  last_message_at: "2026-10-14T00:00:00Z",
  chat_model_id: 2,
};

const REPLY = {
  id: 11,
  role: "assistant" as const,
  content: "answer",
  status: "complete" as const,
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

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  for (const fn of Object.values(chatApi)) fn.mockReset();
  quarter.refresh.mockClear();
  quarter.applyWalletRemaining.mockClear();
  // 반영에 성공한 것으로 — 실패하면 화면은 refresh()로 대신합니다.
  quarter.applyWalletRemaining.mockReturnValue(true);
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

test("어림 계산: 입력 쪽 + 글자 수 × 출력 단가, 1원 밑으로 내려가지 않는다", () => {
  const estimate = { base_krw: 3, won_per_1k_output: 14 };
  expect(runningEstimateKrw(estimate, 0)).toBe(3);
  expect(runningEstimateKrw(estimate, 1000)).toBe(17);
  expect(runningEstimateKrw(estimate, 500)).toBe(10);
  expect(runningEstimateKrw({ base_krw: 0, won_per_1k_output: 0.1 }, 1)).toBe(1);
});

describe("흐르는 답장의 비용", () => {
  test("흐르는 동안 약 N원이 보이고, 반드시 '약'이 붙는다", async () => {
    let finish!: (outcome: StreamOutcome) => void;
    chatApi.sendMessage.mockImplementation(
      (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onStart?.(
          { ...REPLY, id: 10, role: "user", content: "질문" },
          { base_krw: 5, won_per_1k_output: 20 },
        );
        handlers.onDelta?.("가".repeat(500));
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    await renderChat();
    typeAndSend("질문");

    const live = await screen.findByTestId("live-cost");
    // 5 + 500 × 20 / 1000 = 15원, 앞에 반드시 약.
    expect(live.textContent).toMatch(/^약 /);
    expect(live.textContent).toContain("15원");

    finish({
      kind: "done",
      chargedKrw: 12,
      message: REPLY,
      usage: { input_tokens: 100, output_tokens: 200, cache_write_tokens: null, cache_read_tokens: null },
      walletRemainingKrw: 79_988,
    });
    await waitFor(() => expect(screen.queryByTestId("live-cost")).toBeNull());
  });

  test("끝나면 영수증이 장부의 숫자로 보인다 — 어림값이 아니라", async () => {
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("answer");
        return {
          kind: "done",
          chargedKrw: 13,
          message: REPLY,
          usage: {
            input_tokens: 1200,
            output_tokens: 800,
            cache_write_tokens: 300,
            cache_read_tokens: 2500,
          },
          walletRemainingKrw: 79_987,
        };
      },
    );
    await renderChat();
    typeAndSend("질문");

    const receipt = await screen.findByTestId("receipt");
    expect(receipt.textContent).toBe(
      "입력 1,500토큰 · 출력 800토큰 · 캐시 읽기 2,500토큰 · 합계 13원",
    );
  });

  test("캐시가 꺼져 있던 답장의 영수증에는 캐시 읽기 줄이 없다", async () => {
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("answer");
        return {
          kind: "done",
          chargedKrw: 7,
          message: REPLY,
          usage: {
            input_tokens: 900,
            output_tokens: 100,
            cache_write_tokens: null,
            cache_read_tokens: null,
          },
          walletRemainingKrw: null,
        };
      },
    );
    await renderChat();
    typeAndSend("질문");

    const receipt = await screen.findByTestId("receipt");
    expect(receipt.textContent).toBe("입력 900토큰 · 출력 100토큰 · 합계 7원");
  });

  test("done이 들고 온 잔액으로 지갑이 그 자리에서 바뀐다 — 다시 읽지 않고", async () => {
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("answer");
        return {
          kind: "done",
          chargedKrw: 12,
          message: REPLY,
          usage: { input_tokens: 1, output_tokens: 1, cache_write_tokens: null, cache_read_tokens: null },
          walletRemainingKrw: 79_988,
        };
      },
    );
    await renderChat();
    typeAndSend("질문");

    await waitFor(() =>
      expect(quarter.applyWalletRemaining).toHaveBeenCalledWith(79_988),
    );
    expect(quarter.refresh).not.toHaveBeenCalled();
  });

  test("실패한 답장에는 청구되지 않았다고 말한다", async () => {
    chatApi.sendMessage.mockResolvedValue({ kind: "error", detail: "서버가 바빠요." });
    await renderChat();
    typeAndSend("질문");

    expect(await screen.findByTestId("not-charged")).toBeTruthy();
    expect(screen.getByTestId("not-charged").textContent).toBe("이 시도는 청구되지 않았어요.");
    expect(screen.queryByTestId("receipt")).toBeNull();
    expect(quarter.applyWalletRemaining).not.toHaveBeenCalled();
  });

  test("반영할 지갑이 없으면 refresh로 대신한다", async () => {
    quarter.applyWalletRemaining.mockReturnValue(false);
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("answer");
        return {
          kind: "done",
          chargedKrw: 12,
          message: REPLY,
          usage: { input_tokens: 1, output_tokens: 1, cache_write_tokens: null, cache_read_tokens: null },
          walletRemainingKrw: 79_988,
        };
      },
    );
    await renderChat();
    typeAndSend("질문");

    await waitFor(() => expect(quarter.refresh).toHaveBeenCalled());
  });

  test("다시 연 대화의 답장에도 영수증이 붙는다", async () => {
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      messages: [
        {
          ...REPLY,
          receipt: {
            input_tokens: 50,
            output_tokens: 60,
            cache_write_tokens: null,
            cache_read_tokens: null,
            charged_krw: 4,
          },
        },
      ],
      long_history: null,
    });
    await renderChat();
    fireEvent.click(screen.getByRole("button", { name: /비용 보기/ }));

    const receipt = await screen.findByTestId("receipt");
    expect(receipt.textContent).toContain("합계 4원");
  });
});

/* ------------------------------------------------------------------ */
/* 중지 · 연결 끊김 — 뒤늦은 정산 (리뷰 2라운드)                        */
/* ------------------------------------------------------------------ */

const SAVED_MINE = {
  id: 10,
  role: "user" as const,
  content: "질문",
  status: "complete" as const,
  action: null,
  action_title: "",
  model_id: null,
  created_at: "2026-10-14T00:00:00Z",
};

const SETTLED_REPLY = {
  ...REPLY,
  id: 11,
  content: "부분 답장",
  status: "stopped" as const,
  receipt: {
    input_tokens: 40,
    output_tokens: 8,
    cache_write_tokens: null,
    cache_read_tokens: null,
    charged_krw: 2,
  },
};

/** 가짜 타이머에서는 waitFor를 못 쓰므로 마이크로태스크만 비웁니다. */
async function flush(times = 6) {
  await act(async () => {
    for (let i = 0; i < times; i += 1) await Promise.resolve();
  });
}

async function renderChatWithFakeTimers() {
  const { default: ChatWorkspace } = await import("@/app/components/ChatWorkspace");
  render(<ChatWorkspace />);
  await flush();
  expect(chatApi.listConversations).toHaveBeenCalled();
}

describe("중지·끊김 뒤의 정산", () => {
  test("연결이 끊겨도 청구가 없었다고 말하지 않고, 정산 뒤 저장본을 가져온다", async () => {
    vi.useFakeTimers();
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onStart?.(SAVED_MINE, { base_krw: 2, won_per_1k_output: 10 });
        handlers.onDelta?.("부분 답장");
        return { kind: "disconnected", detail: "답장을 받는 중에 연결이 끊어졌습니다." };
      },
    );
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      messages: [SAVED_MINE, SETTLED_REPLY],
      long_history: null,
    });
    await renderChatWithFakeTimers();
    typeAndSend("질문");
    await flush();

    // 끊긴 답장: 남은 글은 중지된 것으로 보이고, 청구 없음 문구는 없다.
    expect(screen.getByText("부분 답장")).toBeTruthy();
    expect(screen.queryByTestId("not-charged")).toBeNull();
    expect(screen.getByText(/연결이 끊어졌습니다/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(950);
    });

    expect(chatApi.getConversation).toHaveBeenCalledWith(CONVERSATION.id);
    expect(screen.getByTestId("receipt").textContent).toContain("합계 2원");
    expect(quarter.refresh).toHaveBeenCalled();
  });

  test("0.9초 안에 같은 대화에서 또 보내도 새 말풍선이 지워지지 않는다", async () => {
    vi.useFakeTimers();
    chatApi.sendMessage.mockImplementationOnce(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onStart?.(SAVED_MINE, null);
        handlers.onDelta?.("부분 답장");
        return { kind: "stopped" };
      },
    );
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      messages: [SAVED_MINE, SETTLED_REPLY],
      long_history: null,
    });
    await renderChatWithFakeTimers();
    typeAndSend("질문");
    await flush();

    // 정산 전에 바로 다음 메시지를 보낸다.
    chatApi.sendMessage.mockImplementationOnce(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onDelta?.("두 번째 답장");
        return {
          kind: "done",
          chargedKrw: 3,
          message: { ...REPLY, id: 13, content: "두 번째 답장" },
          usage: { input_tokens: 1, output_tokens: 1, cache_write_tokens: null, cache_read_tokens: null },
          walletRemainingKrw: null,
        };
      },
    );
    // 가짜 타이머에서는 Date.now가 멈춰 말풍선 key가 겹치므로 조금 흘립니다
    // (실제 시계에서는 밀리초가 달라 겹치지 않습니다).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    typeAndSend("한 번 더");
    await flush();
    expect(screen.getByText("두 번째 답장")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(950);
    });

    // 중지된 첫 답장은 정산본으로 바뀌고, 두 번째 말풍선은 그대로 있다.
    expect(screen.getByText("부분 답장")).toBeTruthy();
    expect(screen.getByText("두 번째 답장")).toBeTruthy();
    expect(screen.getAllByTestId("receipt").length).toBeGreaterThanOrEqual(1);
  });

  test("정산이 늦으면 다음 간격에 다시 시도한다", async () => {
    vi.useFakeTimers();
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onStart?.(SAVED_MINE, null);
        handlers.onDelta?.("부분 답장");
        return { kind: "stopped" };
      },
    );
    // 첫 번째 조회: 아직 정산 전 — 답장이 저장돼 있지 않다.
    chatApi.getConversation
      .mockResolvedValueOnce({ ...CONVERSATION, messages: [SAVED_MINE], long_history: null })
      .mockResolvedValueOnce({
        ...CONVERSATION,
        messages: [SAVED_MINE, SETTLED_REPLY],
        long_history: null,
      });
    await renderChatWithFakeTimers();
    typeAndSend("질문");
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(950);
    });
    expect(chatApi.getConversation).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("receipt")).toBeNull();
    // 부분 글은 지워지지 않았다 (리뷰 2라운드 (b)).
    expect(screen.getByText("부분 답장")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(chatApi.getConversation).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("receipt").textContent).toContain("합계 2원");
  });
});
