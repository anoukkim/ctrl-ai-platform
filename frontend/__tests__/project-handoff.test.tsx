/**
 * project-export-handoff — 프로젝트 내려받기 · 내 Claude로 이어서 만들기.
 *
 * 버전 고르기(작업 중 / 게시된 버전), ZIP에 들어가는 파일 목록,
 * "무엇을 더 하고 싶나요?"가 프롬프트에 바로 들어가는 것, 복사 단추의
 * "복사됨"(2초), 탭의 키보드 이동, Esc로 닫기.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import HandoffPreview from "@/app/admin/content/HandoffPreview";
import HandoffSheet, { COPIED_MS } from "@/app/builder/[projectId]/HandoffSheet";
import { fillExtra, type HandoffInfo } from "@/lib/projects";

const MARKER = "내가 추가하고 싶은 것: ___";
const LABEL = "내가 추가하고 싶은 것:";

function info(which: "draft" | "published"): HandoffInfo {
  const number = which === "draft" ? 3 : 2;
  return {
    which,
    version_number: number,
    filename: `할-일-v${number}.zip`,
    draft_version_number: 3,
    published_version_number: 2,
    files: [
      { path: "CLAUDE.md", bytes: 2400, generated: true, content: null },
      { path: "index.html", bytes: 820, generated: false, content: null },
      { path: "README.md", bytes: 3100, generated: true, content: null },
    ],
    prompt: `첨부한 ZIP은 CTRL+AI에서 만든 내 웹앱이야.\n\n${MARKER}\n\n부탁할게:`,
    extra_marker: MARKER,
    extra_label: LABEL,
    max_extra: 500,
    claude_code_first_line: "CLAUDE.md를 읽고, README.md의 '다음에 해 볼 만한 것' 1번부터 해 줘.",
  };
}

const getHandoff = vi.fn((_id: number | string, version: "draft" | "published" = "draft") =>
  Promise.resolve(info(version)),
);

const getAdminHandoffPreview = vi.fn(() =>
  Promise.resolve({
    ...info("published"),
    files: [
      { path: "CLAUDE.md", bytes: 20, generated: false, content: "# CLAUDE.md — 영수증 가계부" },
      { path: "README.md", bytes: 20, generated: false, content: "# 영수증 가계부\n\n## 열어 보기" },
    ],
  }),
);

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    getHandoff: (...args: [number, "draft" | "published"]) => getHandoff(...args),
    getAdminHandoffPreview: () => getAdminHandoffPreview(),
  };
});

beforeEach(() => {
  getHandoff.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fillExtra", () => {
  test("빈칸에 넣고, 비어 있으면 그대로, 빈칸이 없으면 끝에 한 줄", () => {
    expect(fillExtra(`a\n${MARKER}\nb`, MARKER, LABEL, "  다크   모드 ")).toBe(`a\n${LABEL} 다크 모드\nb`);
    expect(fillExtra(`a\n${MARKER}`, MARKER, LABEL, "   ")).toBe(`a\n${MARKER}`);
    expect(fillExtra("내 프롬프트\n", MARKER, LABEL, "더 빠르게")).toBe(`내 프롬프트\n\n${LABEL} 더 빠르게\n`);
    // `$&` 같은 글자도 그대로 들어갑니다(replace의 특수 문자가 아님).
    expect(fillExtra(MARKER, MARKER, LABEL, "$& 그대로")).toBe(`${LABEL} $& 그대로`);
  });
});

describe("프로젝트 내려받기", () => {
  test("파일 목록과 작업 중 버전의 ZIP 링크, 게시된 버전으로 바꾸면 다시 받아 온다", async () => {
    const user = userEvent.setup();
    render(<HandoffSheet projectId={7} mode="download" onClose={vi.fn()} />);

    expect(await screen.findByRole("dialog", { name: "프로젝트 내려받기" })).toBeTruthy();
    const list = await screen.findByTestId("handoff-files");
    expect(list.textContent).toContain("index.html");
    expect(list.textContent).toContain("README.md");
    // 안내 문서는 이름 붙은 묶음으로 앱 파일 위에, 한 줄 설명과 함께 (Q3).
    const guides = screen.getByRole("list", { name: "내 Claude용 안내 문서 (2개)" });
    expect(within(guides).getByText("README.md")).toBeTruthy();
    expect(within(guides).getByText("CLAUDE.md")).toBeTruthy();
    expect(within(guides).queryByText("index.html")).toBeNull();
    expect(guides.textContent).toContain("Claude가 먼저 읽는 파일 구조와 규칙");
    const apps = screen.getByRole("list", { name: "앱 파일 (1개)" });
    expect(within(apps).getByText("index.html")).toBeTruthy();
    expect(guides.compareDocumentPosition(apps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("안내")).toBeNull();
    const link = screen.getByTestId("handoff-download");
    expect(link.getAttribute("href")).toBe("/api/builder/projects/7/download");
    expect(link.hasAttribute("download")).toBe(true);
    expect(screen.getByText("할-일-v3.zip")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: "게시된 버전 v2" }));
    await waitFor(() => expect(getHandoff).toHaveBeenLastCalledWith(7, "published"));
    expect(await screen.findByText("할-일-v2.zip")).toBeTruthy();
    expect(screen.getByTestId("handoff-download").getAttribute("href")).toBe(
      "/api/builder/projects/7/download?version=published",
    );
  });

  test("Esc와 닫기 단추로 닫힌다", async () => {
    const onClose = vi.fn();
    render(<HandoffSheet projectId={7} mode="download" onClose={onClose} />);
    await screen.findByTestId("handoff-files");

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getAllByRole("button", { name: "닫기" })[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("내 Claude로 이어서 만들기", () => {
  test("하고 싶은 것을 적으면 프롬프트와 ZIP 링크에 바로 들어간다", async () => {
    const user = userEvent.setup();
    render(<HandoffSheet projectId={7} mode="claude" onClose={vi.fn()} />);

    const prompt = await screen.findByTestId("handoff-prompt");
    expect(prompt.textContent).toContain(MARKER);
    expect(screen.getByRole("tab", { name: "claude.ai" }).getAttribute("aria-selected")).toBe("true");

    await user.type(screen.getByLabelText("무엇을 더 하고 싶나요? (선택)"), "다크 모드");
    expect(screen.getByTestId("handoff-prompt").textContent).toContain(`${LABEL} 다크 모드`);
    expect(screen.getByTestId("handoff-prompt").textContent).not.toContain("___");
    expect(screen.getByTestId("handoff-download").getAttribute("href")).toBe(
      `/api/builder/projects/7/download?extra=${encodeURIComponent("다크 모드").replace(/%20/g, "+")}`,
    );
    expect(screen.getByText(/CTRL\+AI 밖에서 만든 변경은 자동으로 돌아오지 않아요/)).toBeTruthy();
  });

  test("복사 단추는 2초 동안 '복사됨'을 보여 주고 화면 읽기에도 알린다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<HandoffSheet projectId={7} mode="claude" onClose={vi.fn()} />);
    await screen.findByTestId("handoff-prompt");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "프롬프트 복사" }));
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("첨부한 ZIP은"));
    expect(screen.getByRole("button", { name: "프롬프트 복사" }).textContent).toBe("복사됨");
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("복사했어요"))).toBe(true);

    act(() => {
      vi.advanceTimersByTime(COPIED_MS);
    });
    expect(screen.getByRole("button", { name: "프롬프트 복사" }).textContent).toBe("복사");
  });

  test("화살표 키로 Claude Code 탭에 가고, 첫 문장 예시와 복사가 있다", async () => {
    render(<HandoffSheet projectId={7} mode="claude" onClose={vi.fn()} />);
    const first = await screen.findByRole("tab", { name: "claude.ai" });

    fireEvent.keyDown(first, { key: "ArrowRight" });
    const code = screen.getByRole("tab", { name: "Claude Code" });
    expect(code.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(code);
    expect(screen.getByTestId("handoff-first-line").textContent).toContain("CLAUDE.md를 읽고");
    expect(screen.getByRole("button", { name: "첫 문장 복사" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "명령어 복사" })).toBeTruthy();
  });
});

describe("Admin › Content › ZIP 미리보기", () => {
  test("README부터 내용 그대로 보여 주고, 파일을 고르면 그 파일을", async () => {
    const user = userEvent.setup();
    render(<HandoffPreview projectId={3} name="영수증 가계부" onClose={vi.fn()} />);

    expect(await screen.findByRole("dialog", { name: "ZIP 미리보기 — 영수증 가계부" })).toBeTruthy();
    expect((await screen.findByTestId("preview-content")).textContent).toContain("## 열어 보기");
    await user.selectOptions(screen.getByTestId("preview-file"), "CLAUDE.md");
    expect(screen.getByTestId("preview-content").textContent).toBe("# CLAUDE.md — 영수증 가계부");
  });
});
