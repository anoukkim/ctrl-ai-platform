/**
 * chat-plus-files — 화면 쪽. 형식·크기·쪽수·공간의 진짜 판단과 저장, 차감은
 * 백엔드 테스트(`backend/tests/test_chat_files.py`)가 봅니다.
 *
 * 증명하는 것:
 *   - 📎로 고른 파일이 하나씩 올라가고, 칩(이름·크기·✕)과 예상 비용
 *     ("첨부 포함 답장 1회 약 N원", "이어지는 답장마다 약 M원씩")이 보인다.
 *   - 확장자·크기를 미리 걸러 한국어로 말하고, 그 파일은 올리지 않는다.
 *   - 서버의 거절 문장이 그대로 보인다.
 *   - 글 없이 파일만으로도 보낼 수 있고, 보낼 때 파일 id가 함께 간다.
 *   - ✕는 아직 보내지 않은 파일을 지운다.
 *   - 보낸 메시지에는 사진 미리보기, PDF는 내려받는 칩.
 *   - 파일 요약 카드는 파일 고르기 창을 연다.
 *   - 어디로 가고 언제까지 남는지 안내가 함께 보인다.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { StreamHandlers, StreamOutcome } from "@/lib/chat";

const chatApi = vi.hoisted(() => ({
  getChatInfo: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock("@/lib/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat")>();
  return {
    ...actual,
    getChatInfo: (...a: unknown[]) => chatApi.getChatInfo(...a),
    listConversations: (...a: unknown[]) => chatApi.listConversations(...a),
    getConversation: (...a: unknown[]) => chatApi.getConversation(...a),
    createConversation: (...a: unknown[]) => chatApi.createConversation(...a),
    sendMessage: (...a: unknown[]) => chatApi.sendMessage(...a),
  };
});

const files = vi.hoisted(() => ({
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getPendingAttachments: vi.fn(),
  getAttachmentEstimate: vi.fn(),
}));
vi.mock("@/lib/chat-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-files")>();
  return {
    ...actual,
    uploadAttachment: (...a: unknown[]) => files.uploadAttachment(...a),
    deleteAttachment: (...a: unknown[]) => files.deleteAttachment(...a),
    getPendingAttachments: (...a: unknown[]) => files.getPendingAttachments(...a),
    getAttachmentEstimate: (...a: unknown[]) => files.getAttachmentEstimate(...a),
  };
});

vi.mock("@/app/components/MyQuarterProvider", () => ({
  useMayCreate: () => true,
  useMyQuarter: () => ({ state: { phase: "loading" }, refresh: vi.fn(), applyWalletRemaining: () => true }),
}));
vi.mock("@/app/components/NotParticipatingBanner", () => ({ default: () => null }));
vi.mock("@/app/components/SpendFeedbackProvider", () => ({
  useSpendFeedback: () => ({ reportCharge: vi.fn(), lastSpend: null, enabled: true }),
}));

const CONVERSATION = {
  id: 7,
  title: "",
  created_at: "2026-10-14T00:00:00Z",
  last_message_at: "2026-10-14T00:00:00Z",
  chat_model_id: 2,
};

function attachment(id: number, name: string, kind: "image" | "pdf" | "csv" | "text", size = 2048) {
  return {
    id, kind, name, size, media_type: kind === "pdf" ? "application/pdf" : "image/jpeg",
    page_count: kind === "pdf" ? 3 : null, width: kind === "image" ? 800 : null,
    height: kind === "image" ? 600 : null, estimated_tokens: 900, message_id: null,
  };
}

const ESTIMATE = { tokens: 900, with_files_krw: 31, each_later_krw: 2 };

async function renderChat() {
  const { default: ChatWorkspace } = await import("@/app/components/ChatWorkspace");
  render(<ChatWorkspace />);
  await waitFor(() => expect(chatApi.listConversations).toHaveBeenCalled());
}

function pick(...picked: File[]) {
  fireEvent.change(screen.getByTestId("file-input"), { target: { files: picked } });
}

beforeEach(() => {
  for (const fn of [...Object.values(chatApi), ...Object.values(files)]) fn.mockReset();
  chatApi.getChatInfo.mockResolvedValue({
    is_mock: true, rate_limit_per_minute: 10, max_message_length: 8000,
    web_fetch_max_uses: 1, web_fetch_max_content_tokens: 10_000, models: [], default_model_id: null,
  });
  chatApi.listConversations.mockResolvedValue([]);
  chatApi.createConversation.mockResolvedValue(CONVERSATION);
  files.getPendingAttachments.mockResolvedValue([]);
  files.getAttachmentEstimate.mockResolvedValue(ESTIMATE);
  files.deleteAttachment.mockResolvedValue(undefined);
});

describe("첨부하기", () => {
  test("📎로 고른 파일이 올라가고, 칩과 예상 비용과 안내가 보인다", async () => {
    files.uploadAttachment.mockResolvedValue({ attachment: attachment(1, "보고서.pdf", "pdf"), estimate: ESTIMATE });
    await renderChat();

    expect(screen.getByRole("button", { name: /파일 첨부/ })).toBeTruthy();
    pick(new File(["%PDF"], "보고서.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(files.uploadAttachment).toHaveBeenCalledTimes(1));
    expect(chatApi.createConversation).toHaveBeenCalled(); // a conversation is made first
    expect(files.uploadAttachment.mock.calls[0][0]).toBe(7);
    const tray = await screen.findByTestId("file-tray");
    expect(tray.textContent).toContain("보고서.pdf");
    expect(tray.textContent).toContain("2KB");
    expect(screen.getByTestId("file-estimate").textContent).toBe(
      "첨부 포함 답장 1회 약 31원. 이 대화에서 이어지는 답장마다 약 2원씩 더 듭니다.",
    );
    expect(tray.textContent).toContain("Anthropic(Claude)에 보내지고");
  });

  test("형식과 크기는 미리 걸러 한국어로 말하고 올리지 않는다", async () => {
    await renderChat();
    pick(new File(["x"], "virus.exe"));
    expect((await screen.findByTestId("file-error")).textContent).toContain("지원하지 않는 형식입니다");
    pick(new File([new Uint8Array(2 * 1024 * 1024)], "big.csv"));
    expect((await screen.findByTestId("file-error")).textContent).toContain("파일이 너무 큽니다 (최대 1MB)");
    expect(files.uploadAttachment).not.toHaveBeenCalled();
  });

  test("서버의 거절 문장이 그대로 보인다", async () => {
    files.uploadAttachment.mockRejectedValue(new ApiError("암호가 걸린 PDF는 읽을 수 없습니다.", 400));
    await renderChat();
    pick(new File(["%PDF"], "잠긴.pdf"));
    expect((await screen.findByTestId("file-error")).textContent).toBe(
      "잠긴.pdf: 암호가 걸린 PDF는 읽을 수 없습니다.",
    );
    expect(screen.queryByTestId("file-tray")).toBeNull();
  });

  test("한 번에 다섯 개까지 — 여섯째는 올리지 않는다", async () => {
    let next = 20;
    files.uploadAttachment.mockImplementation(async (_id: number, file: File) => ({
      attachment: attachment(next++, file.name, "text"),
      estimate: ESTIMATE,
    }));
    await renderChat();
    pick(...Array.from({ length: 6 }, (_, i) => new File(["a"], `n${i}.txt`)));
    expect((await screen.findByTestId("file-error")).textContent).toBe("한 번에 5개까지 올릴 수 있습니다.");
    await waitFor(() => expect(files.uploadAttachment).toHaveBeenCalledTimes(5));
  });

  test("✕는 아직 보내지 않은 파일을 지운다", async () => {
    files.uploadAttachment.mockResolvedValue({ attachment: attachment(3, "메모.txt", "text"), estimate: ESTIMATE });
    await renderChat();
    pick(new File(["hi"], "메모.txt"));
    fireEvent.click(await screen.findByRole("button", { name: "메모.txt 빼기" }));
    await waitFor(() => expect(files.deleteAttachment).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByTestId("file-tray")).toBeNull());
  });
});

describe("보내기", () => {
  test("글 없이 파일만으로도 보내고, 파일 id가 함께 가며, 보낸 메시지에 붙는다", async () => {
    files.uploadAttachment
      .mockResolvedValueOnce({ attachment: attachment(5, "사진.jpg", "image"), estimate: ESTIMATE })
      .mockResolvedValueOnce({ attachment: attachment(6, "표.pdf", "pdf"), estimate: ESTIMATE });
    chatApi.sendMessage.mockImplementation(
      async (_id: number, _t: string, handlers: StreamHandlers): Promise<StreamOutcome> => {
        handlers.onStart?.(
          { id: 40, role: "user", content: "", status: "complete", action: null, action_title: "", model_id: null, created_at: "" },
          null,
        );
        return { kind: "error", detail: "목업" };
      },
    );
    await renderChat();
    pick(new File(["j"], "사진.jpg"), new File(["%PDF"], "표.pdf"));
    await waitFor(() => expect(screen.getByTestId("file-tray").textContent).toContain("표.pdf"));

    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(chatApi.sendMessage).toHaveBeenCalled());
    const call = chatApi.sendMessage.mock.calls[0];
    expect(call[1]).toBe("");
    expect(call[4]).toEqual([5, 6]);

    const shown = await screen.findByTestId("message-files");
    const image = shown.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/api/chat/attachments/5/file");
    const download = shown.querySelector("a[download]")!;
    expect(download.getAttribute("href")).toBe("/api/chat/attachments/6/file");
    expect(download.textContent).toContain("3쪽");
    // The composer's chips are gone once the message took the files.
    await waitFor(() => expect(screen.queryByTestId("file-tray")).toBeNull());
  });
});

test("파일 요약 카드는 파일 고르기 창을 연다", async () => {
  await renderChat();
  const input = screen.getByTestId("file-input") as HTMLInputElement;
  const clicked = vi.spyOn(input, "click");
  fireEvent.click(await screen.findByRole("button", { name: /파일 요약/ }));
  expect(clicked).toHaveBeenCalled();
});
