/**
 * Admin › Models › Image (admin-ui-unify): the side panel sends only what
 * changed. Sending prices is what confirms them (the backend clears 예시
 * 가격), so turning a switch must not send them.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AdminImageModel } from "@/lib/chat";

const update = vi.fn();

const MODEL: AdminImageModel = {
  id: 3,
  provider: "gemini",
  model_id: "gemini-nano-banana-2.1",
  display_name: "Nano Banana 2.1",
  description: "기본 모델",
  sort_order: 10,
  enabled: true,
  member_visible: true,
  created_at: "2026-10-22T00:00:00Z",
  updated_at: "2026-10-22T00:00:00Z",
  capabilities: {
    sizes: ["1K", "2K"],
    aspect_ratios: ["1:1"],
    price_per_image_krw: { "1K": 50, "2K": 75 },
    usd_per_image: { "1K": 0.0336, "2K": 0.0504 },
    defaults: { size: "1K", aspect_ratio: "1:1" },
    prices_are_examples: true,
  },
};

vi.mock("@/lib/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat")>()),
  listAdminImageModels: () => Promise.resolve([MODEL]),
  updateAdminImageModel: (...args: unknown[]) => update(...args),
}));
vi.mock("@/lib/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin")>()),
  listProviders: () => Promise.resolve([]),
}));

import ImageModelCatalog from "@/app/admin/image-models/ImageModelCatalog";

async function openPanel() {
  render(<ImageModelCatalog />);
  await userEvent.click(await screen.findByRole("button", { name: /⋯ 설정/ }));
  return screen.getByTestId("image-model-panel");
}

describe("이미지 모델 판", () => {
  beforeEach(() => {
    update.mockReset();
    update.mockImplementation((_id: number, changes: Partial<AdminImageModel>) => Promise.resolve({ ...MODEL, ...changes }));
  });

  test("스위치만 바꾸면 그 스위치만 보낸다 — 예시 가격은 확인되지 않는다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("switch", { name: /CTRL\+AI에서 사용/ }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(3, { enabled: false, member_visible: false });
  });

  test("가격을 바꾸면 가격을 보낸다", async () => {
    await openPanel();
    const field = screen.getByLabelText("Nano Banana 2.1 1K 한 장 가격(원)");
    await userEvent.clear(field);
    await userEvent.type(field, "60");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [, changes] = update.mock.calls[0];
    expect(changes.capabilities.price_per_image_krw).toEqual({ "1K": 60, "2K": 75 });
    expect(changes.enabled).toBeUndefined();
  });

  test("바꾸지 않은 예시 가격은 ‘이 가격이 맞아요’를 켜야 보낸다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("switch", { name: /이 가격이 맞아요/ }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1].capabilities.price_per_image_krw).toEqual({ "1K": 50, "2K": 75 });
  });

  test("아무것도 바꾸지 않고 저장하면 보내지 않는다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(update).not.toHaveBeenCalled();
  });
});
