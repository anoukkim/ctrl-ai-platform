/**
 * image-generation — 이미지 만들기 카드.
 *
 * 카드는 모델 목록의 가격을 그대로 보여 주고, 크기를 바꾸면 가격도 바뀌며,
 * 누르면 고른 값 그대로 보내고, 만든 그림을 붙입니다. 잠겨 있으면 만들기
 * 대신 안내만, 실패하면 한국어 문장을 보여 줍니다.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ImageModelList } from "@/lib/chat";

const getImageModels = vi.fn();
const makeImage = vi.fn();

vi.mock("@/lib/chat", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/chat")>();
  return { ...original, getImageModels: () => getImageModels(), makeImage: (...args: unknown[]) => makeImage(...args) };
});

const LIST: ImageModelList = {
  open: true,
  mock: true,
  models: [
    {
      id: 7,
      provider: "gemini",
      model_id: "gemini-nano-banana-2.1",
      display_name: "Nano Banana 2.1",
      description: "기본 모델",
      sort_order: 10,
      capabilities: {
        sizes: ["1K", "2K"],
        aspect_ratios: ["1:1", "16:9"],
        price_per_image_krw: { "1K": 50, "2K": 75 },
        usd_per_image: {},
        defaults: { size: "1K", aspect_ratio: "1:1" },
        prices_are_examples: true,
      },
    },
  ],
};

async function renderCard(list: ImageModelList, onMade = vi.fn()) {
  vi.resetModules();
  getImageModels.mockResolvedValue(list);
  const { default: ImageCard } = await import("@/app/components/ImageCard");
  render(<ImageCard messageId={42} prompt="a calm cat" images={[]} disabled={false} onMade={onMade} />);
  return onMade;
}

describe("이미지 만들기 카드", () => {
  beforeEach(() => {
    getImageModels.mockReset();
    makeImage.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  test("가격은 목록 그대로, 크기를 바꾸면 바뀌고, 고른 값 그대로 보낸다", async () => {
    const onMade = await renderCard(LIST);
    const button = await screen.findByTestId("image-make");
    expect(button.textContent).toBe("만들기 · 50원");
    expect(screen.getByText("테스트 모드 — 예시 그림이 만들어져요")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "2K · 75원" }));
    expect(button.textContent).toBe("만들기 · 75원");

    const attachment = { id: 9, kind: "image", name: "a.png", size: 10, media_type: "image/png", page_count: null, width: 2048, height: 2048, estimated_tokens: 0, message_id: 42, generated_model: "gemini-nano-banana-2.1", prompt: "a calm cat" };
    makeImage.mockResolvedValue({ attachment, charged_krw: 75 });
    await userEvent.click(button);
    await waitFor(() => expect(onMade).toHaveBeenCalledWith(attachment, 75));
    expect(makeImage).toHaveBeenCalledWith(42, { prompt: "a calm cat", model: 7, size: "2K", aspect_ratio: "1:1", expected_krw: 75 });
  });

  test("잠겨 있으면 만들기 대신 안내만 보인다", async () => {
    await renderCard({ ...LIST, open: false });
    expect(await screen.findByText(/이미지 만들기는 다음 단계에서 열려요/)).toBeTruthy();
    expect(screen.queryByTestId("image-make")).toBeNull();
  });

  test("실패하면 백엔드의 한국어 문장을 보여 준다", async () => {
    await renderCard(LIST);
    // 카드와 같은 모듈 인스턴스의 ApiError여야 describeError가 문장을 그대로 씁니다.
    const { ApiError } = await import("@/lib/api");
    makeImage.mockRejectedValue(new ApiError("이 내용으로는 이미지를 만들 수 없어요", 422));
    await userEvent.click(await screen.findByTestId("image-make"));
    expect((await screen.findByRole("alert")).textContent).toContain("이미지를 만들 수 없어요");
  });
});
