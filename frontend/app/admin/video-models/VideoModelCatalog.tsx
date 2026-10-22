"use client";

/**
 * Admin › Models › Video (admin-ui-unify)
 *
 * 회원에게 어떤 영상 모델을 열어 줄지 정하는 화면입니다. 목록은
 * 데이터베이스에 있고, 화면에 모델 이름을 적어 두지 않습니다 — 제공자의
 * 모델 목록은 바뀌기 때문입니다.
 *
 * 맨 위 카드가 Higgsfield **연결 상태**(Admin › System 상태판과 같은 값)
 * 입니다. 실제 연결(Phase 6)이 아직 없어 지금은 테스트 모드예요. 줄의
 * ⋯ 설정을 누르면 오른쪽 판이 열립니다:
 *   CTRL+AI에서 사용 — CTRL+AI가 이 모델을 호출해도 되는가 (연결과는 별개)
 *   회원에게 공개   — 회원이 직접 고를 수 있는가
 * 그리고 카탈로그 항목(길이·비율·화질·소리, 수정·이어서, 기본값, 화질별
 * 초당 가격). 아직 아무도 확인하지 않은 가격에는 "예시 가격"이 붙습니다.
 */

import { useCallback, useEffect, useState } from "react";

import { type ProviderStatus, listProviders } from "@/lib/admin";
import { describeError, listAdminVideoModels, updateAdminVideoModel, type AdminVideoModel } from "@/lib/projects";
import { formatKrw } from "@/lib/quarters";

import SearchBar, { matchesQuery } from "@/app/components/SearchBar";
import Skeleton from "@/app/components/Skeleton";

import {
  ItemList,
  ItemRow,
  Mono,
  PanelBar,
  PanelSection,
  SidePanel,
  Stack,
  StatusStrip,
  SwitchRow,
  Tag,
} from "../components/AdminUI";
import { providerStatusItem } from "../components/providerStatus";
import VideoModelEditor from "./VideoModelEditor";

type State =
  | { phase: "loading" }
  | { phase: "ready"; models: AdminVideoModel[]; provider: ProviderStatus | null }
  | { phase: "error"; message: string };

/** Admin › System 상태판의 영상 줄 — 읽지 못하면 카드를 안 보일 뿐입니다. */
function videoProvider(): Promise<ProviderStatus | null> {
  return listProviders()
    .then((rows) => rows.find((row) => row.key === "video") ?? null)
    .catch(() => null);
}

function options(model: AdminVideoModel): string {
  const caps = model.capabilities;
  return [
    `${caps.durations.join("·")}초`,
    caps.aspect_ratios.join(" "),
    caps.sound ? "소리" : "",
    caps.supports_edit ? "수정" : "",
    caps.supports_extend ? "이어서" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function prices(model: AdminVideoModel): string {
  return model.capabilities.resolutions
    .map((resolution) => `${resolution} ${formatKrw(model.capabilities.price_per_second_krw[resolution] ?? 0)}`)
    .join(" · ");
}

export default function VideoModelCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const replace = useCallback((updated: AdminVideoModel) => {
    setState((current) =>
      current.phase === "ready"
        ? { ...current, models: current.models.map((m) => (m.id === updated.id ? updated : m)) }
        : current,
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const [models, provider] = await Promise.all([listAdminVideoModels(), videoProvider()]);
      setState({ phase: "ready", models, provider });
    } catch (error) {
      setState({ phase: "error", message: describeError(error) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listAdminVideoModels(), videoProvider()])
      .then(([models, provider]) => {
        if (!cancelled) setState({ phase: "ready", models, provider });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ phase: "error", message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    async (model: AdminVideoModel, field: "enabled" | "member_visible", next: boolean) => {
      setBusy(true);
      setPanelError(null);
      try {
        replace(await updateAdminVideoModel(model.id, { [field]: next }));
      } catch (error) {
        setPanelError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [replace],
  );

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

  const shown = state.models.filter((m) => matchesQuery(query, m.display_name, m.provider, m.model_id));
  const open = state.models.find((model) => model.id === openId) ?? null;

  return (
    <Stack>
      <StatusStrip
        testId="provider-connection"
        items={[
          providerStatusItem(state.provider, {
            name: "Higgsfield",
            mockState: "연결 전 · 테스트 모드",
            mock: "실제 연결(Phase 6)이 아직 없어 예시 영상만 나와요 · 비용 0 · Video Generator는 회원에게 잠겨 있어요",
          }),
        ].filter((item) => item !== null)}
      />
      <PanelBar
        left={
          state.models.length > 0 && (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="모델 이름, 제공자, 모델 ID로 검색"
              resultCount={shown.length}
              totalCount={state.models.length}
            />
          )
        }
        help={
          <>
            <p>
              회원에게는 &lsquo;CTRL+AI에서 사용&rsquo;과 &lsquo;회원에게 공개&rsquo;가 모두 켜진 모델만 보여요. 사용을 끄면
              공개도 함께 꺼집니다.
            </p>
            <p>
              모델 ID는 여기서 바꾸지 않습니다 — 이미 만든 영상이 가리키는 값이기 때문이에요. &lsquo;예시 가격&rsquo;은 아직
              아무도 확인하지 않은 값이고, 설정에서 저장하면 확인된 가격이 됩니다.
            </p>
          </>
        }
      />
      <ItemList columns={["모델", "길이 · 비율", "초당 가격"]} empty={shown.length === 0 ? "찾는 모델이 없어요." : undefined}>
        {shown.map((model) => (
          <ItemRow
            key={model.id}
            testId="video-model"
            onClick={() => {
              setPanelError(null);
              setOpenId(model.id);
            }}
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
              { label: "길이 · 비율", value: options(model) },
              { label: "초당", value: prices(model), keep: true },
            ]}
            action={
              <button className="btn btn-sm" type="button" onClick={() => {
              setPanelError(null);
              setOpenId(model.id);
            }}>
                ⋯ 설정
              </button>
            }
          />
        ))}
      </ItemList>

      {open && (
        <SidePanel
          key={open.id}
          width="wide"
          title={open.display_name}
          subtitle={<Mono>{`${open.provider} · ${open.model_id} · 순서 ${open.sort_order}`}</Mono>}
          onClose={() => {
            setOpenId(null);
            setPanelError(null);
          }}
          testId="video-model-panel"
        >
          <PanelSection title="공개">
            <SwitchRow
              label="CTRL+AI에서 사용"
              hint="이 모델을 써도 되는지 — 연결 여부와는 별개예요"
              checked={open.enabled}
              disabled={busy}
              onChange={(next) => void toggle(open, "enabled", next)}
            />
            <SwitchRow
              label="회원에게 공개"
              hint={open.enabled ? "켜야 Video Generator에 보여요" : "먼저 ‘CTRL+AI에서 사용’을 켜야 해요"}
              checked={open.member_visible}
              disabled={busy || !open.enabled}
              onChange={(next) => void toggle(open, "member_visible", next)}
            />
            {panelError && (
              <p className="small" role="alert" style={{ color: "var(--error-text)", margin: 0 }}>
                {panelError}
              </p>
            )}
          </PanelSection>
          <PanelSection title="길이 · 비율 · 화질 · 가격">
            <VideoModelEditor
              model={open}
              onSaved={(updated) => {
                replace(updated);
                setOpenId(null);
              }}
              onCancel={() => setOpenId(null)}
            />
          </PanelSection>
        </SidePanel>
      )}
    </Stack>
  );
}
