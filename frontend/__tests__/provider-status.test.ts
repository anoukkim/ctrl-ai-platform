/** fix-provider-stale-error: a provider is 오류 only while nothing succeeded after its last error. */

import { describe, expect, test } from "vitest";

import { providerStatusItem } from "@/app/admin/components/providerStatus";
import type { ProviderStatus } from "@/lib/admin";

const base: ProviderStatus = {
  key: "claude",
  name: "Claude",
  purpose: "",
  setting: "CLAUDE_PROVIDER",
  mode: "anthropic",
  is_mock: false,
  has_key: true,
  last_success_at: null,
  last_success_label: "채팅 답변",
  last_error_at: null,
  last_error_message: "",
  balance_label: null,
};

describe("providerStatusItem", () => {
  test("an old error followed by a success is 연결됨", () => {
    const item = providerStatusItem(
      { ...base, last_error_at: "2026-10-21T14:12:05Z", last_error_message: "API 키가 거부되었습니다.", last_success_at: "2026-10-22T02:38:27Z" },
      { mock: "" },
    );
    expect(item?.tone).toBe("ok");
    expect(item?.state).toBe("연결됨");
  });

  test("an error after the last success is 오류", () => {
    const item = providerStatusItem(
      { ...base, last_success_at: "2026-10-21T14:12:05Z", last_error_at: "2026-10-22T02:38:27Z", last_error_message: "API 키가 거부되었습니다." },
      { mock: "" },
    );
    expect(item?.tone).toBe("err");
  });

  test("an error with no success ever is 오류", () => {
    const item = providerStatusItem(
      { ...base, last_error_at: "2026-10-22T02:38:27Z", last_error_message: "시간 초과" },
      { mock: "" },
    );
    expect(item?.state).toBe("오류");
  });
});
