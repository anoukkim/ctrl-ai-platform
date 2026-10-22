/**
 * A provider's row on Admin › System's board, as one card of a
 * `StatusStrip` (admin-ui-unify). Shared by Models › Chat · Video · Image
 * and System, so "연결됨 / 테스트 모드" reads the same everywhere.
 */

import type { ProviderStatus } from "@/lib/admin";

import type { StatusItem } from "./AdminUI";

export function isConnected(provider: ProviderStatus | null): boolean {
  return provider !== null && !provider.is_mock && provider.has_key;
}

export function providerStatusItem(
  provider: ProviderStatus | null,
  copy: { name?: string; mock: string; mockState?: string },
): StatusItem | null {
  if (provider === null) return null;
  const name = copy.name ?? provider.name;
  if (provider.is_mock) {
    return { key: provider.key, name, tone: "warn", state: copy.mockState ?? "테스트 모드", note: copy.mock };
  }
  if (!provider.has_key) {
    return { key: provider.key, name, tone: "err", state: "키 없음", note: `${provider.setting}이 실제 연결인데 키가 없어요.` };
  }
  if (provider.last_error_message) {
    return { key: provider.key, name, tone: "err", state: "오류", note: `마지막 오류: ${provider.last_error_message}` };
  }
  return {
    key: provider.key,
    name,
    tone: "ok",
    state: "연결됨",
    note: provider.last_success_label || "System › 상태의 ‘모두 확인’으로 확인할 수 있어요.",
  };
}
