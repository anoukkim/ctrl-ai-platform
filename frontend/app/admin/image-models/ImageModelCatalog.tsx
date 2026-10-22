"use client";

/**
 * Admin › Models › Image (image-generation; admin-ui-unify)
 *
 * 채팅의 이미지 만들기 카드가 어떤 모델을 보여 줄지, 한 장에 얼마인지
 * 정하는 화면입니다. 맨 위 카드가 Google Gemini **연결 상태**(Admin ›
 * System 상태판과 같은 값)이고, 목록의 줄마다 ⋯ 설정을 누르면 오른쪽 판에서
 * 스위치와 크기별 한 장 가격을 바꿉니다. "CTRL+AI에서 사용"은 이 모델을
 * 써도 되는지만 정할 뿐 연결과는 별개예요. 저장하면 예시 가격이 확인된
 * 가격이 되고, 모든 변경은 감사 기록에 남습니다.
 */

import { useCallback, useEffect, useState } from "react";

import { type ProviderStatus, listProviders } from "@/lib/admin";
import { type AdminImageModel, listAdminImageModels, updateAdminImageModel } from "@/lib/chat";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import Skeleton from "@/app/components/Skeleton";

import {
  ItemList,
  ItemRow,
  Mono,
  NumField,
  PanelBar,
  PanelSection,
  SidePanel,
  Stack,
  StatusStrip,
  SwitchRow,
  Tag,
} from "../components/AdminUI";
import { providerStatusItem } from "../components/providerStatus";

type State =
  | { phase: "loading" }
  | { phase: "ready"; models: AdminImageModel[]; provider: ProviderStatus | null }
  | { phase: "error"; message: string };

async function loadAll(): Promise<{ models: AdminImageModel[]; provider: ProviderStatus | null }> {
  const [models, providers] = await Promise.all([
    listAdminImageModels(),
    listProviders().catch(() => [] as ProviderStatus[]),
  ]);
  return { models, provider: providers.find((row) => row.key === "image") ?? null };
}

function prices(model: AdminImageModel): string {
  return model.capabilities.sizes
    .map((size) => `${size} ${formatKrw(model.capabilities.price_per_image_krw[size] ?? 0)}`)
    .join(" · ");
}

function ImageModelPanel({
  model,
  onClose,
  onSaved,
}: {
  model: AdminImageModel;
  onClose: () => void;
  onSaved: (model: AdminImageModel) => void;
}) {
  const caps = model.capabilities;
  const [enabled, setEnabled] = useState(model.enabled);
  const [visible, setVisible] = useState(model.member_visible);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(caps.sizes.map((size) => [size, String(caps.price_per_image_krw[size] ?? "")])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 예시 가격을 그대로 확인할 때만 가격을 보냅니다(바꾸지 않았어도).
  const [confirmPrices, setConfirmPrices] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Only what changed: sending the prices confirms them (the backend
      // clears 예시 가격), so a switch alone must not send them.
      const nextPrices = Object.fromEntries(caps.sizes.map((size) => [size, Number(draft[size])]));
      const pricesChanged = caps.sizes.some((size) => nextPrices[size] !== caps.price_per_image_krw[size]);
      const changes: Parameters<typeof updateAdminImageModel>[1] = {};
      if (enabled !== model.enabled) changes.enabled = enabled;
      if ((enabled && visible) !== model.member_visible) changes.member_visible = enabled && visible;
      if (pricesChanged || confirmPrices) changes.capabilities = { ...caps, price_per_image_krw: nextPrices };
      if (Object.keys(changes).length === 0) {
        onClose();
        return;
      }
      const updated = await updateAdminImageModel(model.id, changes);
      onSaved(updated);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel
      title={model.display_name}
      subtitle={<Mono>{`${model.provider} · ${model.model_id}`}</Mono>}
      onClose={onClose}
      testId="image-model-panel"
      footer={
        <>
          <button className="btn btn-sm" type="button" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-sm btn-primary" type="button" onClick={() => void save()} disabled={busy}>
            저장
          </button>
        </>
      }
    >
      <PanelSection title="공개">
        <SwitchRow
          label="CTRL+AI에서 사용"
          hint="이 모델을 써도 되는지 — 연결 여부와는 별개예요"
          checked={enabled}
          onChange={(next) => {
            setEnabled(next);
            if (!next) setVisible(false);
          }}
        />
        <SwitchRow
          label="회원에게 공개"
          hint="켜야 채팅의 이미지 카드에 보여요"
          checked={visible}
          disabled={!enabled}
          onChange={setVisible}
        />
      </PanelSection>
      <PanelSection title="한 장 가격">
        {caps.sizes.map((size) => (
          <NumField
            key={size}
            label={size}
            hint={caps.usd_per_image[size] !== undefined ? `Google 원가 $${caps.usd_per_image[size]}` : undefined}
            unit="원"
            min={1}
            max={10000}
            value={draft[size] ?? ""}
            ariaLabel={`${model.display_name} ${size} 한 장 가격(원)`}
            onChange={(value) => setDraft((current) => ({ ...current, [size]: value }))}
          />
        ))}
        {caps.prices_are_examples ? (
          <SwitchRow
            label="이 가격이 맞아요"
            hint="켜고 저장하면 ‘예시 가격’ 표시가 사라져요 (가격을 바꿔도 사라져요)"
            checked={confirmPrices}
            onChange={setConfirmPrices}
          />
        ) : (
          <p className="small dim" style={{ margin: 0 }}>
            가격을 바꾸면 다음 그림부터 적용되고 감사 기록에 남습니다.
          </p>
        )}
      </PanelSection>
      {error && (
        <p className="small" role="alert" style={{ color: "var(--error-text)", margin: 0 }}>
          {error}
        </p>
      )}
    </SidePanel>
  );
}

export default function ImageModelCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    loadAll()
      .then((value) => setState({ phase: "ready", ...value }))
      .catch((error: unknown) => setState({ phase: "error", message: describeError(error) }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAll()
      .then((value) => !cancelled && setState({ phase: "ready", ...value }))
      .catch((error: unknown) => !cancelled && setState({ phase: "error", message: describeError(error) }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "loading") return <Skeleton label="모델 목록을 불러오는 중…" />;
  if (state.phase === "error") {
    return (
      <div className="card">
        <p className="small muted">모델 목록을 불러오지 못했습니다. {state.message}.</p>
        <button className="btn btn-sm" type="button" onClick={load} style={{ marginTop: "0.6rem" }}>
          다시 시도
        </button>
      </div>
    );
  }

  const open = state.models.find((model) => model.id === openId) ?? null;

  return (
    <Stack>
      <StatusStrip
        testId="provider-connection"
        items={[
          providerStatusItem(state.provider, {
            name: "Google Gemini",
            mock: "키가 없어 예시 그림만 나와요 · 비용 0 · 회원에게 열려면 System › 기능 열기",
          }),
        ].filter((item) => item !== null)}
      />
      <PanelBar
        note="채팅의 이미지 만들기 카드에 보일 모델"
        help={
          <>
            <p>
              회원에게는 &lsquo;CTRL+AI에서 사용&rsquo;과 &lsquo;회원에게 공개&rsquo;가 모두 켜진 모델만 보여요. 회원에게
              열려면 System › 기능 열기 › 이미지 만들기 (Chat)도 켜야 해요.
            </p>
            <p>
              예시 가격은 Google의 공시 가격(USD)을 약 1,400원/$로 바꿔 올림한 값이에요. 연결: 서버 .env의 IMAGE_PROVIDER ·
              GEMINI_API_KEY · GEMINI_BILLING_CONFIRMED (docs/deployment.md › 이미지 만들기). 모든 변경은 감사 기록에 남습니다.
            </p>
          </>
        }
      />
      <ItemList columns={["모델", "Google 원가 (1K)", "한 장 가격"]} testId="image-models">
        {state.models.map((model) => (
          <ItemRow
            key={model.id}
            testId="image-model"
            onClick={() => setOpenId(model.id)}
            title={model.display_name}
            tags={
              <>
                {!model.enabled ? (
                  <Tag>사용 안 함</Tag>
                ) : model.member_visible ? (
                  <Tag tone="accent">회원에게 공개</Tag>
                ) : (
                  <Tag>숨김</Tag>
                )}
                {model.capabilities.prices_are_examples && <Tag tone="warn">예시 가격</Tag>}
              </>
            }
            sub={
              <>
                {model.description} · <Mono>{`${model.provider}/${model.model_id}`}</Mono>
              </>
            }
            cells={[
              {
                label: "원가 1K",
                value: model.capabilities.usd_per_image["1K"] !== undefined ? `$${model.capabilities.usd_per_image["1K"]}` : "—",
              },
              { label: "한 장", value: prices(model), keep: true },
            ]}
            action={
              <button className="btn btn-sm" type="button" onClick={() => setOpenId(model.id)}>
                ⋯ 설정
              </button>
            }
          />
        ))}
      </ItemList>
      {open && (
        <ImageModelPanel
          key={open.id}
          model={open}
          onClose={() => setOpenId(null)}
          onSaved={(updated) => {
            setState((current) =>
              current.phase === "ready"
                ? { ...current, models: current.models.map((m) => (m.id === updated.id ? updated : m)) }
                : current,
            );
            setOpenId(null);
          }}
        />
      )}
    </Stack>
  );
}
