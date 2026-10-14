/**
 * chat-plus-artifacts — 미리보기. 보안이 이 기능의 전부라, 샌드박스의 속성
 * 하나하나를 정확히 확인합니다(나중의 "작은 수정"이 몰래 넓히지 못하게).
 *
 *   - iframe의 sandbox는 정확히 "allow-scripts".
 *   - srcdoc은 CSP 메타 태그로 시작한다.
 *   - SVG는 액자 밖 화면에 들어가지 않는다.
 *   - 미리보기 열기를 누르기 전에는 아무것도 돌지 않는다(액자 없음).
 *   - 200KB가 넘으면 코드만.
 *   - 잘린 답장의 마지막 블록은 "계속" 안내.
 *   - 다운로드는 이름과 형식이 맞는 Blob.
 *   - Builder로 보내기는 프로젝트 하나를 만들고 연다; 참여하지 않으면 못 누른다.
 *   - 답장이 오는 중에는 미리보기 없이 코드만.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CUT_OFF_NOTE,
  PREVIEW_CSP,
  PREVIEW_LABEL,
  buildSrcdoc,
  downloadName,
  type ArtifactContextValue,
} from "@/app/components/ArtifactPreview";
import { cutOffBlock } from "@/app/components/ChatWorkspace";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const projects = vi.hoisted(() => ({ createProjectFromChat: vi.fn() }));
vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return { ...actual, createProjectFromChat: (...a: unknown[]) => projects.createProjectFromChat(...a) };
});

const { default: ChatMarkdown } = await import("@/app/components/ChatMarkdown");

const PAGE = "<!doctype html><html><body><h1>안녕</h1><script>document.title='x'</script></body></html>";
const CHART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="9" onclick="alert(1)"/></svg>';

const CONTEXT: ArtifactContextValue = {
  streaming: false,
  cutOffCode: null,
  conversationId: 7,
  replyNumber: 42,
  conversationTitle: "동아리 소개",
  memberMessage: "동아리 소개 페이지를 만들어 줘",
  mayCreate: true,
};

function renderReply(text: string, context: Partial<ArtifactContextValue> = {}) {
  return render(<ChatMarkdown text={text} artifacts={{ ...CONTEXT, ...context }} />);
}

beforeEach(() => {
  push.mockReset();
  projects.createProjectFromChat.mockReset();
});

describe("샌드박스 — 정확히", () => {
  test("열기 전에는 액자가 없고, 열면 sandbox는 allow-scripts 하나, srcdoc은 CSP로 시작", () => {
    renderReply("페이지예요.\n\n```html\n" + PAGE + "\n```\n");
    expect(screen.queryByTestId("artifact-frame")).toBeNull();
    expect(screen.getByTestId("artifact")).toBeTruthy();

    fireEvent.click(screen.getByTestId("artifact-open"));
    const frame = screen.getByTestId("artifact-frame") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcdoc.startsWith(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`)).toBe(true);
    expect(PREVIEW_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:",
    );
    expect(srcdoc).toContain("<h1>안녕</h1>");
    expect(screen.getByText(PREVIEW_LABEL)).toBeTruthy();
    // The page's script did not run in this document.
    expect(document.title).not.toBe("x");
  });

  test("SVG는 액자 밖 화면에 들어가지 않는다", () => {
    const { container } = renderReply("```svg\n" + CHART + "\n```");
    fireEvent.click(screen.getByTestId("artifact-open"));
    // Only inside the frame's srcdoc — never as live elements on the page.
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("svg[viewBox='0 0 10 10']")).toBeNull();
    expect(screen.getByTestId("artifact-frame").getAttribute("srcdoc")).toContain("<rect");
  });

  test("새로 고침과 닫기", () => {
    renderReply("```html\n" + PAGE + "\n```");
    fireEvent.click(screen.getByTestId("artifact-open"));
    fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
    expect(screen.getByTestId("artifact-frame")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByTestId("artifact-frame")).toBeNull();
  });

  test("buildSrcdoc: svg도 CSP로 시작", () => {
    expect(buildSrcdoc(CHART, "svg").startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
  });
});

describe("미리보기를 만들지 않는 경우", () => {
  test("200KB가 넘으면 코드만", () => {
    renderReply("```html\n<p>" + "가".repeat(70_000) + "</p>\n```");
    expect(screen.getByTestId("artifact-too-big")).toBeTruthy();
    expect(screen.queryByTestId("artifact-open")).toBeNull();
  });

  test("답장이 오는 중이면 코드만", () => {
    renderReply("```html\n" + PAGE + "\n```", { streaming: true });
    expect(screen.queryByTestId("artifact")).toBeNull();
  });

  test("잘린 답장의 마지막 블록은 '계속' 안내", () => {
    const text = "만들어 볼게요.\n\n```html\n<!doctype html><html><body><h1>반쯤";
    const cut = cutOffBlock({
      key: "m1", role: "assistant", content: text, status: "truncated",
      action: null, actionTitle: "", modelId: null,
    });
    expect(cut).toBe("<!doctype html><html><body><h1>반쯤");
    renderReply(text, { cutOffCode: cut });
    expect(screen.getByTestId("artifact-cut-off").textContent).toBe(CUT_OFF_NOTE);
    expect(screen.queryByTestId("artifact-open")).toBeNull();
  });

  test("끝까지 온 답장은 잘린 블록이 없다", () => {
    expect(
      cutOffBlock({
        key: "m1", role: "assistant", content: "```html\n<p>x</p>\n```", status: "complete",
        action: null, actionTitle: "", modelId: null,
      }),
    ).toBeNull();
  });

  test("다른 언어의 코드 블록은 그대로", () => {
    renderReply("```python\nprint(1)\n```");
    expect(screen.queryByTestId("artifact")).toBeNull();
  });
});

describe("코드 보기 · 다운로드 · Builder로 보내기", () => {
  test("코드 보기는 원래 코드 블록을 펼친다", () => {
    renderReply("```html\n" + PAGE + "\n```");
    expect(screen.queryByText("복사")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "코드 보기" }));
    expect(screen.getByText("복사")).toBeTruthy();
  });

  test("다운로드: 이름과 형식", () => {
    expect(downloadName(7, 42, "html")).toBe("ctrlai-7-42.html");
    expect(downloadName(7, 42, "svg")).toBe("ctrlai-7-42.svg");
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:x";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderReply("```svg\n" + CHART + "\n```");
    fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
    expect(created[0].type).toBe("image/svg+xml");
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  test("Builder로 보내기는 HTML에만, 프로젝트 하나를 만들고 연다", async () => {
    projects.createProjectFromChat.mockResolvedValue({ id: 99 });
    renderReply("```html\n" + PAGE + "\n```");
    fireEvent.click(screen.getByRole("button", { name: "Builder로 보내기" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/builder/99"));
    expect(projects.createProjectFromChat).toHaveBeenCalledWith({
      name: "동아리 소개",
      description: "동아리 소개 페이지를 만들어 줘",
      html: PAGE,
    });
  });

  test("SVG에는 Builder로 보내기가 없다", () => {
    renderReply("```svg\n" + CHART + "\n```");
    expect(screen.queryByRole("button", { name: "Builder로 보내기" })).toBeNull();
  });

  test("이번 분기에 참여하지 않으면 Builder로 보내기를 누를 수 없다", () => {
    renderReply("```html\n" + PAGE + "\n```", { mayCreate: false });
    const button = screen.getByRole("button", { name: "Builder로 보내기" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
