"use client";

/**
 * 모델 목록 화면 맨 위의 연결 상태 한 줄 (fix-image-models-admin).
 *
 * Admin › System 상태판과 같은 값(`/api/admin/providers`)을 씁니다. 모델의
 * "CTRL+AI에서 사용" 스위치는 이 모델을 써도 되는지만 정하고, 연결 여부는
 * 여기서 봅니다 — 두 가지가 섞여 "키도 없는데 사용 가능?"으로 읽히지 않도록.
 */

import type { ProviderStatus } from "@/lib/admin";

export interface ConnectionCopy {
  /** 테스트 모드일 때의 굵은 문장. */
  mockTitle: string;
  /** 그 뒤의 설명. */
  mockBody: string;
}

export function isConnected(provider: ProviderStatus | null): boolean {
  return provider !== null && !provider.is_mock && provider.has_key;
}

export default function ProviderConnectionNotice({
  provider,
  copy,
}: {
  provider: ProviderStatus | null;
  copy: ConnectionCopy;
}) {
  if (provider === null) return null;
  if (provider.is_mock) {
    return (
      <p className="notice" data-testid="provider-connection">
        <span className="badge badge-warn">테스트 모드</span>
        <span>
          <strong>{copy.mockTitle}</strong> {copy.mockBody}
        </span>
      </p>
    );
  }
  const healthy = provider.has_key && !provider.last_error_message;
  return (
    <p className="notice" data-testid="provider-connection">
      <span className={`badge ${healthy ? "badge-ok" : "badge-warn"}`}>
        {provider.has_key ? `${provider.name} 연결됨` : "키 없음"}
      </span>
      <span>
        {provider.last_error_message
          ? `마지막 오류: ${provider.last_error_message}`
          : provider.last_success_label || "System › 상태에서 ‘모두 확인’으로 연결을 확인할 수 있어요."}
      </span>
    </p>
  );
}
