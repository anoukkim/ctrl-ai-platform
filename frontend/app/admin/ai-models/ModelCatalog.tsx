"use client";

/**
 * Admin — AI Models (/admin/ai-models; 예전 /admin/claude-models)
 *
 * 회원이 Chat에서 고를 수 있는 모델을 정하는 화면입니다. Video Models와 같은
 * 모양입니다. 목록은 데이터베이스에 있고 화면에는 모델 이름을 적어 두지
 * 않습니다 — 제공자의 모델 목록은 바뀌기 때문입니다.
 *
 * **제공자별로 묶습니다**(admin-and-nav-cleanup, 2026-10-14). 제목마다 한
 * 제공자, Anthropic(Claude)이 맨 위입니다. 연결(어댑터)이 아직 없는 제공자는
 * "연결 준비 중"으로 보이고, 그 모델은 공개하거나 기본으로 정할 수 없습니다
 * — 화면은 칸을 꺼 두고, 실제로 막는 것은 백엔드입니다.
 *
 * 모델마다 정하는 것, 칸 하나에 컨트롤 하나:
 *   공개 범위  — 회원에게 공개 / 관리자만 / 사용 안 함 (고르는 칸 하나)
 *   기본       — 새 대화와 영상 프롬프트 도움이 쓰는 모델. 하나뿐이고,
 *                회원에게 공개된 모델만 될 수 있습니다.
 *   설정       — 회원이 보는 이름과 설명, 요금(달러, 100만 토큰당), 순서
 *
 * 규칙은 백엔드가 지킵니다(`admin_chat_models.py`). 여기서는 고칠 값을
 * 보내고, 거절되면 그 한국어 이유를 보여 줄 뿐입니다. 바꾼 내용은 모두
 * 감사 기록에 남습니다.
 */

import { Fragment, useCallback, useEffect, useId, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import PageHeader from "@/app/components/PageHeader";
import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import {
  VISIBILITY_LABEL,
  createChatModel,
  listChatModels,
  listChatProviders,
  updateChatModel,
  type AdminChatModel,
  type ChatModelVisibility,
  type ChatProvider,
} from "@/lib/admin";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import Fold, { FoldGroup } from "../components/Fold";
import StatCards from "../components/StatCards";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";
import Skeleton from "@/app/components/Skeleton";

type State =
  | { phase: "loading" }
  | { phase: "ready"; models: AdminChatModel[]; providers: ChatProvider[] }
  | { phase: "error"; message: string };

const VISIBILITY_ORDER: ChatModelVisibility[] = ["members", "admin", "disabled"];

const EMPTY_NEW = {
  model_id: "",
  label: "",
  description: "",
  input_usd_per_mtok: "",
  output_usd_per_mtok: "",
};

/** 제공자 목록에 없는 행(옛 데이터)도 잃지 않도록, 아는 제공자 뒤에 붙입니다. */
function groupByProvider(models: AdminChatModel[], providers: ChatProvider[]) {
  const known = providers.map((provider) => ({
    provider,
    models: models.filter((model) => model.provider === provider.id),
  }));
  const strays = models.filter((model) => !providers.some((p) => p.id === model.provider));
  const extra = [...new Set(strays.map((model) => model.provider))].map((id) => ({
    provider: { id, label: id, ready: false },
    models: strays.filter((model) => model.provider === id),
  }));
  return [...known, ...extra];
}

async function loadAll() {
  const [models, providers] = await Promise.all([listChatModels(), listChatProviders()]);
  return { models, providers };
}

export default function ModelCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const id = useId();

  const load = useCallback(async () => {
    try {
      setState({ phase: "ready", ...(await loadAll()) });
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAll()
      .then((value) => {
        if (!cancelled) setState({ phase: "ready", ...value });
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
  const providers = state.phase === "ready" ? state.providers : [];
  const shown = models.filter((m) =>
    matchesQuery(query, m.label, m.provider, m.provider_label ?? "", m.model_id),
  );
  const groups = groupByProvider(shown, providers).filter(
    (group) => group.models.length > 0 || !query,
  );

  return (
    <section>
      <PageHeader
        eyebrow="Admin"
        title={sectionLabel("ai-models")}
        subtitle={
          <>
            회원이 Chat에서 대화마다 고를 수 있는 모델과 요금을 제공자별로 정합니다. 기본
            모델은 새 대화와 영상 프롬프트 도움이 씁니다.
          </>
        }
        actions={
          <button className="btn btn-sm" type="button" onClick={() => setAdding((open) => !open)}>
            {adding ? "추가 닫기" : "+ 모델 추가"}
          </button>
        }
      />

      {adding && state.phase === "ready" && (
        <NewModelForm
          providers={providers}
          onCreated={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}

      {state.phase === "loading" && <Skeleton label="모델 목록을 불러오는 중…" />}

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
          {/* 한눈에: 펼치지 않아도 보이는 숫자들 (ui-improvements B). */}
          <div style={{ marginBottom: "1rem" }}>
          <StatCards
            cards={[
              { key: "models", label: "모델", value: models.length, unit: "개" },
              {
                key: "open",
                label: "회원 공개",
                value: models.filter((m) => m.visibility === "members").length,
                unit: "개",
              },
              {
                key: "default",
                label: "기본 모델",
                value: models.find((m) => m.is_default)?.label ?? "없음",
              },
              {
                key: "providers",
                label: "제공자",
                value: `${providers.length}곳${
                  providers.some((p) => !p.ready)
                    ? ` · 연결 준비 중 ${providers.filter((p) => !p.ready).length}`
                    : ""
                }`,
              },
            ]}
          />
          </div>

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

          {/* 제공자마다 접는 섹션 하나 (ui-improvements B) — 한 번에 하나만
              펼쳐지고, 펼친 것은 기억됩니다. 검색 중에는 결과가 보여야 하므로
              모두 펼칩니다. */}
          <FoldGroup screen="ai-models" defaultOpen={providers[0]?.id ?? null}>
          {groups.map(({ provider, models: rows }) => {
            const headingId = `${id}-${provider.id}`;
            const open = rows.filter((m) => m.visibility === "members").length;
            return (
              <Fold
                key={provider.id}
                id={provider.id}
                forceOpen={query !== ""}
                title={
                  <>
                    {provider.label}
                    {!provider.ready && <span className="badge badge-muted">연결 준비 중</span>}
                  </>
                }
                summary={
                  rows.length === 0
                    ? "모델 없음"
                    : `모델 ${rows.length}개 · 회원 공개 ${open}개${
                        rows.some((m) => m.is_default) ? " · 기본 모델 있음" : ""
                      }`
                }
              >
                {!provider.ready && (
                  <p className="small dim" id={`${headingId}-why`}>
                    아직 연결되지 않은 제공자입니다. 요금은 미리 적어 둘 수 있지만, 연결될
                    때까지 공개하거나 기본으로 정할 수 없습니다.
                  </p>
                )}
                {rows.length === 0 ? (
                  <p className="small dim">이 제공자의 모델이 아직 없습니다.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">모델</th>
                          <th scope="col">모델 ID</th>
                          <th scope="col">공개 범위</th>
                          <th scope="col">기본</th>
                          <th scope="col">요금 $/100만 토큰</th>
                          <th scope="col">답장 1회 약</th>
                          <th scope="col">이번 분기 사용</th>
                          <th scope="col">
                            <span className="sr-only">설정</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((model) => (
                          <Fragment key={model.id}>
                            <tr>
                              <td>
                                <span className={styles.memberName}>
                                  {model.label}
                                  <span className={styles.modelDescription}>
                                    {model.description}
                                  </span>
                                </span>
                              </td>
                              <td className={`numeric ${styles.modelIdCell}`}>
                                {/* A long "host/model" id may break after the slash. */}
                                {model.model_id.split("/").map((part, index, parts) => (
                                  <Fragment key={index}>
                                    {part}
                                    {index < parts.length - 1 && (
                                      <>
                                        /<wbr />
                                      </>
                                    )}
                                  </Fragment>
                                ))}
                              </td>
                              <td>
                                {/* 연결 전 제공자의 행은 열 수 없지만, 어쩌다 열려
                                    있는 행(옛 데이터)은 닫을 수는 있어야 하므로
                                    "사용 안 함"만 남기고 켜 둡니다. */}
                                <select
                                  className={`field ${styles.visibilitySelect}`}
                                  aria-label={`${model.label} 공개 범위`}
                                  value={model.visibility}
                                  disabled={
                                    busyId === model.id ||
                                    model.is_default ||
                                    (!provider.ready && model.visibility === "disabled")
                                  }
                                  aria-describedby={
                                    !provider.ready
                                      ? `${headingId}-why`
                                      : model.is_default
                                        ? `${id}-default-rule`
                                        : undefined
                                  }
                                  onChange={(event) =>
                                    void setVisibility(model, event.target.value as ChatModelVisibility)
                                  }
                                >
                                  {VISIBILITY_ORDER.filter(
                                    (value) =>
                                      provider.ready ||
                                      value === "disabled" ||
                                      value === model.visibility,
                                  ).map((value) => (
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
                                    disabled={model.visibility !== "members" || !provider.ready}
                                    aria-describedby={
                                      !provider.ready ? `${headingId}-why` : `${id}-default-rule`
                                    }
                                    onClick={() => askDefault(model)}
                                  >
                                    기본으로
                                  </button>
                                )}
                              </td>
                              {/* Two lines, not one: table cells don't wrap, and
                                  all three prices on one line pushed 설정 past
                                  the table's right edge at 1280px. */}
                              <td className="numeric">
                                <span className={styles.priceLine}>
                                  입력 ${Number(model.input_usd_per_mtok)} · 출력 $
                                  {Number(model.output_usd_per_mtok)}
                                </span>
                                <span className={`small dim ${styles.priceLine}`}>
                                  캐시 읽기 ${cacheReadPrice(model)}
                                </span>
                              </td>
                              <td className="numeric">
                                {model.estimated_reply_krw === null
                                  ? "—"
                                  : formatKrw(model.estimated_reply_krw)}
                              </td>
                              <td className="numeric" data-testid="model-quarter-krw">
                                {model.quarter_krw ? formatKrw(model.quarter_krw) : "—"}
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
                )}
              </Fold>
            );
          })}

{/* 비용 보정 moved to Models › 보정 (admin-consolidation v3). */}
          </FoldGroup>

          <p className="small dim" id={`${id}-default-rule`} style={{ marginTop: "0.6rem" }}>
            기본 모델은 회원에게 공개된 모델만 될 수 있고, 기본 모델의 공개 범위는 다른 모델을
            먼저 기본으로 정해야 바꿀 수 있습니다. 회원에게는 &quot;회원에게 공개&quot; 모델만
            보이고, 관리자에게는 &quot;관리자만&quot; 모델도 보입니다. &quot;답장 1회 약&quot;은
            회원이 모델을 고르는 창에 보이는 것과 같은 값으로, 처음에는 입력 3,000 · 출력 800
            토큰으로 어림하고 실제 답장이 10회 이상 쌓이면 그 중앙값을 씁니다(아래 비용 보정).
            모델은 지우지 않습니다 — 지난 답장과 사용 기록이 가리키고 있으니, 쓰지 않을 모델은
            &quot;사용 안 함&quot;으로 둡니다.
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

/**
 * 캐시 읽기 요금. 모델에 따로 적힌 값이 없으면 입력 요금의 1/10 — 백엔드
 * pricing.py와 같은 규칙입니다. 캐시 쓰기 요금은 칸이 없습니다: 언제나 입력
 * 요금의 1.25배(5분) 또는 2배(1시간)입니다.
 */
function cacheReadPrice(model: AdminChatModel): number {
  return model.cache_read_usd_per_mtok !== null
    ? Number(model.cache_read_usd_per_mtok)
    : Number(model.input_usd_per_mtok) / 10;
}

/** 이름·설명·요금·순서를 고치는 칸. 저장하면 다음 답장부터 적용됩니다. */
function ModelEditor({ model, onSaved, onCancel }: EditorProps) {
  const [label, setLabel] = useState(model.label);
  const [description, setDescription] = useState(model.description);
  const [input, setInput] = useState(String(Number(model.input_usd_per_mtok)));
  const [output, setOutput] = useState(String(Number(model.output_usd_per_mtok)));
  const [cacheRead, setCacheRead] = useState(String(cacheReadPrice(model)));
  const [order, setOrder] = useState(String(model.sort_order));
  // 서버 도구(chat-plus-tools): 회원이 대화에서 켤 수 있게 할지.
  const [webSearch, setWebSearch] = useState(model.tools_web_search);
  const [webFetch, setWebFetch] = useState(model.tools_web_fetch);
  const [codeExec, setCodeExec] = useState(model.tools_code_execution);
  const [searchCall, setSearchCall] = useState(String(Number(model.web_search_usd_per_call)));
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
        cache_read_usd_per_mtok: cacheRead,
        sort_order: Number(order),
        tools_web_search: webSearch,
        tools_web_fetch: webFetch,
        tools_code_execution: codeExec,
        web_search_usd_per_call: searchCall,
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
          <span>캐시 읽기 요금 ($/100만 토큰)</span>
          <input
            className={`field numeric ${styles.priceInput}`}
            inputMode="decimal"
            value={cacheRead}
            onChange={(e) => setCacheRead(e.target.value)}
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
        <label className={styles.modelEditorField}>
          <span>웹 검색 1회 요금 ($)</span>
          <input
            className={`field numeric ${styles.priceInput}`}
            inputMode="decimal"
            value={searchCall}
            onChange={(e) => setSearchCall(e.target.value)}
          />
        </label>
      </div>

      {/* 서버 도구 — 회원이 대화에서 켤 수 있는 것(chat-plus-tools).
          켜 두어도 회원이 대화마다 따로 켜야 쓰입니다. */}
      <fieldset className={styles.modelEditorField} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small dim">도구 — 회원이 대화에서 켤 수 있어요 (지금은 테스트 모드)</legend>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <label className="small">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
            />{" "}
            웹 검색
          </label>
          <label className="small">
            <input
              type="checkbox"
              checked={webFetch}
              onChange={(e) => setWebFetch(e.target.checked)}
            />{" "}
            페이지 읽기
          </label>
          <label className="small">
            <input
              type="checkbox"
              checked={codeExec}
              onChange={(e) => setCodeExec(e.target.checked)}
            />{" "}
            코드 실행
          </label>
        </div>
      </fieldset>

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

/**
 * 새 모델 추가. **제공자를 먼저 고릅니다** — 모델 ID의 모양과, 연결 전인
 * 제공자인지가 거기에 달려 있습니다. 들어간 모델은 "사용 안 함"으로
 * 시작합니다.
 */
function NewModelForm({
  providers,
  onCreated,
}: {
  providers: ChatProvider[];
  onCreated: () => void | Promise<void>;
}) {
  const [provider, setProvider] = useState("");
  const [draft, setDraft] = useState(EMPTY_NEW);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = providers.find((item) => item.id === provider);

  const ready =
    provider &&
    draft.model_id.trim() &&
    draft.label.trim() &&
    draft.input_usd_per_mtok &&
    draft.output_usd_per_mtok;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await createChatModel({ provider, ...draft });
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
        <label className={styles.modelEditorField}>
          <span>제공자</span>
          <select
            className="field"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            autoFocus
          >
            <option value="">제공자를 먼저 고르세요</option>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.ready ? "" : " — 연결 준비 중"}
              </option>
            ))}
          </select>
        </label>
      </div>
      {chosen && (
        <>
          {!chosen.ready && (
            <p className="small dim">
              이 제공자는 아직 연결되지 않았습니다. 모델을 적어 둘 수는 있지만, 연결될
              때까지 &quot;사용 안 함&quot;으로 남습니다.
            </p>
          )}
          <div className={styles.modelEditorGrid}>
            {field("model_id", `모델 ID (${chosen.label})`, {
              placeholder: chosen.id === "anthropic" ? "claude-…" : "provider/model-…",
              className: "field numeric",
            })}
            {field("label", "회원이 보는 이름", { maxLength: 60 })}
            {field("description", "한 줄 설명", { maxLength: 200 })}
            {field("input_usd_per_mtok", "입력 요금 ($/100만 토큰)", { inputMode: "decimal" })}
            {field("output_usd_per_mtok", "출력 요금 ($/100만 토큰)", { inputMode: "decimal" })}
          </div>
        </>
      )}
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
