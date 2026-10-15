/**
 * chat-plus-tools — 화면 쪽. 돈과 규칙은 백엔드 테스트가 봅니다
 * (`backend/tests/test_chat_tools.py`).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { StreamHandlers, StreamOutcome } from "@/lib/chat";

const chatApi = {
  getChatInfo: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  setConversationModel: vi.fn(),
  setConversationTool: vi.fn(),
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

const { receiptLine, sourceDomain, toolCostEffect } = await import(
  "@/app/components/ChatWorkspace"
);

const SONNET_WITH_SEARCH = {
  id: 2,
  model_id: "claude-sonnet-5-5",
  label: "균형 잡힌 답변 (Sonnet 5.5)",
  description: "대부분의 대화에 알맞습니다.",
  admin_only: false,
  is_default: true,
  estimated_reply_krw: 20,
  tools_web_search: true,
  tools_web_fetch: false,
  tools_code_execution: false,
  web_search_krw_per_call: 15,
};

const CONVERSATION = {
  id: 5,
  title: "검색 대화",
  created_at: "2026-10-14T00:00:00Z",
  last_message_at: "2026-10-14T00:00:00Z",
  chat_model_id: 2,
  use_web_search: false,
  use_web_fetch: false,
  use_code_execution: false,
};

async function renderChat() {
  const { default: ChatWorkspace } = await import("@/app/components/ChatWorkspace");
  render(<ChatWorkspace />);
  await waitFor(() => expect(chatApi.listConversations).toHaveBeenCalled());
}

describe("도움 함수", () => {
  test("영수증에 검색 줄이 붙는다", () => {
    expect(
      receiptLine({
        input_tokens: 1000,
        output_tokens: 200,
        cache_write_tokens: null,
        cache_read_tokens: null,
        web_search_count: 2,
        tool_fee_krw: 29,
        charged_krw: 50,
      }),
    ).toBe("입력 1,000토큰 · 출력 200토큰 · 검색 2회 29원 · 합계 50원");
  });

  test("검색이 없으면 검색 줄도 없다", () => {
    expect(
      receiptLine({
        input_tokens: 1000,
        output_tokens: 200,
        cache_write_tokens: null,
        cache_read_tokens: null,
        charged_krw: 21,
      }),
    ).not.toContain("검색");
  });

  test("출처는 도메인으로 보여 준다", () => {
    expect(sourceDomain("https://www.yna.co.kr/view/AKR123")).toBe("yna.co.kr");
    expect(sourceDomain("이상한 주소")).toBe("이상한 주소");
  });

  test("켜기 전 안내가 검색 요금을 말한다", () => {
    expect(toolCostEffect("web_search", 15).join(" ")).toContain("15원");
    expect(toolCostEffect("web_search", null).join(" ")).toContain("검색어가 검색 서비스로");
    expect(toolCostEffect("code_execution", null).join(" ")).toContain("Anthropic 서버");
  });
});

describe("도구 토글", () => {
  beforeEach(() => {
    for (const fn of Object.values(chatApi)) fn.mockReset();
    chatApi.getChatInfo.mockResolvedValue({
      is_mock: true,
      rate_limit_per_minute: 10,
      max_message_length: 8000,
      web_fetch_max_uses: 1,
      web_fetch_max_content_tokens: 10_000,
      models: [SONNET_WITH_SEARCH],
      default_model_id: SONNET_WITH_SEARCH.id,
    });
    chatApi.listConversations.mockResolvedValue([CONVERSATION]);
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      messages: [],
      long_history: null,
    });
  });

  async function openConversation() {
    await renderChat();
    fireEvent.click(screen.getByRole("button", { name: /검색 대화/ }));
    await waitFor(() => expect(chatApi.getConversation).toHaveBeenCalled());
  }

  test("도구 판에 비용이 먼저 보이고, 스위치로 켠다", async () => {
    chatApi.setConversationTool.mockResolvedValue({ ...CONVERSATION, use_web_search: true });
    await openConversation();

    fireEvent.click(await screen.findByTestId("tools-button"));
    const toggle = screen.getByRole("switch", { name: "웹 검색" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("tool-price-web_search").textContent).toBe("검색 1회 약 15원");
    // 모델이 허용하지 않는 도구는 줄 자체가 없다.
    expect(screen.queryByRole("switch", { name: "페이지 읽기" })).toBeNull();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(chatApi.setConversationTool).toHaveBeenCalledWith(5, "web_search", true),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "웹 검색" }).getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(screen.getByTestId("tools-button").textContent).toContain("1");
  });

  test("끌 때는 묻지 않는다", async () => {
    chatApi.getConversation.mockResolvedValue({
      ...CONVERSATION,
      use_web_search: true,
      messages: [],
      long_history: null,
    });
    chatApi.setConversationTool.mockResolvedValue({ ...CONVERSATION, use_web_search: false });
    await openConversation();

    // 켠 도구는 버튼 옆 칩(이름 + ✕)으로 남고, ✕가 바로 끈다.
    fireEvent.click(await screen.findByRole("button", { name: "웹 검색 끄기" }));
    await waitFor(() =>
      expect(chatApi.setConversationTool).toHaveBeenCalledWith(5, "web_search", false),
    );
  });

  test("도구 사용이 끝나면 흐르는 약 N원이 그만큼 뛴다", async () => {
    let release: () => void = () => {};
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _text: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onStart?.(
          {
            id: 1,
            role: "user",
            content: "검색",
            status: "complete",
            action: null,
            action_title: "",
            model_id: null,
            created_at: "2026-10-14T00:00:00Z",
          },
          { base_krw: 5, won_per_1k_output: 10 },
        );
        handlers.onDelta?.("가");
        handlers.onTool?.("web_search", "done", 30);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { kind: "done", chargedKrw: 36, message: null };
      },
    );
    await openConversation();

    const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지");
    fireEvent.change(box, { target: { value: "검색해 줘" } });
    fireEvent.keyDown(box, { key: "Enter" });

    // base 5 + 글자 1 × 10/1000 = 5.01 → 약 6원, 도구가 +30 → 약 36원.
    await waitFor(() =>
      expect(screen.getByTestId("live-cost").textContent).toBe("약 36원"),
    );
    release();
  });

  test("검색 중… 이 보이고, 출처가 번호 달린 링크로 붙는다", async () => {
    let release: () => void = () => {};
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _text: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onTool?.("web_search", "running");
        handlers.onDelta?.("찾아봤어요.");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          kind: "done",
          chargedKrw: 50,
          message: {
            id: 9,
            role: "assistant",
            content: "찾아봤어요.",
            status: "complete",
            action: null,
            action_title: "",
            model_id: "claude-sonnet-5-5",
            created_at: "2026-10-14T00:00:00Z",
            sources: [
              { title: "연합뉴스", url: "https://www.yna.co.kr/view/1" },
              { title: "KOSIS", url: "https://kosis.kr/stat/2" },
            ],
          },
        };
      },
    );
    await openConversation();

    const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지");
    fireEvent.change(box, { target: { value: "서울 인구 검색해 줘" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(await screen.findByTestId("tool-status")).toBeTruthy();
    expect(screen.getByTestId("tool-status").textContent).toBe("검색 중…");

    release();
    const sources = await screen.findByTestId("sources");
    const links = sources.querySelectorAll("a");
    // fix-real-web-search: the page title, then the domain.
    expect(links[0].textContent).toBe("1. 연합뉴스 · yna.co.kr");
    expect(links[1].textContent).toMatch(/^2\. .+ · kosis\.kr$/);
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(screen.queryByTestId("tool-status")).toBeNull();
  });
});

describe("새 대화 화면의 도구 (fix-new-chat-tools)", () => {
  const HAIKU_NO_TOOLS = {
    ...SONNET_WITH_SEARCH,
    id: 3,
    model_id: "claude-haiku-4-5",
    label: "빠른 답변 (Haiku 4.5)",
    is_default: false,
    tools_web_search: false,
  };

  beforeEach(() => {
    for (const fn of Object.values(chatApi)) fn.mockReset();
    chatApi.getChatInfo.mockResolvedValue({
      is_mock: true,
      rate_limit_per_minute: 10,
      max_message_length: 8000,
      web_fetch_max_uses: 1,
      web_fetch_max_content_tokens: 10_000,
      models: [SONNET_WITH_SEARCH, HAIKU_NO_TOOLS],
      default_model_id: SONNET_WITH_SEARCH.id,
    });
    chatApi.listConversations.mockResolvedValue([]);
  });

  test("첫 메시지 전에도 도구를 고르고, 대화를 만들 때 함께 보낸다", async () => {
    chatApi.createConversation.mockResolvedValue({
      ...CONVERSATION,
      use_web_search: true,
      show_thinking: true,
    });
    chatApi.sendMessage.mockResolvedValue({ kind: "stopped" });
    await renderChat();

    fireEvent.click(await screen.findByTestId("tools-button"));
    fireEvent.click(screen.getByRole("switch", { name: "웹 검색" }));
    fireEvent.click(screen.getByRole("switch", { name: "생각 과정 보기" }));
    // 켠 것은 칩으로 남는다 — 아직 대화를 만들지 않았다.
    expect(screen.getByRole("button", { name: "웹 검색 끄기" })).toBeTruthy();
    expect(chatApi.createConversation).not.toHaveBeenCalled();
    expect(chatApi.setConversationTool).not.toHaveBeenCalled();

    const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지");
    fireEvent.change(box, { target: { value: "서울 인구 검색해 줘" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() =>
      // 모델을 고르지 않았으면 기본(null) — 도구는 함께 간다.
      expect(chatApi.createConversation).toHaveBeenCalledWith(null, {
        use_web_search: true,
        use_web_fetch: false,
        use_code_execution: false,
        show_thinking: true,
      }, null), // 깊이를 고르지 않았으면 null — 서버가 회원의 기본값을 씁니다.
    );
  });

  test("모델을 바꾸면 그 모델이 열지 않은 도구는 줄도 칩도 사라진다", async () => {
    await renderChat();
    fireEvent.click(await screen.findByTestId("tools-button"));
    fireEvent.click(screen.getByRole("switch", { name: "웹 검색" }));
    expect(screen.getByRole("button", { name: "웹 검색 끄기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /답장 방식/ }));
    fireEvent.click(within(screen.getByRole("option", { name: /Haiku/ })).getByRole("button"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "웹 검색 끄기" })).toBeNull());
    // 판은 열린 채 — 새 모델의 줄만 남는다.
    expect(screen.queryByRole("switch", { name: "웹 검색" })).toBeNull();
    expect(screen.getByRole("switch", { name: "생각 과정 보기" })).toBeTruthy();
  });
});
