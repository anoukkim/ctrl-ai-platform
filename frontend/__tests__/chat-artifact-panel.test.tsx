/**
 * chat-artifact-panel — 채팅에서 html·svg 블록은 카드가 되고, 누르면 대화
 * 옆 패널이 열린다. 패널의 액자도 대화 안 미리보기와 **같은** 규칙:
 *
 *   - 누르기 전에는 액자가 없다.
 *   - sandbox는 정확히 "allow-scripts", srcdoc은 CSP 메타 태그로 시작.
 *   - 코드 탭, 닫기(단추·Esc·카드 다시 누르기), Builder로 보내기(HTML만).
 *   - 패널이 없는 화면에서는 예전 카드 그대로(chat-plus-artifacts가 확인).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { PREVIEW_CSP, type ArtifactContextValue } from "@/app/components/ArtifactPreview";
import {
  ArtifactPanelContext,
  artifactTitle,
  type OpenArtifact,
} from "@/app/components/artifact-panel-context";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const projects = vi.hoisted(() => ({ createProjectFromChat: vi.fn() }));
vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return { ...actual, createProjectFromChat: (...a: unknown[]) => projects.createProjectFromChat(...a) };
});

const { default: ChatMarkdown } = await import("@/app/components/ChatMarkdown");
const { default: ArtifactPanel } = await import("@/app/components/ArtifactPanel");

const PAGE =
  "<!doctype html><html><head><title>동아리 계산기</title></head><body><h1>안녕</h1><script>document.title='x'</script></body></html>";
const CHART = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="9"/></svg>';

const CONTEXT: ArtifactContextValue = {
  streaming: false,
  cutOffCode: null,
  conversationId: 7,
  replyNumber: 42,
  conversationTitle: "동아리 소개",
  memberMessage: "계산기 만들어 줘",
  mayCreate: true,
};

/** ChatWorkspace가 하는 일만: 상태 하나와 패널. */
function Harness({ text, context = {} }: { text: string; context?: Partial<ArtifactContextValue> }) {
  const [current, setCurrent] = useState<OpenArtifact | null>(null);
  const value = useMemo(() => ({ current, open: setCurrent, close: () => setCurrent(null) }), [current]);
  return (
    <ArtifactPanelContext.Provider value={value}>
      <ChatMarkdown text={text} artifacts={{ ...CONTEXT, ...context }} />
      {current && <ArtifactPanel artifact={current} onClose={() => setCurrent(null)} />}
    </ArtifactPanelContext.Provider>
  );
}

const fenced = (language: string, code: string) => "만들었어요.\n\n```" + language + "\n" + code + "\n```\n";

beforeEach(() => {
  push.mockReset();
  projects.createProjectFromChat.mockReset();
});

describe("카드와 패널", () => {
  test("카드는 페이지 이름을 보여 주고, 누르기 전에는 액자가 없다", () => {
    render(<Harness text={fenced("html", PAGE)} />);
    expect(screen.getByTestId("artifact").textContent).toContain("동아리 계산기");
    expect(screen.getByTestId("artifact").textContent).toContain("HTML 페이지");
    expect(screen.queryByTestId("artifact-panel")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  test("누르면 패널: sandbox는 allow-scripts 하나, srcdoc은 CSP로 시작", () => {
    render(<Harness text={fenced("html", PAGE)} />);
    fireEvent.click(screen.getByTestId("artifact"));
    const frame = screen.getByTestId("artifact-panel-frame");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")!.startsWith(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`)).toBe(true);
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.getByTestId("artifact").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });

  test("코드 탭은 코드를 보여 주고 액자를 내린다", () => {
    render(<Harness text={fenced("html", PAGE)} />);
    fireEvent.click(screen.getByTestId("artifact"));
    fireEvent.click(screen.getByTestId("artifact-panel-code-tab"));
    expect(screen.getByTestId("artifact-panel-code").textContent).toContain("<title>동아리 계산기</title>");
    expect(screen.queryByTestId("artifact-panel-frame")).toBeNull();
  });

  test("닫기: 단추, Esc, 카드 다시 누르기", () => {
    render(<Harness text={fenced("html", PAGE)} />);
    fireEvent.click(screen.getByTestId("artifact"));
    fireEvent.click(screen.getByTestId("artifact-panel-close"));
    expect(screen.queryByTestId("artifact-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("artifact"));
    fireEvent.keyDown(screen.getByTestId("artifact-panel"), { key: "Escape" });
    expect(screen.queryByTestId("artifact-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("artifact"));
    fireEvent.click(screen.getByTestId("artifact"));
    expect(screen.queryByTestId("artifact-panel")).toBeNull();
  });

  test("전체 화면은 같은 sandbox의 새 액자", () => {
    render(<Harness text={fenced("html", PAGE)} />);
    fireEvent.click(screen.getByTestId("artifact"));
    fireEvent.click(screen.getByTestId("artifact-panel-fullscreen"));
    const frames = [...document.querySelectorAll("iframe")];
    expect(frames.length).toBe(2);
    for (const frame of frames) expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  });

  test("Builder로 보내기(HTML): 프로젝트 하나를 만들고 연다", async () => {
    projects.createProjectFromChat.mockResolvedValue({ id: 5 });
    render(<Harness text={fenced("html", PAGE)} />);
    fireEvent.click(screen.getByTestId("artifact"));
    fireEvent.click(screen.getByRole("button", { name: /Builder로 보내기/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/builder/5"));
    expect(projects.createProjectFromChat).toHaveBeenCalledWith(
      expect.objectContaining({ html: PAGE, conversation_id: 7, reply_id: 42, split: false }),
    );

  });

  test("파일로 나누기는 split으로 보낸다", async () => {
    projects.createProjectFromChat.mockResolvedValue({ id: 6 });
    render(<Harness text={fenced("html", PAGE)} />);
    fireEvent.click(screen.getByTestId("artifact"));
    fireEvent.click(screen.getByRole("button", { name: "파일로 나누기" }));
    await waitFor(() =>
      expect(projects.createProjectFromChat).toHaveBeenCalledWith(expect.objectContaining({ split: true })),
    );
  });

  test("이번 분기에 참여하지 않으면 Builder로 보내기를 누를 수 없다", () => {
    render(<Harness text={fenced("html", PAGE)} context={{ mayCreate: false }} />);
    fireEvent.click(screen.getByTestId("artifact"));
    expect((screen.getByRole("button", { name: /Builder로 보내기/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("SVG: 그림 카드, Builder로 보내기 없음", () => {
    render(<Harness text={fenced("svg", CHART)} />);
    expect(screen.getByTestId("artifact").textContent).toContain("SVG 그림");
    fireEvent.click(screen.getByTestId("artifact"));
    expect(screen.getByTestId("artifact-panel-frame").getAttribute("sandbox")).toBe("allow-scripts");
    expect(screen.queryByRole("button", { name: /Builder로 보내기/ })).toBeNull();
  });

  test("답장이 오는 중이면 카드 대신 오로라 카드", () => {
    render(<Harness text={fenced("html", PAGE)} context={{ streaming: true }} />);
    expect(screen.queryByTestId("artifact")).toBeNull();
    expect(screen.getByText("미리보기 만드는 중…")).toBeTruthy();
  });
});

describe("artifactTitle", () => {
  test("<title>, 없으면 <h1>, 없으면 종류; 태그는 지우고 40자로", () => {
    expect(artifactTitle(PAGE, "html")).toBe("동아리 계산기");
    expect(artifactTitle("<h1>할 일 <b>목록</b></h1>", "html")).toBe("할 일 목록");
    expect(artifactTitle("<div>x</div>", "html")).toBe("웹 페이지");
    expect(artifactTitle(CHART, "svg")).toBe("그림");
    expect(artifactTitle(`<title>${"가".repeat(60)}</title>`, "html")).toHaveLength(40);
  });
});
