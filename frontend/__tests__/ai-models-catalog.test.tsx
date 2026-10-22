/**
 * Admin › Models › Chat — 화면 쪽 (admin-and-nav-cleanup; admin-ui-unify).
 *
 * 제공자별 묶음(Anthropic이 먼저), 연결 준비 중 제공자의 컨트롤이(오른쪽
 * 설정 판에서) 꺼져 있는지, + 모델 추가가 제공자를 먼저 묻는지를 봅니다. 실제로 막는 쪽
 * (check_open)은 백엔드 테스트가 봅니다 (`backend/tests/test_chat_models.py`).
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { AdminChatModel, ChatProvider } from "@/lib/admin";

const listChatModels = vi.fn();
const listChatProviders = vi.fn();
const listProviders = vi.fn();
vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return {
    ...actual,
    listChatModels: () => listChatModels(),
    listChatProviders: () => listChatProviders(),
    listProviders: () => listProviders(),
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
  listProviders.mockResolvedValue([]);
}

/** 그 모델의 ⋯ 설정 판을 엽니다. */
async function openPanel(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole("button", { name: `${label} 설정` }));
  return screen.getByTestId("chat-model-panel");
}

describe("Admin › Models › Chat — 제공자별 묶음", () => {
  test("제공자마다 묶음 하나, Anthropic이 먼저, 연결 준비 중 표시", async () => {
    serve(CATALOGUE);
    render(<ModelCatalog />);

    const list = await screen.findByTestId("chat-models");
    const text = list.textContent ?? "";
    expect(text.indexOf("Anthropic (Claude)")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Anthropic (Claude)")).toBeLessThan(text.indexOf("DeepSeek (미국 호스팅)"));
    expect(screen.getByText("모델 1개 · 회원 공개 0개")).toBeTruthy();
    // 연결 상태는 맨 위 카드에서 — DeepSeek는 연결 준비 중.
    const status = within(screen.getByTestId("provider-connection"));
    expect(status.getByText("DeepSeek (미국 호스팅)")).toBeTruthy();
    expect(status.getByText("연결 준비 중")).toBeTruthy();
    // 목록 안에는 입력칸이 없습니다 — 바꾸는 일은 오른쪽 판에서.
    expect(within(list).queryByRole("combobox")).toBeNull();
  });

  test("검색하면 맞는 모델만 남고, 기본 모델은 늘 보인다", async () => {
    serve(CATALOGUE);
    const user = userEvent.setup();
    render(<ModelCatalog />);

    expect(await screen.findByText("기본 모델: 균형 잡힌 답변 (Sonnet 5.5)")).toBeTruthy();
    expect(screen.getAllByTestId("chat-model")).toHaveLength(2);
    await user.type(screen.getByRole("searchbox"), "flash");
    expect(screen.getAllByTestId("chat-model")).toHaveLength(1);
    expect(screen.getByTestId("chat-model").textContent).toContain("DeepSeek V4.1 Flash");
  });

  test("연결 준비 중 제공자의 닫힌 모델은 열 수도, 기본으로 정할 수도 없다", async () => {
    serve(CATALOGUE);
    const user = userEvent.setup();
    render(<ModelCatalog />);

    const panel = within(await openPanel(user, "DeepSeek V4.1 Flash"));
    const select = panel.getByLabelText("DeepSeek V4.1 Flash 공개 범위") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect((panel.getByTestId("chat-model-default") as HTMLInputElement).disabled).toBe(true);
  });

  test("기본 모델 스위치는 확인 창을 거친다", async () => {
    serve([model({ id: 1, is_default: true }), model({ id: 4, label: "빠른 답변", is_default: false })]);
    const user = userEvent.setup();
    render(<ModelCatalog />);

    const panel = within(await openPanel(user, "빠른 답변"));
    await user.click(panel.getByTestId("chat-model-default"));
    expect(await screen.findByText("빠른 답변을 기본 모델로 정할까요?")).toBeTruthy();
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
    const user = userEvent.setup();
    render(<ModelCatalog />);

    const panel = within(await openPanel(user, "옛 행"));
    const select = panel.getByLabelText("옛 행 공개 범위") as HTMLSelectElement;
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

    await screen.findByTestId("chat-models");
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
