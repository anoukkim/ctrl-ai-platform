"use client";

/**
 * Admin — 영상 모델 (/admin/video-models)
 *
 * 회원에게 어떤 영상 모델을 열어 줄지 정하는 화면입니다. 목록은
 * 데이터베이스에 있고, 프런트엔드에는 모델 이름을 적어 두지 않습니다.
 * 제공자의 모델 목록은 바뀌기 때문입니다.
 *
 * 스위치는 두 개이고 뜻이 다릅니다.
 *   사용 가능       — CTRL+AI가 이 모델을 호출해도 되는가
 *   회원에게 공개   — 회원이 직접 고를 수 있는가
 * 회원에게는 둘 다 켜진 모델만 보입니다. 사용 가능을 끄면 백엔드가
 * 회원에게 공개도 함께 끕니다.
 *
 * 모델마다 "설정"을 열면 카탈로그 항목 — 길이·비율·화질·소리, 수정과
 * 이어서 만들기 지원, 기본값, 화질별 초당 가격 — 을 고칠 수 있습니다.
 * 아직 아무도 확인하지 않은 예시 가격에는 "예시"가 붙습니다.
 */

import { Fragment, useCallback, useEffect, useState } from "react";

import {
  describeError,
  listAdminVideoModels,
  updateAdminVideoModel,
  type AdminVideoModel,
} from "@/lib/projects";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import { formatKrw } from "@/lib/quarters";

import VideoModelEditor from "./VideoModelEditor";

import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; models: AdminVideoModel[] }
  | { phase: "error"; message: string };

export default function VideoModelCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const replace = useCallback((updated: AdminVideoModel) => {
    setState((current) =>
      current.phase === "ready"
        ? {
            phase: "ready",
            models: current.models.map((m) => (m.id === updated.id ? updated : m)),
          }
        : current,
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const models = await listAdminVideoModels();
      setState({ phase: "ready", models });
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    }
  }, []);

  // 효과 본문에서 바로 상태를 바꾸지 않도록, 약속이 끝난 뒤에만 반영합니다.
  useEffect(() => {
    let cancelled = false;

    listAdminVideoModels()
      .then((models) => {
        if (!cancelled) setState({ phase: "ready", models });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    async (model: AdminVideoModel, field: "enabled" | "member_visible") => {
      setBusyId(model.id);
      try {
        const updated = await updateAdminVideoModel(model.id, { [field]: !model[field] });
        setState((current) =>
          current.phase === "ready"
            ? {
                phase: "ready",
                models: current.models.map((m) => (m.id === updated.id ? updated : m)),
              }
            : current,
        );
      } catch (error) {
        setState({ phase: "error", message: describeError(error) });
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  return (
    <section>
      <header className="page-header page-header-stacked">
        <h1 className="page-title">{sectionLabel("video-models")}</h1>
        <p className="page-subtitle">
          회원에게 어떤 영상 모델을 열어 줄지 정합니다. 목록은 데이터베이스에 있고, 화면에
          모델 이름을 적어 두지 않습니다 — 제공자의 모델 목록은 바뀌기 때문입니다.
        </p>
      </header>

      {state.phase === "loading" && <p className="small muted">모델 목록을 불러오는 중…</p>}

      {state.phase === "error" && (
        <div className="card">
          <p className="small muted">
            모델 목록을 불러오지 못했습니다. {state.message}.
          </p>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => void load()}
            style={{ marginTop: "0.6rem" }}
          >
            다시 시도
          </button>
        </div>
      )}

      {state.phase === "ready" && (
        <>
          {state.models.length > 0 && (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="모델 이름, 제공자, 모델 ID로 검색"
              resultCount={
                state.models.filter((m) =>
                  matchesQuery(query, m.display_name, m.provider, m.model_id),
                ).length
              }
              totalCount={state.models.length}
            />
          )}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">모델</th>
                  <th scope="col">제공자</th>
                  <th scope="col">모델 ID</th>
                  <th scope="col">사용 가능</th>
                  <th scope="col">회원에게 공개</th>
                  <th scope="col">순서</th>
                  <th scope="col">옵션 · 초당 가격</th>
                  <th scope="col">
                    <span className="sr-only">설정</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.models
                  .filter((model) =>
                    matchesQuery(query, model.display_name, model.provider, model.model_id),
                  )
                  .map((model) => (
                  <Fragment key={model.id}>
                  <tr>
                    <td>
                      <span className={styles.memberName}>
                        {model.display_name}
                        <span className={styles.modelDescription}>{model.description}</span>
                      </span>
                    </td>
                    <td>{model.provider}</td>
                    <td className="numeric">{model.model_id}</td>
                    <td>
                      <button
                        className={`badge ${model.enabled ? "badge-ok" : "badge-muted"} ${
                          styles.toggle
                        }`}
                        type="button"
                        onClick={() => void toggle(model, "enabled")}
                        disabled={busyId === model.id}
                        aria-pressed={model.enabled}
                      >
                        {model.enabled ? "사용 가능" : "사용 안 함"}
                      </button>
                    </td>
                    <td>
                      <button
                        className={`badge ${
                          model.member_visible ? "badge-accent" : "badge-muted"
                        } ${styles.toggle}`}
                        type="button"
                        onClick={() => void toggle(model, "member_visible")}
                        disabled={busyId === model.id || !model.enabled}
                        aria-pressed={model.member_visible}
                        title={
                          model.enabled
                            ? undefined
                            : "먼저 사용 가능으로 바꿔야 회원에게 공개할 수 있습니다"
                        }
                      >
                        {model.member_visible ? "회원에게 공개" : "숨김"}
                      </button>
                    </td>
                    <td className="numeric">{model.sort_order}</td>
                    <td>
                      <span className={styles.modelOptions}>
                        <span>
                          {model.capabilities.durations.join("·")}초 ·{" "}
                          {model.capabilities.aspect_ratios.join(" ")}
                          {model.capabilities.sound ? " · 소리" : ""}
                          {model.capabilities.supports_edit ? " · 수정" : ""}
                          {model.capabilities.supports_extend ? " · 이어서" : ""}
                        </span>
                        <span>
                          {model.capabilities.resolutions
                            .map(
                              (resolution) =>
                                `${resolution} ${formatKrw(
                                  model.capabilities.price_per_second_krw[resolution] ?? 0,
                                )}`,
                            )
                            .join(" · ")}
                          {model.capabilities.prices_are_examples && (
                            <span
                              className="badge badge-warn"
                              title="아직 아무도 확인하지 않은 예시 가격입니다. 저장하면 확인된 가격이 됩니다."
                            >
                              예시
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => setEditingId(editingId === model.id ? null : model.id)}
                        aria-expanded={editingId === model.id}
                      >
                        설정
                      </button>
                    </td>
                  </tr>
                  {editingId === model.id && (
                    <tr>
                      <td colSpan={8}>
                        <VideoModelEditor
                          model={model}
                          onSaved={(updated) => {
                            replace(updated);
                            setEditingId(null);
                          }}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className="small dim" style={{ marginTop: "0.6rem" }}>
            회원에게는 사용 가능과 회원에게 공개가 모두 켜진 모델만 보입니다. 사용 가능을
            끄면 회원에게 공개도 함께 꺼집니다. 모델 ID는 여기서 바꾸지 않습니다 — 이미
            만들어진 버전이 가리키는 값이기 때문입니다.
          </p>
        </>
      )}
    </section>
  );
}
