/**
 * Admin › AI Models — 화면 쪽 (admin-and-nav-cleanup).
 *
 * 제공자별 묶음(Anthropic이 먼저), 연결 준비 중 제공자의 컨트롤이 꺼져
 * 있는지, + 모델 추가가 제공자를 먼저 묻는지를 봅니다. 실제로 막는 쪽
 * (check_open)은 백엔드 테스트가 봅니다 (`backend/tests/test_chat_models.py`).
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { AdminChatModel, ChatProvider } from "@/lib/admin";

const listChatModels = vi.fn();
const listChatProviders = vi.fn();
vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return {
    ...actual,
    listChatModels: () => listChatModels(),
    listChatProviders: () => listChatProviders(),
  };
});

const { default: ModelCatalog } = await import("@/app/admin/ai-models/ModelCatalog");

const PROVIDERS: ChatProvider[] = [
  { id: "anthropic", label: "Anthropic (Claude)", ready: true },
  { id: "deepseek", label: "DeepSeek (미국 호스팅)", ready: false },
];

function model(over: Partial<AdminChatModel>): AdminChatModel {
  return {
    id: 1,
    provider: "anthropic",
    model_id: "claude-sonnet-5-5",
    label: "균형 잡힌 답변 (Sonnet 5.5)",
    description: "",
    input_usd_per_mtok: "2",
    output_usd_per_mtok: "10",
    cache_read_usd_per_mtok: null,
    visibility: "members",
    is_default: false,
    sort_order: 10,
    updated_at: "2026-10-14T00:00:00Z",
    estimated_reply_krw: 20,
    tools_web_search: false,
    tools_web_fetch: false,
    tools_code_execution: false,
    web_search_usd_per_call: "0.01",
    ...over,
  };
}

const CATALOGUE = [
  model({ id: 1, is_default: true }),
  model({
    id: 2,
    provider: "deepseek",
    model_id: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    visibility: "disabled",
    estimated_reply_krw: null,
  }),
];

function serve(models: AdminChatModel[]) {
  listChatModels.mockResolvedValue(models);
  listChatProviders.mockResolvedValue(PROVIDERS);
}

describe("Admin › AI Models — 제공자별 묶음", () => {
  test("제공자마다 제목 하나, Anthropic이 먼저, 연결 준비 중 배지", async () => {
    serve(CATALOGUE);
    render(<ModelCatalog />);

    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings[0].textContent).toContain("Anthropic (Claude)");
    expect(headings[1].textContent).toContain("DeepSeek (미국 호스팅)");
    expect(headings[1].textContent).toContain("연결 준비 중");
    expect(headings[0].textContent).not.toContain("연결 준비 중");
  });

  test("연결 준비 중 제공자의 닫힌 모델은 열 수도, 기본으로 정할 수도 없다", async () => {
    serve(CATALOGUE);
    render(<ModelCatalog />);

    const select = await screen.findByLabelText("DeepSeek V4.1 Flash 공개 범위");
    expect((select as HTMLSelectElement).disabled).toBe(true);

    const deepseekRow = select.closest("tr") as HTMLElement;
    const defaultButton = within(deepseekRow).getByRole("button", { name: "기본으로" });
    expect((defaultButton as HTMLButtonElement).disabled).toBe(true);
  });

  test("연결 전 제공자인데 열려 있는 옛 행은 '사용 안 함'으로 닫을 수는 있다", async () => {
    serve([
      CATALOGUE[0],
      model({
        id: 3,
        provider: "openrouter",
        model_id: "stray/model",
        label: "옛 행",
        visibility: "admin",
      }),
    ]);
    render(<ModelCatalog />);

    const select = (await screen.findByLabelText("옛 행 공개 범위")) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    const values = [...select.options].map((option) => option.value);
    expect(values).toContain("disabled");
    expect(values).toContain("admin");
    expect(values).not.toContain("members");
  });

  test("+ 모델 추가는 제공자를 먼저 묻고, 고르기 전에는 다른 칸이 없다", async () => {
    serve(CATALOGUE);
    const user = userEvent.setup();
    render(<ModelCatalog />);

    await screen.findAllByRole("heading", { level: 2 });
    await user.click(screen.getByRole("button", { name: "+ 모델 추가" }));

    const providerSelect = screen.getByLabelText("제공자");
    expect(screen.queryByLabelText(/^모델 ID \(/)).toBeNull();

    await user.selectOptions(providerSelect, "deepseek");
    expect(screen.getByLabelText(/^모델 ID \(/)).toBeTruthy();
    expect(screen.getByText(/이 제공자는 아직 연결되지 않았습니다/)).toBeTruthy();

    await user.selectOptions(providerSelect, "anthropic");
    expect(screen.queryByText(/아직 연결되지 않았습니다/)).toBeNull();
  });
});
