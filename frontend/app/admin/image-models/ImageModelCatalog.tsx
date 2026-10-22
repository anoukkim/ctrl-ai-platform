"use client";

/**
 * Admin › Models › Image (image-generation)
 *
 * 채팅의 이미지 만들기 카드가 어떤 모델을 보여 줄지, 한 장에 얼마인지
 * 정하는 화면입니다. 영상 모델과 같은 두 스위치(사용 가능 · 회원에게
 * 공개)에, 크기별 한 장 가격(원)을 바로 고칠 수 있습니다. 저장하면 예시
 * 가격이 확인된 가격이 되고, 모든 변경은 감사 기록에 남습니다.
 * 원가(USD)는 제공자의 공시 가격 — 사용 분석의 원가 칸이 이 숫자를 씁니다.
 */

import { useCallback, useEffect, useState } from "react";

import { type AdminImageModel, listAdminImageModels, updateAdminImageModel } from "@/lib/chat";
import { describeError } from "@/lib/http";

import PageHeader from "@/app/components/PageHeader";
import Skeleton from "@/app/components/Skeleton";

import { sectionLabel } from "../sections";
import styles from "../admin.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; models: AdminImageModel[] }
  | { phase: "error"; message: string };

export default function ImageModelCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Record<string, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    listAdminImageModels()
      .then((models) => setState({ phase: "ready", models }))
      .catch((error: unknown) => setState({ phase: "error", message: describeError(error) }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    listAdminImageModels()
      .then((models) => !cancelled && setState({ phase: "ready", models }))
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
            ? { phase: "ready", models: current.models.map((m) => (m.id === updated.id ? updated : m)) }
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

  return (
    <section>
      <PageHeader
        eyebrow="Admin"
        title={sectionLabel("image-models")}
        subtitle={
          <>
            채팅의 이미지 만들기 카드가 보여 줄 모델과 한 장 가격을 정합니다. 회원에게 열려면
            System › 기능 열기에서 &lsquo;이미지 만들기 (Chat)&rsquo;도 켜야 해요.
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
          {notice && (
            <p className="small" role="alert" style={{ color: "var(--error-text)" }}>
              {notice}
            </p>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">모델</th>
                  <th scope="col">모델 ID</th>
                  <th scope="col">사용 가능</th>
                  <th scope="col">회원에게 공개</th>
                  <th scope="col">한 장 가격 (원) · 원가</th>
                  <th scope="col">
                    <span className="sr-only">저장</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.models.map((model) => {
                  const draft = drafts[model.id] ?? {};
                  const dirty = Object.keys(draft).length > 0;
                  return (
                    <tr key={model.id}>
                      <td>
                        <span className={styles.memberName}>
                          {model.display_name}
                          <span className={styles.modelDescription}>{model.description}</span>
                        </span>
                      </td>
                      <td className="numeric">
                        {model.provider}/{model.model_id}
                      </td>
                      <td>
                        <button
                          className={`badge ${model.enabled ? "badge-ok" : "badge-muted"} ${styles.toggle}`}
                          type="button"
                          onClick={() => void save(model, { enabled: !model.enabled })}
                          disabled={busyId === model.id}
                          aria-pressed={model.enabled}
                        >
                          {model.enabled ? "사용 가능" : "사용 안 함"}
                        </button>
                      </td>
                      <td>
                        <button
                          className={`badge ${model.member_visible ? "badge-accent" : "badge-muted"} ${styles.toggle}`}
                          type="button"
                          onClick={() => void save(model, { member_visible: !model.member_visible })}
                          disabled={busyId === model.id || !model.enabled}
                          aria-pressed={model.member_visible}
                        >
                          {model.member_visible ? "회원에게 공개" : "숨김"}
                        </button>
                      </td>
                      <td>
                        <span className={styles.modelOptions}>
                          {model.capabilities.sizes.map((size) => (
                            <label key={size} style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center" }}>
                              {size}
                              <input
                                type="number"
                                min={1}
                                max={10000}
                                inputMode="numeric"
                                aria-label={`${model.display_name} ${size} 한 장 가격(원)`}
                                value={draft[size] ?? String(model.capabilities.price_per_image_krw[size] ?? "")}
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [model.id]: { ...(current[model.id] ?? {}), [size]: event.target.value },
                                  }))
                                }
                                style={{ width: "5.5rem" }}
                              />
                              <span className="small dim">${model.capabilities.usd_per_image[size] ?? "-"}</span>
                            </label>
                          ))}
                          {model.capabilities.prices_are_examples && (
                            <span
                              className="badge badge-warn"
                              title="아직 아무도 확인하지 않은 예시 가격입니다. 저장하면 확인된 가격이 됩니다."
                            >
                              예시
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => savePrices(model)}
                          disabled={busyId === model.id || (!dirty && !model.capabilities.prices_are_examples)}
                        >
                          {model.capabilities.prices_are_examples && !dirty ? "가격 확인" : "저장"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small dim" style={{ marginTop: "0.6rem" }}>
            회원에게는 사용 가능과 회원에게 공개가 모두 켜진 모델만 보입니다. 예시 가격은 Google의 공시
            가격(USD)을 약 1,400원/$로 바꿔 올림한 값이에요. 모든 변경은 감사 기록에 남습니다.
          </p>
        </>
      )}
    </section>
  );
}
