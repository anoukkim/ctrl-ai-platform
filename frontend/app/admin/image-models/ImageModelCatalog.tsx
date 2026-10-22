"use client";

/**
 * Admin › Models › Image (image-generation)
 *
 * 채팅의 이미지 만들기 카드가 어떤 모델을 보여 줄지, 한 장에 얼마인지
 * 정하는 화면입니다.
 *
 * 맨 위 한 줄이 **연결 상태**입니다 — Admin › System의 상태판과 같은 값
 * (`/api/admin/providers`의 image 줄). 테스트 모드(IMAGE_PROVIDER=mock)면
 * Google에 아무것도 보내지 않고 예시 그림만 그립니다. 모델의 "CTRL+AI에서
 * 사용" 스위치는 연결과 별개로, 이 모델을 써도 되는지만 정합니다.
 *
 * 모델마다 카드 하나: 스위치 두 개, 크기별 한 장 가격(원)과 Google의 원가
 * (USD). 저장하면 예시 가격이 확인된 가격이 되고, 모든 변경은 감사 기록에
 * 남습니다.
 */

import { useCallback, useEffect, useState } from "react";

import { type ProviderStatus, listProviders } from "@/lib/admin";
import { type AdminImageModel, listAdminImageModels, updateAdminImageModel } from "@/lib/chat";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import PageHeader from "@/app/components/PageHeader";
import Skeleton from "@/app/components/Skeleton";

import ProviderConnectionNotice, { isConnected } from "../ProviderConnectionNotice";
import { sectionLabel } from "../sections";
import styles from "../admin.module.css";

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

const IMAGE_COPY = {
  mockTitle: "Google Gemini 키가 연결되지 않았어요.",
  mockBody:
    "지금은 예시 그림만 만들어지고 Google에는 아무것도 보내지 않아요(비용 0). 연결: 서버 .env의 IMAGE_PROVIDER · GEMINI_API_KEY · GEMINI_BILLING_CONFIRMED — docs/deployment.md › 이미지 만들기.",
};

export default function ImageModelCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Record<string, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);

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

  const save = useCallback(
    async (model: AdminImageModel, changes: Parameters<typeof updateAdminImageModel>[1]) => {
      setBusyId(model.id);
      setNotice(null);
      try {
        const updated = await updateAdminImageModel(model.id, changes);
        setState((current) =>
          current.phase === "ready"
            ? { ...current, models: current.models.map((m) => (m.id === updated.id ? updated : m)) }
            : current,
        );
        setDrafts((current) => {
          const next = { ...current };
          delete next[model.id];
          return next;
        });
      } catch (error) {
        setNotice(describeError(error));
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  function savePrices(model: AdminImageModel) {
    const draft = drafts[model.id] ?? {};
    const prices: Record<string, number> = { ...model.capabilities.price_per_image_krw };
    for (const size of model.capabilities.sizes) {
      if (draft[size] !== undefined) prices[size] = Number(draft[size]);
    }
    void save(model, { capabilities: { ...model.capabilities, price_per_image_krw: prices } });
  }

  const connected = state.phase === "ready" && isConnected(state.provider);

  return (
    <section>
      <PageHeader
        eyebrow="Admin"
        title={sectionLabel("image-models")}
        subtitle={
          <>
            채팅의 이미지 만들기 카드에 보일 모델과 한 장 가격을 정합니다. 회원에게 열려면 System › 기능
            열기에서 &lsquo;이미지 만들기 (Chat)&rsquo;도 켜야 해요.
          </>
        }
      />

      {state.phase === "loading" && <Skeleton label="모델 목록을 불러오는 중…" />}
      {state.phase === "error" && (
        <div className="card">
          <p className="small muted">모델 목록을 불러오지 못했습니다. {state.message}.</p>
          <button className="btn btn-sm" type="button" onClick={load} style={{ marginTop: "0.6rem" }}>
            다시 시도
          </button>
        </div>
      )}

      {state.phase === "ready" && (
        <>
          <ProviderConnectionNotice provider={state.provider} copy={IMAGE_COPY} />
          {notice && (
            <p className={styles.fieldError} role="alert">
              {notice}
            </p>
          )}

          <div className={styles.imageModels}>
            {state.models.map((model) => {
              const draft = drafts[model.id] ?? {};
              const dirty = Object.keys(draft).length > 0;
              const busy = busyId === model.id;
              const caps = model.capabilities;
              return (
                <article key={model.id} className={`card ${styles.imageModel}`} data-testid="image-model">
                  <header className={styles.imageModelHead}>
                    <div>
                      <h3 className={styles.imageModelName}>
                        {model.display_name}
                        <span className={`badge ${connected ? "badge-ok" : "badge-warn"}`}>
                          {connected ? "연결됨" : "테스트 모드"}
                        </span>
                        {caps.prices_are_examples && (
                          <span
                            className="badge badge-muted"
                            title="아직 아무도 확인하지 않은 예시 가격입니다. 저장하면 확인된 가격이 됩니다."
                          >
                            예시 가격
                          </span>
                        )}
                      </h3>
                      <p className={styles.modelDescription}>{model.description}</p>
                      <p className="small dim mono">
                        {model.provider} · {model.model_id}
                      </p>
                    </div>
                    <div className={styles.imageModelSwitches}>
                      <button
                        className={`badge ${model.enabled ? "badge-ok" : "badge-muted"} ${styles.toggle}`}
                        type="button"
                        onClick={() => void save(model, { enabled: !model.enabled })}
                        disabled={busy}
                        aria-pressed={model.enabled}
                        title="CTRL+AI가 이 모델을 써도 되는지 — 연결 여부와는 별개예요"
                      >
                        {model.enabled ? "CTRL+AI에서 사용" : "사용 안 함"}
                      </button>
                      <button
                        className={`badge ${model.member_visible ? "badge-accent" : "badge-muted"} ${styles.toggle}`}
                        type="button"
                        onClick={() => void save(model, { member_visible: !model.member_visible })}
                        disabled={busy || !model.enabled}
                        aria-pressed={model.member_visible}
                        title={model.enabled ? undefined : "먼저 ‘CTRL+AI에서 사용’을 켜야 공개할 수 있어요"}
                      >
                        {model.member_visible ? "회원에게 공개" : "회원에게 숨김"}
                      </button>
                    </div>
                  </header>

                  <div className={styles.imagePrices}>
                    <span className={styles.fieldLabel}>크기</span>
                    <span className={styles.fieldLabel}>한 장 가격 (회원에게)</span>
                    <span className={styles.fieldLabel}>Google 원가</span>
                    {caps.sizes.map((size) => (
                      <div key={size} className={styles.imagePriceRow}>
                        <span className="mono">{size}</span>
                        <span className={styles.imagePriceInput}>
                          <input
                            className="field"
                            type="number"
                            min={1}
                            max={10000}
                            inputMode="numeric"
                            aria-label={`${model.display_name} ${size} 한 장 가격(원)`}
                            value={draft[size] ?? String(caps.price_per_image_krw[size] ?? "")}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [model.id]: { ...(current[model.id] ?? {}), [size]: event.target.value },
                              }))
                            }
                          />
                          <span className="small dim">원</span>
                        </span>
                        <span className="small muted mono">
                          {caps.usd_per_image[size] !== undefined ? `$${caps.usd_per_image[size]}` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <footer className={styles.imageModelFoot}>
                    <span className="small dim">
                      {caps.sizes
                        .map((size) => `${size} ${formatKrw(caps.price_per_image_krw[size] ?? 0)}`)
                        .join(" · ")}
                    </span>
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => savePrices(model)}
                      disabled={busy || (!dirty && !caps.prices_are_examples)}
                    >
                      {caps.prices_are_examples && !dirty ? "이 가격으로 확인" : "가격 저장"}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>

          <p className="small dim" style={{ marginTop: "0.8rem" }}>
            회원에게는 &lsquo;CTRL+AI에서 사용&rsquo;과 &lsquo;회원에게 공개&rsquo;가 모두 켜진 모델만 보입니다.
            예시 가격은 Google의 공시 가격(USD)을 약 1,400원/$로 바꿔 올림한 값이에요. 모든 변경은 감사 기록에
            남습니다.
          </p>
        </>
      )}
    </section>
  );
}
