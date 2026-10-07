/**
 * 작업물의 이름 바꾸기와 삭제.
 *
 * `project-video-management`가 요구한 테스트입니다. 증명하려는 것:
 *
 *   1. 메뉴에서 삭제를 고른 것만으로는 **아무것도 지워지지 않는다**.
 *      지우는 일은 확인창의 삭제를 누른 뒤에만 일어납니다. 되돌리기
 *      어려운 동작 앞에 창이 있는지는 눈으로 한 번 보는 것으로는
 *      지킬 수 없습니다 — 다음에 누군가 창을 지나치는 길을 만들어도
 *      아무것도 막지 못합니다.
 *   2. 확인창이 **무엇을 지우는지 이름으로** 말한다. 이 창의 요점이
 *      그것입니다.
 *   3. Enter는 저장하고 Esc는 취소한다. 그리고 거절된 이름은 한국어
 *      문장으로 보이고, 고치던 글자는 남는다.
 *
 * 백엔드는 부르지 않습니다. 바뀌는 호출만 가짜로 두고 그것이 불렸는지
 * 봅니다 — 테스트가 네트워크를 타면 백엔드가 꺼져 있을 때 실패하고,
 * 그러면 테스트가 무엇을 증명하는지 알 수 없습니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { BuilderProject, VideoProject } from "@/lib/projects";

const PROJECT: BuilderProject = {
  id: 11,
  name: "가계부",
  description: "지출 기록",
  status: "draft",
  github_repo: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const VIDEO: VideoProject = {
  id: 12,
  name: "밤의 서울",
  prompt: "비 오는 밤",
  status: "draft",
  selected_model_id: null,
  final_version_id: null,
  final_version_has_asset: false,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const listBuilderProjects = vi.fn().mockResolvedValue([PROJECT]);
const updateBuilderProject = vi.fn().mockResolvedValue(PROJECT);
const deleteBuilderProject = vi.fn().mockResolvedValue(undefined);
const listVideoProjects = vi.fn().mockResolvedValue([VIDEO]);
const updateVideoProject = vi.fn().mockResolvedValue(VIDEO);
const deleteVideoProject = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    listBuilderProjects: (...args: unknown[]) => listBuilderProjects(...args),
    updateBuilderProject: (...args: unknown[]) => updateBuilderProject(...args),
    deleteBuilderProject: (...args: unknown[]) => deleteBuilderProject(...args),
    listVideoProjects: (...args: unknown[]) => listVideoProjects(...args),
    updateVideoProject: (...args: unknown[]) => updateVideoProject(...args),
    deleteVideoProject: (...args: unknown[]) => deleteVideoProject(...args),
  };
});

// 참여 여부는 테스트마다 다릅니다. 기본은 참여 중.
let mayCreate = true;
vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => mayCreate,
  useMyQuarter: () => ({ quarter: null, loading: false }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

// CSS 모듈은 jsdom에서 의미가 없습니다. 클래스 이름이 그대로 나오게 해
// 두면 필요할 때 선택자로 찾을 수 있습니다.
vi.mock("@/app/components/library.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

const { default: BuilderLibrary } = await import("@/app/builder/BuilderLibrary");
const { default: VideoLibrary } = await import("@/app/video/VideoLibrary");

/** 카드의 ⋯ 메뉴를 엽니다. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await screen.findByText(name);
  await user.click(screen.getByRole("button", { name: `${name} 메뉴` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mayCreate = true;
  listBuilderProjects.mockResolvedValue([PROJECT]);
  updateBuilderProject.mockResolvedValue(PROJECT);
  deleteBuilderProject.mockResolvedValue(undefined);
  listVideoProjects.mockResolvedValue([VIDEO]);
  updateVideoProject.mockResolvedValue(VIDEO);
  deleteVideoProject.mockResolvedValue(undefined);
});

describe("삭제", () => {
  test("메뉴에서 고르면 확인창이 먼저 뜨고, 그 전에는 지워지지 않는다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "삭제" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    // 이것이 이 테스트의 핵심입니다.
    expect(deleteBuilderProject).not.toHaveBeenCalled();
  });

  test("확인창은 무엇을 지우는지 이름으로 말한다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "삭제" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("가계부");
    // 되돌릴 수 있다는 것과, 사용량 기록이 남는다는 것 — 지우는 사람이
    // 가장 알고 싶어 하는 두 가지입니다.
    expect(dialog.textContent).toContain("되살릴 수 있");
    expect(dialog.textContent).toContain("사용량 기록은 그대로");
  });

  test("취소하면 아무 일도 일어나지 않는다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "삭제" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(deleteBuilderProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("가계부")).toBeTruthy();
  });

  test("확인을 누르면 그때 지워지고 목록에서 사라진다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "삭제" }));
    await screen.findByRole("dialog");

    // 창 안의 삭제 버튼. 메뉴는 이미 닫혀 있습니다.
    await user.click(screen.getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(deleteBuilderProject).toHaveBeenCalledWith(PROJECT.id));
    // 목록을 다시 받지 않고 그 줄만 빠집니다.
    await waitFor(() => expect(screen.queryByText("가계부")).toBeNull());
    expect(listBuilderProjects).toHaveBeenCalledTimes(1);
  });

  test("거절되면 창이 열린 채로 이유를 보여 준다", async () => {
    deleteBuilderProject.mockRejectedValue(
      new ApiError("이번 분기에 참여하고 있지 않아 사용할 수 없습니다.", 403),
    );

    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "삭제" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "삭제" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("참여하고 있지 않아");
    // 창이 닫히면 왜 안 되었는지 읽을 자리가 사라집니다.
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(screen.getByText("가계부")).toBeTruthy();
  });

  test("영상 프로젝트도 같은 창을 쓴다", async () => {
    const user = userEvent.setup();
    render(<VideoLibrary />);

    await openMenu(user, "밤의 서울");
    await user.click(screen.getByRole("menuitem", { name: "삭제" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("밤의 서울");
    expect(deleteVideoProject).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(deleteVideoProject).toHaveBeenCalledWith(VIDEO.id));
  });
});

describe("이름 바꾸기", () => {
  test("Enter로 저장하고, 앞뒤 공백은 지운다", async () => {
    updateBuilderProject.mockResolvedValue({ ...PROJECT, name: "새 이름" });

    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));

    const box = screen.getByRole("textbox", { name: "이름" });
    await user.clear(box);
    await user.type(box, "  새 이름  {Enter}");

    await waitFor(() =>
      expect(updateBuilderProject).toHaveBeenCalledWith(PROJECT.id, { name: "새 이름" }),
    );
    expect(await screen.findByText("이름을 바꿨습니다")).toBeTruthy();
    expect(screen.getByText("새 이름")).toBeTruthy();
  });

  test("Esc로 취소하면 저장하지 않고 옛 이름이 남는다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));

    const box = screen.getByRole("textbox", { name: "이름" });
    await user.clear(box);
    await user.type(box, "딴 이름{Escape}");

    expect(updateBuilderProject).not.toHaveBeenCalled();
    expect(screen.getByText("가계부")).toBeTruthy();
  });

  test("바꾼 것이 없으면 요청을 보내지 않는다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));
    await user.type(screen.getByRole("textbox", { name: "이름" }), "{Enter}");

    expect(updateBuilderProject).not.toHaveBeenCalled();
  });

  test("거절된 이름은 한국어로 보이고, 고치던 글자는 남는다", async () => {
    updateBuilderProject.mockRejectedValue(new ApiError("이름을 입력해 주세요.", 400));

    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));

    const box = screen.getByRole("textbox", { name: "이름" });
    await user.clear(box);
    await user.type(box, "ㅤ{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("이름을 입력해 주세요.");
    // 칸은 열려 있어야 합니다 — 고치던 글자를 잃지 않도록.
    expect(screen.getByRole("textbox", { name: "이름" })).toBeTruthy();
  });

  test("60자를 넘겨 적을 수 없다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");
    await user.click(screen.getByRole("menuitem", { name: "이름 바꾸기" }));

    // 백엔드도 거절하지만, 칸에서 먼저 막는 편이 친절합니다.
    expect(screen.getByRole("textbox", { name: "이름" }).getAttribute("maxLength")).toBe("60");
  });
});

describe("메뉴가 열린 카드", () => {
  test("열려 있는 동안에만 카드가 들어 올려진다", async () => {
    // CSS는 "열린 카드는 2보다 위"라고만 말합니다. 그 클래스를 실제로
    // 붙였다 떼는지는 여기서 봅니다 — 둘 중 하나만 맞으면 고쳐지지
    // 않습니다. 겹침 자체는 jsdom이 볼 수 없어 실제 브라우저에서
    // 확인했고, 그 규칙은 card-overlay.test.ts가 지킵니다.
    const user = userEvent.setup();
    const { container } = render(<BuilderLibrary />);

    await screen.findByText("가계부");
    const card = container.querySelector(".card")!;
    expect(card.className).not.toContain("cardOpen");

    await user.click(screen.getByRole("button", { name: "가계부 메뉴" }));
    expect(card.className).toContain("cardOpen");

    // 닫으면 다시 내려와야 합니다. 올라간 채로 남으면 카드마다 쌓임
    // 맥락이 생겨 같은 문제가 다른 자리에서 납니다.
    await user.keyboard("{Escape}");
    expect(card.className).not.toContain("cardOpen");
  });
});

describe("코드 다운로드", () => {
  test("메뉴에 ZIP 받는 링크가 있고, 그 프로젝트를 가리킨다", async () => {
    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");

    // 단추가 아니라 링크입니다 — 실제로 주소를 받아 오는 일이고,
    // 그래야 가운데 클릭이나 "다른 이름으로 저장"도 동작합니다.
    const link = screen.getByRole("menuitem", { name: "코드 다운로드 (ZIP)" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(`/api/builder/projects/${PROJECT.id}/download`);
    expect(link.hasAttribute("download")).toBe(true);
  });

  test("참여하지 않는 분기에도 다운로드는 막히지 않는다", async () => {
    // 이 항목의 요점입니다. 만들기·고치기는 막히지만, 내가 만든 것을
    // 꺼내 오는 길은 열려 있어야 합니다 — 백엔드도 같은 이유로
    // get_current_user만 요구합니다.
    mayCreate = false;

    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");

    const link = screen.getByRole("menuitem", { name: "코드 다운로드 (ZIP)" });
    expect(link.getAttribute("href")).toBe(`/api/builder/projects/${PROJECT.id}/download`);
    expect(link.hasAttribute("disabled")).toBe(false);
  });

  test("영상 프로젝트 메뉴에는 코드 다운로드가 없다", async () => {
    const user = userEvent.setup();
    render(<VideoLibrary />);

    await openMenu(user, "밤의 서울");

    expect(screen.queryByRole("menuitem", { name: /코드 다운로드/ })).toBeNull();
  });
});

describe("참여하지 않는 분기", () => {
  test("이름 바꾸기와 삭제가 모두 막히고, 이유가 붙는다", async () => {
    mayCreate = false;

    const user = userEvent.setup();
    render(<BuilderLibrary />);

    await openMenu(user, "가계부");

    const rename = screen.getByRole("menuitem", { name: "이름 바꾸기" });
    const remove = screen.getByRole("menuitem", { name: "삭제" });

    expect(rename).toHaveProperty("disabled", true);
    expect(remove).toHaveProperty("disabled", true);
    // 막힌 이유를 말해 주지 않으면 회원은 고장으로 읽습니다.
    expect(rename.getAttribute("title")).toContain("분기");
  });
});
