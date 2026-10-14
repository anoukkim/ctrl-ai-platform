/**
 * fix-real-web-search — 화면 쪽.
 *
 * 출처는 주소가 같으면 하나로, 인용한 것이 먼저, 제목(없으면 도메인), 8개
 * 넘으면 "더 보기". 스트림의 keepalive 주석은 읽는 쪽이 건너뜁니다.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import ReplySources from "@/app/components/ReplySources";
import { SOURCES_VISIBLE, sendMessage, tidySources, type ReplySource } from "@/lib/chat";

describe("출처 정리", () => {
  test("같은 주소는 하나로, 인용한 것이 먼저", () => {
    const tidy = tidySources([
      { title: "", url: "https://a.example/x" },
      { title: "B 페이지", url: "https://b.example/y", cited: true },
      { title: "A 페이지", url: "https://a.example/x/" },
      { title: "A", url: "https://a.example/x#part" },
    ]);
    expect(tidy).toEqual([
      { title: "B 페이지", url: "https://b.example/y", cited: true },
      { title: "A 페이지", url: "https://a.example/x" },
    ]);
  });

  test("제목을 보여 주고, 없으면 도메인; 8개 넘으면 더 보기", async () => {
    const sources: ReplySource[] = Array.from({ length: 11 }, (_, i) => ({
      title: i === 0 ? "" : `기사 ${i}`,
      url: `https://www.site${i}.example/p`,
    }));
    const user = userEvent.setup();
    render(<ReplySources sources={sources} />);

    const list = screen.getByTestId("sources");
    expect(list.querySelectorAll("li")).toHaveLength(SOURCES_VISIBLE);
    expect(screen.getByText("site0.example")).toBeTruthy();
    expect(screen.getByText("기사 1")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "더 보기 (3개)" }));
    expect(screen.getByTestId("sources").querySelectorAll("li")).toHaveLength(11);
    expect(screen.getByRole("button", { name: "접기" }).getAttribute("aria-expanded")).toBe("true");
  });

  test("8개 이하면 더 보기가 없다", () => {
    render(<ReplySources sources={[{ title: "하나", url: "https://one.example" }]} />);
    expect(screen.queryByRole("button", { name: /더 보기/ })).toBeNull();
  });
});

describe("스트림", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("keepalive 주석은 건너뛰고 답장은 그대로", async () => {
    const body =
      'event: start\ndata: {"user_message": {"id": 1}}\n\n' +
      ": keepalive\n\n" +
      'event: delta\ndata: {"text": "안녕"}\n\n' +
      ": keepalive\n\n" +
      'event: done\ndata: {"message": null, "charged_krw": 3}\n\n';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })),
    );
    const deltas: string[] = [];
    const outcome = await sendMessage(1, "hi", { onDelta: (text) => deltas.push(text) }, new AbortController().signal);

    expect(deltas).toEqual(["안녕"]);
    expect(outcome.kind).toBe("done");
  });
});
