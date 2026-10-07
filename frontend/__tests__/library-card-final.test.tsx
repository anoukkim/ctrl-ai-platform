/**
 * 목록 카드의 머리글과 최종본 다운로드 — video-higgsfield-only의 합치기 전
 * 고침 두 가지(2026-10-07)에서 카드에 해당하는 것.
 *
 *   - 상태 배지는 이름 바로 뒤에 붙고, 이름은 말줄임표로 줄며, ⋯은 오른쪽에
 *     혼자 있다 (ui-library-cards 1).
 *   - ⋯ 메뉴의 "최종본 다운로드"는 파일이 있는 최종본이 있을 때만 링크이고,
 *     아니면 꺼진 채 "최종본을 먼저 고르세요"를 띄운다 (ui-library-cards 7).
 *   - 상태는 백엔드가 정한 값을 그대로 쓴다 — 최종본이 있는 프로젝트는
 *     백엔드가 Ready로 돌려주고, 카드도 머리글도 같은 이름표를 쓴다.
 *
 * 배치는 jsdom에서 볼 수 없으므로 card-overlay.test.ts처럼 CSS 규칙을
 * 직접 읽어 고정합니다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { VIDEO_STATUS_LABEL, type VideoProject } from "@/lib/projects";

function video(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    id: 12,
    name: "probe",
    prompt: "비 오는 밤",
    status: "draft",
    selected_model_id: null,
    final_version_id: null,
    final_version_has_asset: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const listVideoProjects = vi.fn();

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return { ...actual, listVideoProjects: (...args: unknown[]) => listVideoProjects(...args) };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ quarter: null, loading: false, refresh: async () => {} }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/app/components/library.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

const { default: VideoLibrary } = await import("@/app/video/VideoLibrary");

beforeEach(() => {
  vi.clearAllMocks();
});

const CSS = readFileSync(join(process.cwd(), "app", "components", "library.module.css"), "utf-8");

function declaration(selector: string, property: string): string | null {
  const body = CSS.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, "m"))?.[1];
  if (!body) throw new Error(`.${selector} 규칙을 찾지 못했습니다`);
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "m"));
  return match ? match[1].trim() : null;
}

describe("카드 머리글", () => {
  test("배지는 이름 바로 뒤, ⋯은 그 묶음 밖 오른쪽", async () => {
    listVideoProjects.mockResolvedValue([video()]);
    render(<VideoLibrary />);

    const name = await screen.findByText("probe");
    const title = name.closest(".cardTitle") as HTMLElement;
    expect(title).not.toBeNull();
    // 이름 다음 형제가 배지입니다.
    expect(name.nextElementSibling?.textContent).toBe(VIDEO_STATUS_LABEL.draft);
    // ⋯ 단추는 이름 묶음 안에 있지 않습니다.
    const menu = screen.getByRole("button", { name: "probe 메뉴" });
    expect(title.contains(menu)).toBe(false);
  });

  test("CSS: 이름은 줄어들며 말줄임표, 배지와 ⋯은 줄지 않는다", () => {
    // 카드 자체가 내용만큼 늘어나면 아래 규칙들은 소용이 없습니다 —
    // 긴 이름이 카드를 옆 칸까지 밀어내는 것을 브라우저에서 확인했습니다.
    expect(declaration("card", "grid-template-columns")).toBe("minmax(0, 1fr)");
    expect(declaration("card", "min-width")).toBe("0");
    expect(declaration("cardTitle", "min-width")).toBe("0");
    expect(declaration("cardTitle", "flex")).toBe("1 1 auto");
    expect(declaration("cardName", "min-width")).toBe("0");
    expect(declaration("cardName", "text-overflow")).toBe("ellipsis");
    expect(declaration("cardBadge", "flex-shrink")).toBe("0");
    expect(declaration("cardMenu", "flex-shrink")).toBe("0");
  });

  test("상태는 백엔드가 돌려준 값 — 최종본이 있으면 Ready", async () => {
    listVideoProjects.mockResolvedValue([
      video({ status: "ready", final_version_id: 8, final_version_has_asset: true }),
    ]);
    render(<VideoLibrary />);

    const name = await screen.findByText("probe");
    expect(name.nextElementSibling?.textContent).toBe(VIDEO_STATUS_LABEL.ready);
  });
});

describe("최종본 다운로드", () => {
  async function openMenu() {
    const user = userEvent.setup();
    render(<VideoLibrary />);
    await screen.findByText("probe");
    await user.click(screen.getByRole("button", { name: "probe 메뉴" }));
    return screen.getByRole("menu");
  }

  test("파일이 있는 최종본이 있으면 그 버전의 다운로드 경로로 가는 링크", async () => {
    listVideoProjects.mockResolvedValue([
      video({ status: "ready", final_version_id: 8, final_version_has_asset: true }),
    ]);

    const item = within(await openMenu()).getByRole("menuitem", { name: "최종본 다운로드" });

    expect(item.tagName).toBe("A");
    expect(item.getAttribute("href")).toBe("/api/video/projects/12/versions/8/download");
    expect(item.hasAttribute("download")).toBe(true);
  });

  test.each([
    ["최종본이 없을 때", video()],
    [
      "최종본에 파일이 없을 때",
      video({ status: "ready", final_version_id: 3, final_version_has_asset: false }),
    ],
  ])("%s: 꺼져 있고 이유를 띄운다", async (_case, project) => {
    listVideoProjects.mockResolvedValue([project]);

    const item = within(await openMenu()).getByRole("menuitem", { name: "최종본 다운로드" });

    expect(item.tagName).toBe("BUTTON");
    expect((item as HTMLButtonElement).disabled).toBe(true);
    expect(item.getAttribute("title")).toBe("최종본을 먼저 고르세요");
  });
});

describe("상태 필터 — <select> 대신 칩", () => {
  test("같은 값으로 거르고, 고른 칩은 눌린 상태다", async () => {
    listVideoProjects.mockResolvedValue([
      video({ id: 1, name: "초안 하나" }),
      video({ id: 2, name: "완성 하나", status: "ready", final_version_id: 5 }),
    ]);
    render(<VideoLibrary />);
    await screen.findByText("초안 하나");

    const group = screen.getByRole("group", { name: "상태" });
    const all = within(group).getByRole("button", { name: "전체" });
    expect(all.getAttribute("aria-pressed")).toBe("true");

    const ready = within(group).getByRole("button", { name: VIDEO_STATUS_LABEL.ready });
    await userEvent.click(ready);

    expect(ready.getAttribute("aria-pressed")).toBe("true");
    expect(all.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("초안 하나")).toBeNull();
    expect(screen.getByText("완성 하나")).toBeTruthy();
  });
});
