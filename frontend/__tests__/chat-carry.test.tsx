/**
 * chat-to-builder-carry — the 미리보기 goes to the Builder, not just the words.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ createProjectFromChat: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projects")>()),
  createProjectFromChat: (...args: unknown[]) => api.createProjectFromChat(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: api.push }) }));

const { default: CarryToBuilder } = await import("@/app/components/CarryToBuilder");
const { pageTitle, previewsIn, CARRY_LABEL } = await import("@/lib/chat");
const { carriedRequirements } = await import("@/app/builder/[projectId]/BuilderWorkspace");

const block = (title: string) => "```html\n<!doctype html><html><head><title>" + title + "</title></head><body></body></html>\n```";

describe("미리보기 찾기", () => {
  test("whole html blocks of finished replies, newest first, named by the page", () => {
    const found = previewsIn([
      { role: "user", content: block("내 글"), key: "m1" },
      { role: "assistant", content: "먼저\n" + block("가계부 v1"), key: "m2" },
      { role: "assistant", content: block("가계부 v2") + "\n그리고\n" + block("가계부 v3"), key: "m4" },
      { role: "assistant", content: block("오는 중"), key: "r9", streaming: true },
    ]);
    expect(found.map((p) => [p.title, p.replyId])).toEqual([
      ["가계부 v3", 4],
      ["가계부 v2", 4],
      ["가계부 v1", 2],
    ]);
    expect(pageTitle("<body><h1>제목 &amp; 부제</h1></body>")).toBe("제목 & 부제");
    expect(pageTitle("<p>없음</p>")).toBeNull();
    expect(pageTitle("<title>&quot;작은&quot; 앱&nbsp;이름</title>")).toBe('"작은" 앱 이름');
    // Case, CRLF and an empty block read as the reply view reads them.
    const odd = previewsIn([
      { role: "assistant", content: "```HTML\r\n<title>대문자</title>\r\n```\r\n```html\n```\n사이 글\n```html5\n<p>아님</p>\n```", key: "m8" },
    ]);
    expect(odd.map((p) => p.title)).toEqual(["대문자"]);
    // A hostile page does not hang the tab.
    const started = Date.now();
    pageTitle("<title>".repeat(28_000));
    pageTitle("<".repeat(199_000));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("이 미리보기로 Builder 시작", () => {
  beforeEach(() => {
    api.createProjectFromChat.mockReset().mockResolvedValue({ id: 77 });
    api.push.mockReset();
  });

  test("one 미리보기: starts at once with the page, the conversation and its reply", async () => {
    const [preview] = previewsIn([{ role: "assistant", content: block("영화 지도"), key: "m12" }]);
    render(<CarryToBuilder previews={[preview]} conversationId={5} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(CARRY_LABEL) }));
    await waitFor(() => expect(api.push).toHaveBeenCalledWith("/builder/77"));
    expect(api.createProjectFromChat).toHaveBeenCalledWith(
      expect.objectContaining({ name: "", html: preview.html, conversation_id: 5, reply_id: 12 }),
    );
  });

  test("several: a picker, the newest chosen first", async () => {
    const previews = previewsIn([
      { role: "assistant", content: block("첫 시안"), key: "m2" },
      { role: "assistant", content: block("둘째 시안"), key: "m4" },
    ]);
    render(<CarryToBuilder previews={previews} conversationId={5} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(CARRY_LABEL) }));
    const newest = screen.getByRole("radio", { name: /둘째 시안/ }) as HTMLInputElement;
    expect(newest.checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /첫 시안/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 미리보기로 시작" }));
    await waitFor(() => expect(api.createProjectFromChat).toHaveBeenCalled());
    expect(api.createProjectFromChat.mock.calls[0][0]).toMatchObject({ reply_id: 2 });
  });
});

test("the Builder's first bubble reads SPEC.md from Chat", () => {
  const spec = "# 요구사항 — 채팅에서 가져왔어요\n\n앱: 영화\n\n## 요구사항\n\n1. 영화 지도\n2. 포스터도\n";
  expect(carriedRequirements(spec)).toEqual(["영화 지도", "포스터도"]);
  expect(carriedRequirements("# 다른 문서\n1. 무엇")).toBeNull();
  expect(carriedRequirements(undefined)).toBeNull();
});
