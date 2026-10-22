"use client";

/**
 * Admin › Community › 앱 — 회원 앱의 기능 상자 (app-platform P4b → admin-ui-unify).
 *
 * 게시된 앱 전부와, 게시하지 않았어도 기능 상자를 쓴 프로젝트(동의가
 * 있거나 AI를 부른 것 — 만든 사람의 미리보기도 포함)가 한 줄씩. 줄을 누르면
 * 앱 하나의 상세로 갑니다 — 멈추기, 데이터, 게시 내리기는 거기서 합니다.
 * 맨 위 카드는 숫자 요약과 썸네일 만들기.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { describeError } from "@/lib/http";
import {
  adminRenderThumbnail,
  adminUploadThumbnail,
  formatBytes,
  getThumbnailRenderer,
  listAdminAppOverview,
  type AdminAppOverview,
  type ThumbnailRenderer,
} from "@/lib/apps";
import { relativeTime } from "@/lib/relative-time";

import HiddenCapture from "@/app/builder/[projectId]/HiddenCapture";
import { useAdminQuarterOptional, withQuarter } from "../AdminQuarterProvider";
import { ItemList, ItemRow, PanelBar, Stack, Stats, StatusStrip, Tag, type Tone } from "../components/AdminUI";

import styles from "../community/community.module.css";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const calls = (count: number, krw: number) => (count > 0 ? `${count}회 · ${won(krw)}` : "—");

/** 게시 · 예시 · 멈춤 · AI 공개 — 목록과 상세가 같은 표를 씁니다. */
export function AppStateBadges({ app }: { app: AdminAppOverview }) {
  return (
    <>
      {app.published ? <Tag tone="ok">게시 v{app.version_number}</Tag> : <Tag>미게시</Tag>}
      {app.example && <Tag>예시 앱</Tag>}
      {!app.sdk_enabled && <Tag tone="warn">기능 상자 멈춤</Tag>}
      {app.uses_ai && (
        <Tag tone="accent" title="만든 사람이 다른 회원에게 AI를 어떻게 열었는지 (app-ai-access)">
          AI {app.ai_access === "full" ? "전체 기능" : "데모만"}
        </Tag>
      )}
    </>
  );
}

type Filter = "all" | "published" | "stopped" | "reported";

const FILTERS: { value: Filter; label: string; test: (app: AdminAppOverview) => boolean }[] = [
  { value: "all", label: "전체", test: () => true },
  { value: "published", label: "게시됨", test: (app) => app.published },
  { value: "stopped", label: "멈춤", test: (app) => !app.sdk_enabled },
  { value: "reported", label: "신고 있음", test: (app) => app.open_reports > 0 },
];

export default function AppsList() {
  const router = useRouter();
  const quarter = useAdminQuarterOptional();
  const [apps, setApps] = useState<AdminAppOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // owner-polish-3 (a): 썸네일 만들기 — 그림이 없는 게시 앱을 이 브라우저의 숨은
  // 프레임에 하나씩 띄워 찍고 올립니다. 서버는 회원 코드를 실행하지 않아요.
  const [making, setMaking] = useState<{ queue: AdminAppOverview[]; done: number; failed: number } | null>(null);
  // thumbnail-render-worker: with THUMBNAIL_RENDERER=server the same button
  // asks the server's own browser instead, one app at a time (the server
  // waits for each picture); unknown until the answer arrives → browser.
  const [renderer, setRenderer] = useState<ThumbnailRenderer>("browser");

  const published = (apps ?? []).filter((app) => app.published && app.app_url);
  const missing = published.filter((app) => !app.thumbnail_at);
  // With none missing, the same button takes every published app again —
  // after the first-screen change (2026-10-17) the old pictures are redone.
  const targets = missing.length > 0 ? missing : published;
  const startMaking = () => {
    if (targets.length === 0) return;
    setMaking({ queue: targets, done: 0, failed: 0 });
  };
  const current = making?.queue[0] ?? null;
  const finishOne = (updated: AdminAppOverview | null) => {
    if (updated) setApps((rows) => (rows ?? []).map((row) => (row.id === updated.id ? updated : row)));
    setMaking((state) =>
      state
        ? { queue: state.queue.slice(1), done: state.done + (updated ? 1 : 0), failed: state.failed + (updated ? 0 : 1) }
        : state,
    );
  };
  const finished = making !== null && making.queue.length === 0;

  useEffect(() => {
    let cancelled = false;
    listAdminAppOverview()
      .then((rows) => {
        if (!cancelled) setApps(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    getThumbnailRenderer()
      .then((answer) => {
        if (!cancelled && answer.renderer === "server") setRenderer("server");
      })
      .catch(() => {
        // Unknown → the admin's own browser, which always works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Server mode: ask for the current app's picture and move on — a failure
  // counts as one (the old picture stays) and the queue continues.
  const serverTarget = renderer === "server" ? current : null;
  useEffect(() => {
    if (!serverTarget) return;
    let cancelled = false;
    adminRenderThumbnail(serverTarget.id)
      .then((updated) => {
        if (!cancelled) finishOne(updated);
      })
      .catch(() => {
        if (!cancelled) finishOne(null);
      });
    return () => {
      cancelled = true;
    };
    // finishOne is stable in effect (state setters only); the job is per app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTarget?.id]);

  const where = renderer === "server" ? "서버의 브라우저가" : "이 브라우저에서";
  const thumbNote =
    making === null
      ? missing.length > 0
        ? `그림이 없는 게시 앱 ${missing.length}개 — ${where} 하나씩 열어 찍고 저장해요.`
        : published.length > 0
          ? `게시된 앱마다 그림이 있어요 — 다시 만들면 ${where} ${published.length}개를 첫 화면으로 새로 찍어요.`
          : "게시된 앱이 없어요."
      : finished
        ? `끝 — ${making.done}개 저장${making.failed > 0 ? `, ${making.failed}개 실패 (앱을 열어 다시 찍어 주세요)` : ""}.`
        : `찍는 중 ${making.done + making.failed + 1}/${making.done + making.failed + making.queue.length} — ${current?.name ?? ""}`;
  const thumbState: { tone: Tone; label: string } =
    making !== null && !finished
      ? { tone: "accent", label: "찍는 중" }
      : finished
        ? making.failed > 0
          ? { tone: "warn", label: `${making.failed}개 실패` }
          : { tone: "ok", label: "끝" }
        : missing.length > 0
          ? { tone: "warn", label: `${missing.length}개 없음` }
          : published.length > 0
            ? { tone: "ok", label: "모두 있음" }
            : { tone: "off", label: "게시 앱 없음" };

  const all = apps ?? [];
  const needle = query.trim().toLowerCase();
  const rule = FILTERS.find((item) => item.value === filter) ?? FILTERS[0];
  const visible = all.filter(
    (app) =>
      rule.test(app) &&
      (needle === "" ||
        app.name.toLowerCase().includes(needle) ||
        app.owner_name.toLowerCase().includes(needle) ||
        app.owner_username.toLowerCase().includes(needle)),
  );
  const href = (app: AdminAppOverview) => withQuarter(`/admin/apps/${app.id}`, quarter?.selected?.id);
  const quarterAi = all.reduce((sum, app) => sum + app.ai.quarter_krw, 0);
  const stopped = all.filter((app) => !app.sdk_enabled).length;
  const reports = all.reduce((sum, app) => sum + app.open_reports, 0);

  return (
    <Stack>
      {apps !== null && (
        <>
          <Stats
            items={[
              { key: "apps", value: all.length, label: `앱 · 게시 ${all.filter((app) => app.published).length}` },
              { key: "ai", value: won(quarterAi), label: "방문자 AI · 이번 분기" },
              { key: "stopped", value: stopped, label: "기능 상자 멈춤", tone: stopped > 0 ? "warn" : undefined },
              { key: "reports", value: reports, label: "열린 신고", tone: reports > 0 ? "warn" : undefined },
            ]}
          />
          <StatusStrip
            testId="thumbnail-maker"
            items={[
              {
                key: "thumbs",
                name: "썸네일",
                tone: thumbState.tone,
                state: thumbState.label,
                note: <span aria-live="polite">{thumbNote}</span>,
                action: (
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={startMaking}
                    disabled={targets.length === 0 || (making !== null && !finished)}
                  >
                    {missing.length > 0 || published.length === 0 ? "썸네일 만들기" : "썸네일 다시 만들기"}
                  </button>
                ),
              },
            ]}
          />
        </>
      )}
      {renderer === "browser" && current && current.app_url && (
        <HiddenCapture
          key={current.id}
          url={`${current.app_url}?v=${encodeURIComponent(current.published_at ?? "")}`}
          onImage={async (image) => {
            finishOne(await adminUploadThumbnail(current.id, image));
          }}
          onDone={() => {
            // onImage took care of success; a failure or a timeout lands here with the queue unchanged.
            setMaking((state) =>
              state && state.queue[0]?.id === current.id
                ? { ...state, queue: state.queue.slice(1), failed: state.failed + 1 }
                : state,
            );
          }}
        />
      )}

      <PanelBar
        left={
          <>
            <input
              className={`field ${styles.search}`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="앱 이름, 만든 사람으로 검색"
              aria-label="앱 검색"
            />
            <div className={styles.chips} role="group" aria-label="앱 상태">
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className="chip"
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        }
        note={apps !== null && (needle || filter !== "all") ? `${visible.length} / ${all.length}개` : undefined}
        help={
          <>
            <p>
              게시된 앱과, 게시하지 않았어도 기능 상자를 쓴 프로젝트(로그인 동의, AI — 만든 사람의 미리보기 포함)가 한 줄씩
              보여요. 줄을 누르면 앱 하나를 다뤄요 — 기능 상자 멈추기, 공유 데이터 숨기기 · 지우기, 게시 내리기.
            </p>
            <p>
              방문자의 AI는 각자의 동아리 지원금에서, 미리보기는 만든 사람의 지원금에서 나가요. AI 공개(데모만 · 전체 기능)는
              만든 사람이 게시 메뉴에서 정해요. 썸네일은 게시된 앱의 첫 화면을 찍은 그림이에요 — 서버는 회원 코드를 실행하지
              않아요.
            </p>
          </>
        }
      />

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {apps === null && !error ? (
        <p className="small muted">불러오는 중…</p>
      ) : (
        <ItemList
          testId="admin-apps"
          columns={visible.length > 0 ? ["앱", "방문자 AI · 이번 분기", "오늘", "데이터"] : undefined}
          empty={
            visible.length === 0
              ? all.length === 0
                ? "아직 기능 상자를 쓴 앱이 없습니다. 앱이 게시되거나, 회원이 앱에 로그인하거나 AI를 쓰면 여기에 보여요."
                : "조건에 맞는 앱이 없습니다."
              : undefined
          }
        >
          {visible.map((app) => (
            <ItemRow
              key={app.id}
              testId="admin-app"
              onClick={() => router.push(href(app))}
              title={app.name}
              tags={
                <>
                  <AppStateBadges app={app} />
                  {app.open_reports > 0 && <Tag tone="err">신고 {app.open_reports}</Tag>}
                </>
              }
              sub={[
                app.owner_name,
                app.consents > 0 ? `동의 ${app.consents}명` : null,
                app.ai.preview_quarter_calls > 0
                  ? `미리보기 ${calls(app.ai.preview_quarter_calls, app.ai.preview_quarter_krw)}`
                  : null,
                app.updated_at ? `${relativeTime(app.updated_at)} 변경` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              cells={[
                { label: "방문자 AI · 분기", value: calls(app.ai.quarter_calls, app.ai.quarter_krw), keep: true },
                { label: "오늘", value: calls(app.ai.today_calls, app.ai.today_krw) },
                {
                  label: "데이터",
                  value:
                    app.data_items > 0 ? `${app.data_items.toLocaleString("ko-KR")}개 · ${formatBytes(app.data_bytes)}` : "—",
                },
              ]}
              action={
                <Link className="btn btn-sm" href={href(app)} aria-label={`${app.name} 열기`}>
                  열기
                </Link>
              }
            />
          ))}
        </ItemList>
      )}
    </Stack>
  );
}
