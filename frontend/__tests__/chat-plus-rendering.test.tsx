/**
 * chat-plus-rendering — 답장을 Markdown으로 그리기, 그리고 기능 둘러보기.
 *
 * 그리는 쪽은 `ChatMarkdown`만 따로, 카드는 `ChatWorkspace`를 그려서
 * 확인합니다. 백엔드는 부르지 않습니다.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import ChatMarkdown, { prepareStreaming, safeUrl } from "@/app/components/ChatMarkdown";
import { CHAT_EXAMPLES } from "@/lib/chat-examples";

// ------------------------------------------------------------ 그리기

describe("ChatMarkdown", () => {
  test("a table, a code block and a list render as elements, not text", () => {
    const text = [
      "| 날 | 장소 |",
      "| --- | --- |",
      "| 1일 | 경복궁 |",
      "",
      "- 하나",
      "- 둘",
      "",
      "```js",
      "const a = 1;",
      "```",
    ].join("\n");
    const { container } = render(<ChatMarkdown text={text} />);

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("td").length).toBe(2);
    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelector("pre code")?.textContent).toBe("const a = 1;\n");
    expect(container.textContent).not.toContain("|");
    expect(container.textContent).not.toContain("```");
    // 넓은 표는 자기 상자 안에서만 옆으로 밀립니다.
    expect(container.querySelector("table")?.parentElement?.tagName).toBe("DIV");
    expect(screen.getByText("js")).toBeTruthy();
  });

  test("<script> and <img onerror> in a reply render as text", () => {
    const text = [
      "<script>alert(1)</script>",
      "",
      'hello <img src=x onerror="alert(2)"> world',
    ].join("\n");
    const { container } = render(<ChatMarkdown text={text} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain('<img src=x onerror="alert(2)">');
  });

  test("a javascript: link is dropped; a web link opens in a new tab", () => {
    const text = "[나쁜 링크](javascript:alert(1)) 와 [좋은 링크](https://example.com)";
    const { container } = render(<ChatMarkdown text={text} />);

    const links = container.querySelectorAll("a");
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toContain("나쁜 링크");
    expect(container.innerHTML).not.toContain("javascript:");
  });

  test("only http(s) and mailto survive", () => {
    expect(safeUrl("https://a.kr")).toBe("https://a.kr");
    expect(safeUrl("http://a.kr")).toBe("http://a.kr");
    expect(safeUrl("mailto:a@b.kr")).toBe("mailto:a@b.kr");
    expect(safeUrl("JavaScript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,<b>x</b>")).toBe("");
    expect(safeUrl("vbscript:x")).toBe("");
    expect(safeUrl("/admin")).toBe("");
  });

  test("an image is not loaded; its description shows instead", () => {
    const { container } = render(<ChatMarkdown text="![지도](https://example.com/map.png)" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("지도");
  });

  describe("복사", () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test("복사 writes the block's exact text, then says 복사됨 for two seconds", async () => {
      const code = '<p class="x">안녕</p>\n  <b>들여쓰기</b>';
      render(<ChatMarkdown text={"```html\n" + code + "\n```"} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /복사/ }));
      });
      expect(writeText).toHaveBeenCalledWith(code);
      expect(screen.getByRole("button", { name: /복사됨/ })).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByRole("button", { name: /복사됨/ })).toBeNull();
      expect(screen.getByRole("button", { name: "복사" })).toBeTruthy();
    });
  });

  test("a half-streamed fence renders as code", () => {
    const { container } = render(
      <ChatMarkdown text={"코드예요.\n\n```html\n<h1>안녕"} streaming />,
    );
    expect(container.querySelector("pre code")?.textContent).toContain("<h1>안녕");
    expect(container.textContent).not.toContain("```");
  });

  test("a table whose divider has not arrived yet does not flash pipes", () => {
    expect(prepareStreaming("표예요.\n\n| 날 | 장소 |")).toBe("표예요.\n");
    expect(prepareStreaming("표예요.\n\n| 날 | 장소 |\n| --- | -")).toBe("표예요.\n");
    const ready = "| 날 | 장소 |\n| --- | --- |\n| 1일 | 경";
    expect(prepareStreaming(ready)).toBe(ready);

    const { container } = render(<ChatMarkdown text={"표예요.\n\n| 날 | 장소 |\n| --"} streaming />);
    expect(container.textContent).not.toContain("|");
  });

  test("a closed fence is left alone and pipes inside code stay", () => {
    const text = "```\n| a |\n```";
    expect(prepareStreaming(text)).toBe(text);
    expect(prepareStreaming("a\n```\nb\n```\n\n```py\nc")).toBe("a\n```\nb\n```\n\n```py\nc\n```");
  });
});

// ------------------------------------------------------------ 기능 둘러보기

const chatApi = {
  getChatInfo: vi.fn(),
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  sendMessage: vi.fn(),
};

vi.mock("@/lib/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat")>();
  return {
    ...actual,
    getChatInfo: (...args: unknown[]) => chatApi.getChatInfo(...args),
    listConversations: (...args: unknown[]) => chatApi.listConversations(...args),
    createConversation: (...args: unknown[]) => chatApi.createConversation(...args),
    sendMessage: (...args: unknown[]) => chatApi.sendMessage(...args),
  };
});

let mayCreate = true;
vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => mayCreate,
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/NotParticipatingBanner", () => ({ default: () => null }));

describe("기능 둘러보기", () => {
  beforeEach(() => {
    mayCreate = true;
    for (const fn of Object.values(chatApi)) fn.mockReset();
    chatApi.getChatInfo.mockResolvedValue({
      is_mock: true,
      rate_limit_per_minute: 10,
      max_message_length: 8000,
      models: [],
      default_model_id: null,
    });
    chatApi.listConversations.mockResolvedValue([]);
  });

  async function renderChat() {
    const { default: ChatWorkspace } = await import("@/app/components/ChatWorkspace");
    render(<ChatWorkspace />);
    await waitFor(() => expect(chatApi.listConversations).toHaveBeenCalled());
  }

  test("the four examples replace the old shortcut cards", async () => {
    await renderChat();
    expect(screen.getByRole("heading", { name: "기능 둘러보기" })).toBeTruthy();
    for (const title of ["표 만들기", "파일 요약", "차트 그리기", "웹페이지 만들기"]) {
      expect(screen.getByRole("button", { name: new RegExp(title) })).toBeTruthy();
    }
    expect(screen.queryByRole("link", { name: /CtrlAITube 보기/ })).toBeNull();
    expect(CHAT_EXAMPLES[0].prompt).toBe("서울 여행 2박 3일 일정을 표로 정리해 줘");
    expect(CHAT_EXAMPLES[1].prompt).toBe("아래 글을 세 줄로 요약해 줘:\n");
    expect(CHAT_EXAMPLES[3].prompt).toBe("동아리 소개 한 장짜리 웹페이지를 만들어 줘");
  });

  test("each example card fills the composer and sends nothing", async () => {
    await renderChat();
    const box = screen.getByLabelText("CTRL+AI에게 보낼 메시지") as HTMLTextAreaElement;

    for (const example of CHAT_EXAMPLES) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(example.title) }));
      expect(box.value).toBe(example.prompt);
    }
    expect(chatApi.createConversation).not.toHaveBeenCalled();
    expect(chatApi.sendMessage).not.toHaveBeenCalled();
  });

  test("a member not taking part this quarter cannot fill the composer", async () => {
    mayCreate = false;
    await renderChat();
    const card = screen.getByRole("button", { name: /표 만들기/ }) as HTMLButtonElement;
    expect(card.disabled).toBe(true);
  });
});
