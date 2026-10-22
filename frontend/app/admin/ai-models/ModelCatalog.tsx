"use client";

/**
 * Admin › Models › Chat (/admin/models; 예전 /admin/ai-models, /admin/claude-models)
 *
 * 회원이 Chat에서 고를 수 있는 모델을 정하는 화면입니다. 목록은 데이터베이스에
 * 있고 화면에는 모델 이름을 적어 두지 않습니다 — 제공자의 모델 목록은 바뀌기
 * 때문입니다.
 *
 * admin-ui-unify: 맨 위 카드가 제공자마다의 **연결 상태**(Anthropic은 System ›
 * 상태판과 같은 값, 어댑터가 없는 제공자는 "연결 준비 중"), 그 아래 검색 · ? ·
 * + 모델 추가, 그리고 제공자별로 묶은 목록(Anthropic이 먼저). 줄마다 ⋯ 설정을
 * 누르면 오른쪽 판에서 공개 범위, 기본 모델, 이름·설명, 요금, 도구, 순서를
 * 바꿉니다. 연결 전 제공자의 모델은 공개하거나 기본으로 정할 수 없습니다 —
 * 화면은 칸을 꺼 두고, 실제로 막는 것은 백엔드(`admin_chat_models.py`)입니다.
 * 거절되면 그 한국어 이유를 보여 줄 뿐이고, 바꾼 내용은 모두 감사 기록에
 * 남습니다.
 */

import { useCallback, useEffect, useId, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import Skeleton from "@/app/components/Skeleton";
import {
  VISIBILITY_LABEL,
  createChatModel,
  listChatModels,
  listChatProviders,
  listProviders,
  updateChatModel,
  type AdminChatModel,
  type ChatModelVisibility,
  type ChatProvider,
  type ProviderStatus,
} from "@/lib/admin";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import {
  ItemGroup,
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
  type StatusItem,
} from "../components/AdminUI";
import { providerStatusItem } from "../components/providerStatus";

import local from "../models/models.module.css";

type State =
  | { phase: "loading" }
  | { phase: "ready"; models: AdminChatModel[]; providers: ChatProvider[]; claude: ProviderStatus | null }
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
  const [models, providers, board] = await Promise.all([
    listChatModels(),
    listChatProviders(),
    // System 상태판의 Claude 줄 — 읽지 못하면 카드를 안 보일 뿐입니다.
    Promise.resolve()
      .then(() => listProviders())
      .catch(() => [] as ProviderStatus[]),
  ]);
  return { models, providers, claude: (board ?? []).find((row) => row.key === "claude") ?? null };
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

function visibilityTag(visibility: ChatModelVisibility) {
  if (visibility === "members") return <Tag tone="accent">{VISIBILITY_LABEL.members}</Tag>;
  return <Tag>{VISIBILITY_LABEL[visibility]}</Tag>;
}

export default function ModelCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
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

  if (state.phase === "loading") return <Skeleton label="모델 목록을 불러오는 중…" />;
  if (state.phase === "error") {
    return (
      <div className="card">
        <p className="small muted">모델 목록을 불러오지 못했습니다. {state.message}.</p>
        <button className="btn btn-sm" type="button" onClick={() => void load()} style={{ marginTop: "0.6rem" }}>
          다시 시도
        </button>
      </div>
    );
  }

  const { models, providers } = state;
  const shown = models.filter((m) => matchesQuery(query, m.label, m.provider, m.provider_label ?? "", m.model_id));
  const groups = groupByProvider(shown, providers).filter((group) => group.models.length > 0 || !query);
  const defaultModel = models.find((m) => m.is_default) ?? null;

  const status: StatusItem[] = providers
    .map((provider): StatusItem | null => {
      if (!provider.ready) {
        return {
          key: provider.id,
          name: provider.label,
          tone: "off",
          state: "연결 준비 중",
          note: "요금은 미리 적어 둘 수 있지만, 연결될 때까지 공개하거나 기본으로 정할 수 없어요.",
        };
      }
      if (provider.id === "anthropic") {
        return providerStatusItem(state.claude, {
          name: provider.label,
          mock: "키가 없어 정해진 예시 답장만 나와요 · 비용 0 (CLAUDE_PROVIDER)",
        });
      }
      return null;
    })
    .filter((item): item is StatusItem => item !== null);

  const open = models.find((model) => model.id === openId) ?? null;
  const openProvider = open
    ? (providers.find((p) => p.id === open.provider) ?? { id: open.provider, label: open.provider, ready: false })
    : null;

  return (
    <Stack>
      <StatusStrip testId="provider-connection" items={status} />

      <PanelBar
        left={
          models.length > 0 ? (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="이름, 제공자, 모델 ID로 검색"
              resultCount={shown.length}
              totalCount={models.length}
            />
          ) : undefined
        }
        note={`기본 모델: ${defaultModel?.label ?? "없음"}`}
        help={
          <>
            <p id={`${id}-default-rule`}>
              기본 모델은 새 대화와 영상 프롬프트 도움이 씁니다. 회원에게 공개된 모델만 기본이 될 수 있고, 기본 모델의
              공개 범위는 다른 모델을 먼저 기본으로 정해야 바꿀 수 있어요. 회원에게는 &lsquo;회원에게 공개&rsquo; 모델만,
              관리자에게는 &lsquo;관리자만&rsquo; 모델도 보입니다.
            </p>
            <p>
              &lsquo;1회 약&rsquo;은 회원이 모델을 고르는 창에 보이는 값과 같아요. 처음에는 입력 3,000 · 출력 800 토큰으로
              어림하고, 실제 답장이 10회 이상 쌓이면 그 중앙값을 씁니다(Models › 보정).
            </p>
            <p>
              모델은 지우지 않습니다 — 지난 답장과 사용 기록이 가리키고 있으니, 쓰지 않을 모델은 &lsquo;사용 안 함&rsquo;으로
              둡니다. 모든 변경은 감사 기록에 남습니다.
            </p>
          </>
        }
        actions={
          <button className="btn btn-sm btn-primary" type="button" onClick={() => setAdding(true)}>
            + 모델 추가
          </button>
        }
      />

      <ItemList columns={["모델", "입력·출력 $/MTok", "1회 약 · 이번 분기"]} testId="chat-models">
        {groups.map(({ provider, models: rows }) => (
          <ItemGroup
            key={provider.id}
            title={
              <>
                {provider.label} {!provider.ready && <Tag>연결 준비 중</Tag>}
              </>
            }
            meta={
              rows.length === 0
                ? "모델 없음"
                : `모델 ${rows.length}개 · 회원 공개 ${rows.filter((m) => m.visibility === "members").length}개`
            }
          >
            {rows.length === 0 && <p className={local.dim} style={{ padding: "0.6rem 0.9rem" }}>이 제공자의 모델이 아직 없습니다.</p>}
            {rows.map((model) => (
              <ItemRow
                key={model.id}
                testId="chat-model"
                onClick={() => setOpenId(model.id)}
                title={model.label}
                tags={
                  <>
                    {visibilityTag(model.visibility)}
                    {model.is_default && <Tag tone="ok">기본</Tag>}
                  </>
                }
                sub={
                  <>
                    {model.description ? `${model.description} · ` : ""}
                    <Mono>{model.model_id}</Mono>
                  </>
                }
                cells={[
                  {
                    label: "입력·출력 $/MTok",
                    value: (
                      <span className={local.cellLines}>
                        <span>
                          ${Number(model.input_usd_per_mtok)} · ${Number(model.output_usd_per_mtok)}
                        </span>
                        <small>캐시 읽기 ${cacheReadPrice(model)}</small>
                      </span>
                    ),
                  },
                  {
                    label: "1회 약 · 이번 분기",
                    keep: true,
                    value: (
                      <span>
                        {model.estimated_reply_krw === null ? "—" : formatKrw(model.estimated_reply_krw)}
                        {" · "}
                        <span data-testid="model-quarter-krw">
                          {model.quarter_krw ? formatKrw(model.quarter_krw) : "—"}
                        </span>
                      </span>
                    ),
                  },
                ]}
                action={
                  <button
                    className="btn btn-sm"
                    type="button"
                    aria-label={`${model.label} 설정`}
                    onClick={() => setOpenId(model.id)}
                  >
                    ⋯ 설정
                  </button>
                }
              />
            ))}
          </ItemGroup>
        ))}
      </ItemList>

      {open && openProvider && (
        <ModelPanel
          key={open.id}
          model={open}
          provider={openProvider}
          onClose={() => setOpenId(null)}
          onAskDefault={() => askDefault(open)}
          onSaved={async () => {
            setOpenId(null);
            await load();
          }}
        />
      )}

      {adding && (
        <NewModelPanel
          providers={providers}
          onClose={() => setAdding(false)}
          onCreated={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} busy={confirmBusy} error={confirmError} />
    </Stack>
  );
}

/**
 * 한 모델의 설정 판. 공개 범위와 이름·설명·요금·도구·순서는 저장 한 번에,
 * 기본 모델은 확인 창을 거쳐 따로 정합니다(하나뿐이라 다른 모델에서 옮겨 오는
 * 일이기 때문). 저장하면 다음 답장부터 적용됩니다.
 */
function ModelPanel({
  model,
  provider,
  onClose,
  onAskDefault,
  onSaved,
}: {
  model: AdminChatModel;
  provider: ChatProvider;
  onClose: () => void;
  onAskDefault: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const selectId = useId();
  const whyId = useId();
  const [visibility, setVisibility] = useState<ChatModelVisibility>(model.visibility);
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

  // 연결 전 제공자의 행은 열 수 없지만, 어쩌다 열려 있는 행(옛 데이터)은 닫을
  // 수는 있어야 하므로 "사용 안 함"만 남기고 켜 둡니다.
  const visibilityLocked = model.is_default || (!provider.ready && model.visibility === "disabled");
  const visibilityOptions = VISIBILITY_ORDER.filter(
    (value) => provider.ready || value === "disabled" || value === model.visibility,
  );
  const canBeDefault = model.visibility === "members" && provider.ready;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateChatModel(model.id, {
        ...(visibility !== model.visibility ? { visibility } : {}),
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
    <SidePanel
      title={model.label}
      subtitle={<Mono>{`${provider.label} · ${model.model_id}`}</Mono>}
      onClose={onClose}
      testId="chat-model-panel"
      footer={
        <>
          <button className="btn btn-sm" type="button" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button className="btn btn-sm btn-primary" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      <PanelSection title="공개">
        {!provider.ready && (
          <p className={local.dim} id={whyId}>
            아직 연결되지 않은 제공자입니다. 요금은 미리 적어 둘 수 있지만, 연결될 때까지 공개하거나 기본으로 정할 수
            없습니다.
          </p>
        )}
        <label className={local.textField} htmlFor={selectId}>
          공개 범위
          <select
            id={selectId}
            className="field"
            aria-label={`${model.label} 공개 범위`}
            aria-describedby={!provider.ready ? whyId : undefined}
            value={visibility}
            disabled={visibilityLocked || saving}
            onChange={(event) => setVisibility(event.target.value as ChatModelVisibility)}
          >
            {visibilityOptions.map((value) => (
              <option key={value} value={value}>
                {VISIBILITY_LABEL[value]}
              </option>
            ))}
          </select>
          {model.is_default && <small>기본 모델은 다른 모델을 먼저 기본으로 정해야 공개 범위를 바꿀 수 있어요.</small>}
        </label>
        <SwitchRow
          label="기본 모델"
          hint={
            model.is_default
              ? "새 대화와 영상 프롬프트 도움이 이 모델을 써요"
              : canBeDefault
                ? "켜면 확인 창이 뜨고, 확인하면 바로 바뀝니다"
                : "회원에게 공개된 모델만 기본이 될 수 있어요"
          }
          checked={model.is_default}
          disabled={model.is_default || !canBeDefault || saving}
          onChange={(next) => {
            if (next) onAskDefault();
          }}
          testId="chat-model-default"
        />
      </PanelSection>

      <PanelSection title="회원에게 보이는 것">
        <label className={local.textField}>
          회원이 보는 이름
          <input className="field" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className={local.textField}>
          한 줄 설명
          <input
            className="field"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <NumField label="순서" hint="작을수록 위" value={order} onChange={setOrder} inputMode="numeric" type="text" />
      </PanelSection>

      <PanelSection title="요금 ($ / 100만 토큰)">
        <NumField label="입력 요금" unit="$" value={input} onChange={setInput} inputMode="decimal" type="text" />
        <NumField label="출력 요금" unit="$" value={output} onChange={setOutput} inputMode="decimal" type="text" />
        <NumField
          label="캐시 읽기 요금"
          hint="따로 정하지 않은 모델은 입력의 1/10"
          unit="$"
          value={cacheRead}
          onChange={setCacheRead}
          inputMode="decimal"
          type="text"
        />
        <NumField
          label="웹 검색 1회 요금"
          unit="$"
          value={searchCall}
          onChange={setSearchCall}
          inputMode="decimal"
          type="text"
        />
      </PanelSection>

      <PanelSection title="도구">
        <p className={local.dim}>회원이 대화에서 켤 수 있어요 (지금은 테스트 모드). 켜 두어도 대화마다 따로 켜야 쓰입니다.</p>
        <SwitchRow label="웹 검색" checked={webSearch} onChange={setWebSearch} />
        <SwitchRow label="페이지 읽기" checked={webFetch} onChange={setWebFetch} />
        <SwitchRow label="코드 실행" checked={codeExec} onChange={setCodeExec} />
      </PanelSection>

      <p className={local.dim}>
        요금을 바꾸면 다음 답장부터 적용되고, 이미 차감된 기록은 그대로입니다. 감사 기록에 남습니다.
      </p>
      {error && (
        <p className={local.error} role="alert">
          {error}
        </p>
      )}
    </SidePanel>
  );
}

/**
 * 새 모델 추가. **제공자를 먼저 고릅니다** — 모델 ID의 모양과, 연결 전인
 * 제공자인지가 거기에 달려 있습니다. 들어간 모델은 "사용 안 함"으로
 * 시작합니다.
 */
function NewModelPanel({
  providers,
  onClose,
  onCreated,
}: {
  providers: ChatProvider[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [provider, setProvider] = useState("");
  const [draft, setDraft] = useState(EMPTY_NEW);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = providers.find((item) => item.id === provider);

  const ready =
    provider && draft.model_id.trim() && draft.label.trim() && draft.input_usd_per_mtok && draft.output_usd_per_mtok;

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

  const set = (key: keyof typeof EMPTY_NEW) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <SidePanel
      title="모델 추가"
      subtitle="새 모델은 ‘사용 안 함’으로 들어가요. 확인한 뒤 공개 범위를 바꿔 주세요."
      onClose={onClose}
      testId="chat-model-new"
      footer={
        <>
          <button className="btn btn-sm" type="button" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button className="btn btn-sm btn-primary" type="button" onClick={() => void save()} disabled={saving || !ready}>
            {saving ? "추가 중…" : "추가"}
          </button>
        </>
      }
    >
      <PanelSection title="제공자">
        <label className={local.textField}>
          제공자
          <select className="field" value={provider} onChange={(event) => setProvider(event.target.value)} autoFocus>
            <option value="">제공자를 먼저 고르세요</option>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.ready ? "" : " — 연결 준비 중"}
              </option>
            ))}
          </select>
        </label>
        {chosen && !chosen.ready && (
          <p className={local.dim}>
            이 제공자는 아직 연결되지 않았습니다. 모델을 적어 둘 수는 있지만, 연결될 때까지 &quot;사용 안 함&quot;으로
            남습니다.
          </p>
        )}
      </PanelSection>
      {chosen && (
        <>
          <PanelSection title="모델">
            <label className={local.textField}>
              {`모델 ID (${chosen.label})`}
              <input
                className="field numeric"
                value={draft.model_id}
                placeholder={chosen.id === "anthropic" ? "claude-…" : "provider/model-…"}
                onChange={(e) => set("model_id")(e.target.value)}
              />
            </label>
            <label className={local.textField}>
              회원이 보는 이름
              <input className="field" value={draft.label} maxLength={60} onChange={(e) => set("label")(e.target.value)} />
            </label>
            <label className={local.textField}>
              한 줄 설명
              <input
                className="field"
                value={draft.description}
                maxLength={200}
                onChange={(e) => set("description")(e.target.value)}
              />
            </label>
          </PanelSection>
          <PanelSection title="요금 ($ / 100만 토큰)">
            <NumField
              label="입력 요금"
              unit="$"
              value={draft.input_usd_per_mtok}
              onChange={set("input_usd_per_mtok")}
              inputMode="decimal"
              type="text"
            />
            <NumField
              label="출력 요금"
              unit="$"
              value={draft.output_usd_per_mtok}
              onChange={set("output_usd_per_mtok")}
              inputMode="decimal"
              type="text"
            />
          </PanelSection>
        </>
      )}
      {error && (
        <p className={local.error} role="alert">
          {error}
        </p>
      )}
    </SidePanel>
  );
}
