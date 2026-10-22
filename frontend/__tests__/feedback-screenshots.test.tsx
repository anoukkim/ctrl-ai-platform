/**
 * feedback-screenshots — 의견 보내기에 스크린샷 붙이기, Admin › Feedback에서 보기.
 *
 * 증명하는 것:
 *   - 붙여넣기(⌘V)·끌어다 놓기·파일 고르기 모두 사진을 올리고 썸네일을 보인다.
 *   - 글만 붙여넣으면 아무것도 올리지 않는다.
 *   - ✕는 썸네일을 빼고 서버에서도 지운다; 보내지 않고 닫아도 지운다.
 *   - 4장째·다른 종류·5MB 초과는 한국어로 거절하고 올리지 않는다.
 *   - 보내기는 올라간 사진 번호를 글과 함께 보낸다; 올리는 동안은 눌리지 않는다.
 *   - 개인정보 안내 한 줄이 있다.
 *   - Admin: 썸네일은 관리자 전용 주소를 쓰고, 누르면 크게 보이며, 지우기는 확인 뒤 지운다.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  sendFeedback: vi.fn(),
  uploadFeedbackImage: vi.fn(),
  deleteFeedbackImage: vi.fn(),
  listFeedback: vi.fn(),
  deleteFeedback: vi.fn(),
}));

vi.mock("@/lib/site", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/site")>();
  return {
    ...actual,
    sendFeedback: (...args: unknown[]) => api.sendFeedback(...args),
    uploadFeedbackImage: (...args: unknown[]) => api.uploadFeedbackImage(...args),
    deleteFeedbackImage: (...args: unknown[]) => api.deleteFeedbackImage(...args),
    listFeedback: () => api.listFeedback(),
    deleteFeedback: (...args: unknown[]) => api.deleteFeedback(...args),
  };
});

const toastShow = vi.fn();
vi.mock("@/app/components/ToastProvider", () => ({ useToast: () => ({ show: toastShow }) }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
}));

import FeedbackAdmin from "@/app/admin/feedback/FeedbackAdmin";
import { FeedbackDialog } from "@/app/components/FeedbackButton";

function pngFile(name = "screen.png", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

/** fireEvent가 clipboardData/dataTransfer를 이벤트에 그대로 얹어 줍니다. */
function transfer(files: File[], text = ""): DataTransfer {
  return {
    files,
    types: files.length > 0 ? ["Files"] : ["text/plain"],
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    getData: () => text,
  } as unknown as DataTransfer;
}

let nextId = 10;

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 10;
  api.uploadFeedbackImage.mockImplementation(async (file: File, name: string) => ({
    id: nextId++,
    name,
    size: file.size,
    width: 1440,
    height: 900,
    media_type: "image/png",
  }));
  api.deleteFeedbackImage.mockResolvedValue(undefined);
  api.sendFeedback.mockImplementation(async (body: string, page: string, ids: number[]) => ({
    id: 1,
    body,
    page,
    created_at: "",
    images: ids.map((id) => ({ id, name: "s.png", size: 1, width: 1, height: 1, media_type: "image/png" })),
  }));
  // jsdom에는 없습니다 — 미리보기 주소만 흉내 냅니다.
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
});

describe("의견 보내기 — 스크린샷", () => {
  test("⌘V로 붙여넣은 스크린샷이 올라가고 썸네일로 보인다", async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    const pasted = new File([new Uint8Array(10)], "image.png", { type: "image/png" });

    fireEvent.paste(screen.getByLabelText("내용"), { clipboardData: transfer([pasted]) });

    const shots = await screen.findByTestId("feedback-shots");
    await waitFor(() => expect(api.uploadFeedbackImage).toHaveBeenCalledTimes(1));
    expect(api.uploadFeedbackImage.mock.calls[0][1]).toBe("image.png");
    await waitFor(() => expect(within(shots).queryByRole("status")).toBeNull());
    expect(within(shots).getByRole("img", { name: "image.png" })).toBeTruthy();
    expect(screen.getByText("1/3장", { exact: false })).toBeTruthy();
  });

  test("이름 없는 붙여넣기는 종류에 맞는 이름을 받는다", async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    const pasted = new File([new Uint8Array(10)], "", { type: "image/jpeg" });
    fireEvent.paste(screen.getByTestId("feedback-form"), { clipboardData: transfer([pasted]) });
    await waitFor(() => expect(api.uploadFeedbackImage).toHaveBeenCalledTimes(1));
    expect(api.uploadFeedbackImage.mock.calls[0][1]).toBe("screenshot-1.jpg");
  });

  test("글만 붙여넣으면 아무것도 올리지 않는다", async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.paste(screen.getByLabelText("내용"), { clipboardData: transfer([], "그냥 글") });
    await act(async () => {});
    expect(api.uploadFeedbackImage).not.toHaveBeenCalled();
    expect(screen.queryByTestId("feedback-shots")).toBeNull();
  });

  test("끌어다 놓기와 파일 고르기도 올린다", async () => {
    const user = userEvent.setup();
    render(<FeedbackDialog onClose={vi.fn()} />);
    const form = screen.getByTestId("feedback-form");

    fireEvent.dragOver(form, { dataTransfer: transfer([pngFile("drop.png")]) });
    fireEvent.drop(form, { dataTransfer: transfer([pngFile("drop.png")]) });
    await waitFor(() => expect(api.uploadFeedbackImage).toHaveBeenCalledTimes(1));

    await user.upload(screen.getByTestId("feedback-file-input"), pngFile("picked.webp"));
    await waitFor(() => expect(api.uploadFeedbackImage).toHaveBeenCalledTimes(2));
    expect(api.uploadFeedbackImage.mock.calls.map((call) => call[1])).toEqual(["drop.png", "picked.webp"]);
    const shots = screen.getByTestId("feedback-shots");
    await waitFor(() => expect(within(shots).getAllByRole("img")).toHaveLength(2));
  });

  test("✕는 썸네일을 빼고 서버에서도 지운다", async () => {
    const user = userEvent.setup();
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.paste(screen.getByLabelText("내용"), { clipboardData: transfer([pngFile("a.png")]) });
    const remove = await screen.findByRole("button", { name: "a.png 빼기" });
    await waitFor(() => expect(api.uploadFeedbackImage).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    await user.click(remove);

    expect(screen.queryByTestId("feedback-shots")).toBeNull();
    expect(api.deleteFeedbackImage).toHaveBeenCalledWith(10);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  test("보내지 않고 닫으면 올린 사진을 지운다", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FeedbackDialog onClose={onClose} />);
    fireEvent.paste(screen.getByLabelText("내용"), { clipboardData: transfer([pngFile("a.png")]) });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(onClose).toHaveBeenCalled();
    expect(api.deleteFeedbackImage).toHaveBeenCalledWith(10);
  });

  test("4장째, 다른 종류, 5MB 초과는 한국어로 거절한다", async () => {
    const user = userEvent.setup();
    render(<FeedbackDialog onClose={vi.fn()} />);
    const form = screen.getByTestId("feedback-form");

    fireEvent.drop(form, { dataTransfer: transfer([pngFile("1.png"), pngFile("2.png"), pngFile("3.png"), pngFile("4.png")]) });
    expect((await screen.findByTestId("feedback-shot-error")).textContent).toBe("사진은 3장까지 붙일 수 있어요.");
    await waitFor(() => expect(api.uploadFeedbackImage).toHaveBeenCalledTimes(3));
    expect((screen.getByRole("button", { name: "스크린샷 붙이기" }) as HTMLButtonElement).disabled).toBe(true);

    // 한 장 빼고 다시: 종류와 크기.
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    await user.click(screen.getByRole("button", { name: "3.png 빼기" }));
    fireEvent.drop(form, { dataTransfer: transfer([new File([new Uint8Array(5)], "anim.gif", { type: "image/gif" })]) });
    expect((await screen.findByTestId("feedback-shot-error")).textContent).toBe("PNG, JPG, WebP 이미지만 올릴 수 있어요.");
    fireEvent.drop(form, { dataTransfer: transfer([pngFile("big.png", 5 * 1024 * 1024 + 1)]) });
    expect((await screen.findByTestId("feedback-shot-error")).textContent).toBe("사진이 너무 커요 (1장 5MB 이하).");
    expect(api.uploadFeedbackImage).toHaveBeenCalledTimes(3);
  });

  test("서버가 거절하면 그 문장을 보여 주고 썸네일을 뺀다", async () => {
    const { ApiError } = await import("@/lib/api");
    api.uploadFeedbackImage.mockRejectedValueOnce(new ApiError("파일을 열 수 없습니다.", 400));
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.paste(screen.getByLabelText("내용"), { clipboardData: transfer([pngFile("bad.png")]) });
    expect((await screen.findByTestId("feedback-shot-error")).textContent).toBe("파일을 열 수 없습니다.");
    expect(screen.queryByTestId("feedback-shots")).toBeNull();
  });

  test("보내기는 사진 번호를 글과 함께 보내고, 올리는 동안은 눌리지 않는다", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    api.uploadFeedbackImage.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<FeedbackDialog onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("내용"), "버튼이 안 눌려요");
    fireEvent.paste(screen.getByLabelText("내용"), { clipboardData: transfer([pngFile("a.png")]) });

    const send = (await screen.findByRole("button", { name: "사진 올리는 중…" })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await act(async () => {
      finish({ id: 42, name: "a.png", size: 1, width: 1, height: 1, media_type: "image/png" });
    });
    await user.click(await screen.findByRole("button", { name: "보내기" }));

    expect(api.sendFeedback).toHaveBeenCalledWith("버튼이 안 눌려요", "/chat", [42]);
    expect((await screen.findByRole("status")).textContent).toContain("고맙습니다");
    // 보낸 뒤 닫기는 사진을 지우지 않습니다 — 의견에 붙었습니다.
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(api.deleteFeedbackImage).not.toHaveBeenCalled();
  });

  test("보내는 중에는 Esc로 닫히지 않고 사진도 지우지 않는다", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let finish: (value: unknown) => void = () => {};
    api.sendFeedback.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<FeedbackDialog onClose={onClose} />);
    await user.type(screen.getByLabelText("내용"), "보내는 중");
    fireEvent.paste(screen.getByLabelText("내용"), { clipboardData: transfer([pngFile("a.png")]) });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    await user.click(screen.getByRole("button", { name: "보내기" }));

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(api.deleteFeedbackImage).not.toHaveBeenCalled();

    await act(async () => {
      finish({ id: 1, body: "보내는 중", page: "/chat", created_at: "", images: [] });
    });
    expect((await screen.findByRole("status")).textContent).toContain("고맙습니다");
  });

  test("올리는 동안 닫으면 늦게 끝난 사진도 서버에서 지운다", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    api.uploadFeedbackImage.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.paste(screen.getByLabelText("내용"), { clipboardData: transfer([pngFile("slow.png")]) });
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(api.deleteFeedbackImage).not.toHaveBeenCalled(); // 아직 번호가 없습니다

    await act(async () => {
      finish({ id: 77, name: "slow.png", size: 1, width: 1, height: 1, media_type: "image/png" });
    });
    await waitFor(() => expect(api.deleteFeedbackImage).toHaveBeenCalledWith(77));
  });

  test("붙여넣기 두 번이 연달아 와도 3장을 넘기지 않고 이름이 겹치지 않는다", async () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    const field = screen.getByLabelText("내용");
    const nameless = (type: string) => new File([new Uint8Array(3)], "", { type });
    fireEvent.paste(field, { clipboardData: transfer([nameless("image/png"), nameless("image/png")]) });
    fireEvent.paste(field, { clipboardData: transfer([nameless("image/png"), nameless("image/png")]) });

    await waitFor(() => expect(api.uploadFeedbackImage).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(api.uploadFeedbackImage).toHaveBeenCalledTimes(3);
    expect(api.uploadFeedbackImage.mock.calls.map((call) => call[1])).toEqual([
      "screenshot-1.png",
      "screenshot-2.png",
      "screenshot-3.png",
    ]);
    expect(screen.getByTestId("feedback-shot-error").textContent).toBe("사진은 3장까지 붙일 수 있어요.");
  });

  test("개인정보 안내 한 줄이 있다", () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    expect(screen.getByText("화면에 개인정보가 보이면 가린 뒤 올려 주세요.")).toBeTruthy();
    expect(screen.getByTestId("feedback-file-input").getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
  });
});

describe("Admin › Feedback — 스크린샷", () => {
  const ROWS = [
    {
      id: 7,
      body: "버튼이 안 눌려요",
      page: "/chat",
      created_at: new Date().toISOString(),
      images: [
        { id: 3, name: "a.png", size: 240_000, width: 1440, height: 900, media_type: "image/png" },
        { id: 4, name: "b.jpg", size: 1_300_000, width: 390, height: 844, media_type: "image/jpeg" },
      ],
      user_id: 2,
      username: "minji",
      display_name: "민지",
    },
    {
      id: 8,
      body: "글만 보냈어요",
      page: "/usage",
      created_at: new Date().toISOString(),
      images: [],
      user_id: 2,
      username: "minji",
      display_name: "민지",
    },
  ];

  test("썸네일은 관리자 전용 주소를 쓰고, 누르면 크게 보인다", async () => {
    api.listFeedback.mockResolvedValue(ROWS);
    const user = userEvent.setup();
    render(<FeedbackAdmin />);

    // admin-ui-unify: a row opens the side panel with the text and its pictures.
    expect((await screen.findAllByTestId("feedback-item"))[0].textContent).toContain("사진 2장");
    await user.click(screen.getByRole("button", { name: "의견 열기: 버튼이 안 눌려요" }));
    const shots = await screen.findByTestId("feedback-shots");
    const thumbs = Array.from(shots.querySelectorAll("img")); // alt="" — 단추가 이름을 가집니다
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].getAttribute("src")).toBe("/api/admin/feedback/images/3/file");

    const opener = within(shots).getByRole("button", { name: "사진 크게 보기: b.jpg" });
    await user.click(opener);
    const lightbox = screen.getByRole("dialog", { name: "사진 크게 보기" });
    expect(document.activeElement).toBe(within(lightbox).getByRole("button", { name: "닫기" }));
    expect(within(lightbox).getByRole("img", { name: "b.jpg" }).getAttribute("src")).toBe(
      "/api/admin/feedback/images/4/file",
    );
    expect(lightbox.textContent).toContain("2 / 2");
    expect(lightbox.textContent).toContain("1.2MB · 390×844");

    await user.click(within(lightbox).getByRole("button", { name: "이전 사진" }));
    expect(within(lightbox).getByRole("img", { name: "a.png" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "사진 크게 보기" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test("지우기는 확인한 뒤 글과 사진을 지운다", async () => {
    api.listFeedback.mockResolvedValue(ROWS);
    api.deleteFeedback.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FeedbackAdmin />);
    await screen.findByText("버튼이 안 눌려요");

    await user.click(screen.getByRole("button", { name: "의견 열기: 버튼이 안 눌려요" }));
    await user.click(within(screen.getByTestId("feedback-panel")).getByRole("button", { name: "지우기" }));
    const dialog = screen.getByRole("dialog", { name: "의견 지우기" });
    expect(dialog.textContent).toContain("붙은 사진 2장도 함께 지워집니다");
    await user.click(within(dialog).getByRole("button", { name: "지우기" }));

    await waitFor(() => expect(api.deleteFeedback).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByText("버튼이 안 눌려요")).toBeNull());
    expect(screen.getByText("글만 보냈어요")).toBeTruthy();
    expect(toastShow).toHaveBeenCalledWith("의견을 지웠습니다.");
  });
});
