"use client";

/**
 * Admin — Claude 모델 (/admin/claude-models)
 *
 * 회원이 Chat에서 고를 수 있는 모델을 정하는 화면입니다. Video Models와 같은
 * 모양입니다. 목록은 데이터베이스에 있고 화면에는 모델 이름을 적어 두지
 * 않습니다 — 제공자의 모델 목록은 바뀌기 때문입니다.
 *
 * 모델마다 정하는 것:
 *   공개 범위  — 회원에게 공개 / 관리자만 / 사용 안 함
 *   기본 모델  — 새 대화와 영상 프롬프트 도움이 쓰는 모델. 하나뿐이고,
 *                회원에게 공개된 모델만 될 수 있습니다.
 *   설정       — 회원이 보는 이름과 설명, 요금(달러, 100만 토큰당), 순서
 *
 * 규칙은 백엔드가 지킵니다(`admin_chat_models.py`). 여기서는 고칠 값을
 * 보내고, 거절되면 그 한국어 이유를 보여 줄 뿐입니다. 바꾼 내용은 모두
 * 감사 기록에 남습니다.
 */

import { Fragment, useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import PageHeader from "@/app/components/PageHeader";
import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import {
  VISIBILITY_LABEL,
  createChatModel,
  listChatModels,
  updateChatModel,
  type AdminChatModel,
  type ChatModelVisibility,
} from "@/lib/admin";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; models: AdminChatModel[] }
  | { phase: "error"; message: string };

const VISIBILITY_ORDER: ChatModelVisibility[] = ["members", "admin", "disabled"];

const VISIBILITY_BADGE: Record<ChatModelVisibility, string> = {
  members: "badge-accent",
  admin: "badge-warn",
  disabled: "badge-muted",
};

const EMPTY_NEW = {
  model_id: "",
  label: "",
  description: "",
  input_usd_per_mtok: "",
  output_usd_per_mtok: "",
};

export default function ClaudeModelCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState({ phase: "ready", models: await listChatModels() });
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    listChatModels()
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

  const setVisibility = useCallback(
    async (model: AdminChatModel, visibility: ChatModelVisibility) => {
      setBusyId(model.id);
      setRowError(null);
      try {
        await updateChatModel(model.id, { visibility });
        await load();
      } catch (error) {
        setRowError(describeError(error));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const askDefault = (model: AdminChatModel) => {
    setConfirmError(null);
    setConfirm({
      title: `${model.label}을 기본 모델로 정할까요?`,
      effect: [
        "이후 새로 시작하는 대화와 영상 프롬프트 도움이 이 모델을 씁니다.",
        "이미 있는 대화는 회원이 고른 모델을 그대로 씁니다.",
        "감사 기록에 남습니다.",
      ],
      confirmLabel: "기본으로 정하기",
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          await updateChatModel(model.id, { is_default: true });
          await load();
          setConfirm(null);
        } catch (error) {
          setConfirmError(describeError(error));
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const models = state.phase === "ready" ? state.models : [];
  const shown = models.filter((m) => matchesQuery(query, m.label, m.provider, m.model_id));

  return (
    <section>
      <PageHeader
        eyebrow="Admin"
        title={sectionLabel("claude-models")}
        subtitle={
          <>
            회원이 Chat에서 대화마다 고를 수 있는 모델과 요금을 정합니다. 기본 모델은 새 대화와
            영상 프롬프트 도움이 씁니다.
          </>
        }
        actions={
          <button className="btn btn-sm" type="button" onClick={() => setAdding((open) => !open)}>
            {adding ? "추가 닫기" : "+ 모델 추가"}
          </button>
        }
      />

      {adding && (
        <NewModelForm
          onCreated={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}

      {state.phase === "loading" && <p className="small muted">모델 목록을 불러오는 중…</p>}

      {state.phase === "error" && (
        <div className="card">
          <p className="small muted">모델 목록을 불러오지 못했습니다. {state.message}.</p>
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
          {models.length > 0 && (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="이름, 제공자, 모델 ID로 검색"
              resultCount={shown.length}
              totalCount={models.length}
            />
          )}

          {rowError !== null && (
            <p className={styles.modelEditorError} role="alert">
              {rowError}
            </p>
          )}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">모델</th>
                  <th scope="col">제공자</th>
                  <th scope="col">모델 ID</th>
                  <th scope="col">공개 범위</th>
                  <th scope="col">기본</th>
                  <th scope="col">요금 $/100만 토큰</th>
                  <th scope="col">답장 1회 약</th>
                  <th scope="col">
                    <span className="sr-only">설정</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((model) => (
                  <Fragment key={model.id}>
                    <tr>
                      <td>
                        <span className={styles.memberName}>
                          {model.label}
                          <span className={styles.modelDescription}>{model.description}</span>
                        </span>
                      </td>
                      <td>{model.provider}</td>
                      <td className="numeric">{model.model_id}</td>
                      <td>
                        <span className={`badge ${VISIBILITY_BADGE[model.visibility]}`}>
                          {VISIBILITY_LABEL[model.visibility]}
                        </span>{" "}
                        <select
                          className="field"
                          aria-label={`${model.label} 공개 범위`}
                          value={model.visibility}
                          disabled={busyId === model.id || model.is_default}
                          title={
                            model.is_default
                              ? "기본 모델은 회원에게 공개되어 있어야 합니다. 다른 모델을 먼저 기본으로 정하세요."
                              : undefined
                          }
                          onChange={(event) =>
                            void setVisibility(model, event.target.value as ChatModelVisibility)
                          }
                        >
                          {VISIBILITY_ORDER.map((value) => (
                            <option key={value} value={value}>
                              {VISIBILITY_LABEL[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {model.is_default ? (
                          <span className="badge badge-ok">기본</span>
                        ) : (
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={model.visibility !== "members"}
                            title={
                              model.visibility === "members"
                                ? undefined
                                : "회원에게 공개된 모델만 기본으로 정할 수 있습니다"
                            }
                            onClick={() => askDefault(model)}
                          >
                            기본으로
                          </button>
                        )}
                      </td>
                      <td className="numeric">
                        입력 ${Number(model.input_usd_per_mtok)} · 출력 $
                        {Number(model.output_usd_per_mtok)}
                      </td>
                      <td className="numeric">
                        {model.estimated_reply_krw === null
                          ? "—"
                          : formatKrw(model.estimated_reply_krw)}
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
                          <ModelEditor
                            model={model}
                            onSaved={async () => {
                              setEditingId(null);
                              await load();
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
            회원에게는 &quot;회원에게 공개&quot; 모델만 보이고, 관리자에게는 &quot;관리자만&quot;
            모델도 보입니다. &quot;답장 1회 약&quot;은 입력 3,000 · 출력 800 토큰으로 어림한
            값으로, 회원이 모델을 고르는 창에 보이는 것과 같습니다. 모델은 지우지 않습니다 —
            지난 답장과 사용 기록이 가리키고 있으니, 쓰지 않을 모델은 &quot;사용 안 함&quot;으로
            둡니다.
          </p>
        </>
      )}

      <ConfirmDialog
        request={confirm}
        onClose={() => setConfirm(null)}
        busy={confirmBusy}
        error={confirmError}
      />
    </section>
  );
}

interface EditorProps {
  model: AdminChatModel;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}

/** 이름·설명·요금·순서를 고치는 칸. 저장하면 다음 답장부터 적용됩니다. */
function ModelEditor({ model, onSaved, onCancel }: EditorProps) {
  const [label, setLabel] = useState(model.label);
  const [description, setDescription] = useState(model.description);
  const [input, setInput] = useState(String(Number(model.input_usd_per_mtok)));
  const [output, setOutput] = useState(String(Number(model.output_usd_per_mtok)));
  const [order, setOrder] = useState(String(model.sort_order));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateChatModel(model.id, {
        label,
        description,
        input_usd_per_mtok: input,
        output_usd_per_mtok: output,
        sort_order: Number(order),
      });
      await onSaved();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modelEditor}>
      <div className={styles.modelEditorGrid}>
        <label className={styles.modelEditorField}>
          <span>회원이 보는 이름</span>
          <input className="field" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className={styles.modelEditorField}>
          <span>한 줄 설명</span>
          <input
            className="field"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className={styles.modelEditorField}>
          <span>입력 요금 ($/100만 토큰)</span>
          <input
            className={`field numeric ${styles.priceInput}`}
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <label className={styles.modelEditorField}>
          <span>출력 요금 ($/100만 토큰)</span>
          <input
            className={`field numeric ${styles.priceInput}`}
            inputMode="decimal"
            value={output}
            onChange={(e) => setOutput(e.target.value)}
          />
        </label>
        <label className={styles.modelEditorField}>
          <span>순서 (작을수록 위)</span>
          <input
            className={`field numeric ${styles.priceInput}`}
            inputMode="numeric"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className={styles.modelEditorError} role="alert">
          {error}
        </p>
      )}

      <div className={styles.modelEditorActions}>
        <button
          className="btn btn-sm btn-primary"
          type="button"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        <button className="btn btn-sm" type="button" onClick={onCancel} disabled={saving}>
          취소
        </button>
        <span className="small dim">
          요금을 바꾸면 다음 답장부터 적용되고, 이미 차감된 기록은 그대로입니다. 감사 기록에
          남습니다.
        </span>
      </div>
    </div>
  );
}

/** 새 모델 추가. 들어간 모델은 "사용 안 함"으로 시작합니다. */
function NewModelForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [draft, setDraft] = useState(EMPTY_NEW);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    draft.model_id.trim() && draft.label.trim() && draft.input_usd_per_mtok && draft.output_usd_per_mtok;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await createChatModel(draft);
      setDraft(EMPTY_NEW);
      await onCreated();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof EMPTY_NEW, label: string, props: object = {}) => (
    <label className={styles.modelEditorField}>
      <span>{label}</span>
      <input
        className="field"
        value={draft[key]}
        onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))}
        {...props}
      />
    </label>
  );

  return (
    <div className={`card ${styles.modelEditor}`} style={{ marginBottom: "1rem" }}>
      <div className={styles.modelEditorGrid}>
        {field("model_id", "모델 ID (Anthropic)", { placeholder: "claude-…", className: "field numeric" })}
        {field("label", "회원이 보는 이름", { maxLength: 60 })}
        {field("description", "한 줄 설명", { maxLength: 200 })}
        {field("input_usd_per_mtok", "입력 요금 ($/100만 토큰)", { inputMode: "decimal" })}
        {field("output_usd_per_mtok", "출력 요금 ($/100만 토큰)", { inputMode: "decimal" })}
      </div>
      {error && (
        <p className={styles.modelEditorError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.modelEditorActions}>
        <button
          className="btn btn-sm btn-primary"
          type="button"
          onClick={() => void save()}
          disabled={saving || !ready}
        >
          {saving ? "추가 중…" : "추가"}
        </button>
        <span className="small dim">
          새 모델은 &quot;사용 안 함&quot;으로 들어갑니다. 확인한 뒤 공개 범위를 바꿔 주세요.
        </span>
      </div>
    </div>
  );
}
