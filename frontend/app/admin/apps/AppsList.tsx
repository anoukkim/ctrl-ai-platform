"use client";

/**
 * Admin › Apps (/admin/apps) — 회원 앱의 기능 상자 (app-platform P4b).
 *
 * 게시된 앱 전부와, 게시하지 않았어도 기능 상자를 쓴 프로젝트(동의가
 * 있거나 AI를 부른 것 — 만든 사람의 미리보기도 포함)가 한 줄씩. 줄을 누르면
 * 앱 하나의 상세로 갑니다 — 멈추기, 데이터, 게시 내리기는 거기서 합니다.
 * Content는 신고 큐만 남았습니다.
 */

import { useEffect, useState } from "react";

import PageHeader from "@/app/components/PageHeader";
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
import AdminTable, { type Column } from "../components/AdminTable";
import { sectionLabel } from "../sections";

import styles from "../admin.module.css";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function AppStateBadges({ app }: { app: AdminAppOverview }) {
  return (
    <>
      {app.published ? (
        <span className="badge badge-ok">게시 v{app.version_number}</span>
      ) : (
        <span className="badge badge-muted">미게시</span>
      )}
      {app.example && <span className="badge badge-muted"> 예시 앱</span>}
      {!app.sdk_enabled && <span className="badge badge-warn"> 기능 상자 멈춤</span>}
      {app.uses_ai && (
        <span className="badge badge-muted" title="만든 사람이 다른 회원에게 AI를 어떻게 열었는지 (app-ai-access)">
          {" "}
          AI {app.ai_access === "full" ? "전체 기능" : "데모만"}
        </span>
      )}
    </>
  );
}

const COLUMNS: Column<AdminAppOverview>[] = [
  {
    key: "name",
    header: "앱",
    render: (app) => (
      <>
        {/* The whole row is already the link (rowHref); a second <a> inside it is invalid HTML. */}
        <strong>{app.name}</strong>{" "}
        <AppStateBadges app={app} />
      </>
    ),
  },
  { key: "owner", header: "만든 사람", render: (app) => app.owner_name },
  {
    key: "ai",
    header: "AI · 이번 분기",
    numeric: true,
    render: (app) =>
      app.ai.quarter_calls > 0 ? `${app.ai.quarter_calls}회 · ${won(app.ai.quarter_krw)}` : "—",
  },
  {
    key: "today",
    header: "AI · 오늘",
    numeric: true,
    render: (app) => (app.ai.today_calls > 0 ? `${app.ai.today_calls}회 · ${won(app.ai.today_krw)}` : "—"),
  },
  {
    key: "preview",
    header: "미리보기 · 이번 분기",
    numeric: true,
    render: (app) =>
      app.ai.preview_quarter_calls > 0
        ? `${app.ai.preview_quarter_calls}회 · ${won(app.ai.preview_quarter_krw)}`
        : "—",
  },
  { key: "consents", header: "동의", numeric: true, render: (app) => (app.consents > 0 ? `${app.consents}명` : "—") },
  {
    key: "data",
    header: "데이터",
    numeric: true,
    render: (app) => (app.data_items > 0 ? `${app.data_items.toLocaleString("ko-KR")}개 · ${formatBytes(app.data_bytes)}` : "—"),
  },
  {
    key: "reports",
    header: "신고",
    render: (app) => (app.open_reports > 0 ? <span className="badge badge-warn">{app.open_reports}</span> : "—"),
  },
  { key: "updated", header: "마지막 변경", render: (app) => (app.updated_at ? relativeTime(app.updated_at) : "—") },
];

export default function AppsList() {
  const [apps, setApps] = useState<AdminAppOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={sectionLabel("apps")}
        subtitle={<>회원 앱의 기능 상자 — AI 사용량(방문자 / 만든 사람의 미리보기), 연결 동의, 데이터, 신고. 줄을 누르면 앱 하나를 다룹니다.</>}
      />
      {error && (
        <p className="small" role="alert">
          {error}
        </p>
      )}
      {apps !== null && (
        <div className={styles.thumbnailMaker} data-testid="thumbnail-maker">
          <button className="btn btn-sm" type="button" onClick={startMaking} disabled={targets.length === 0 || (making !== null && !finished)}>
            {missing.length > 0 || published.length === 0 ? "썸네일 만들기" : "썸네일 다시 만들기"}
          </button>
          <span className="small muted" aria-live="polite">
            {making === null
              ? missing.length > 0
                ? renderer === "server"
                  ? `그림이 없는 게시 앱 ${missing.length}개 — 서버의 브라우저가 하나씩 열어 찍고 저장해요.`
                  : `그림이 없는 게시 앱 ${missing.length}개 — 이 브라우저에서 하나씩 열어 찍고 저장해요.`
                : published.length > 0
                  ? renderer === "server"
                    ? `게시된 앱마다 그림이 있어요 — 다시 만들면 서버의 브라우저가 ${published.length}개를 첫 화면으로 새로 찍어요.`
                    : `게시된 앱마다 그림이 있어요 — 다시 만들면 ${published.length}개를 첫 화면으로 새로 찍어요.`
                  : "게시된 앱이 없어요."
              : finished
                ? `끝 — ${making.done}개 저장${making.failed > 0 ? `, ${making.failed}개 실패 (앱을 열어 다시 찍어 주세요)` : ""}.`
                : `찍는 중 ${making.done + making.failed + 1}/${making.done + making.failed + making.queue.length} — ${current?.name ?? ""}`}
          </span>
          {renderer === "browser" && current && current.app_url && (
            <HiddenCapture
              key={current.id}
              url={`${current.app_url}?v=${encodeURIComponent(current.published_at ?? "")}`}
              onImage={async (image) => {
                finishOne(await adminUploadThumbnail(current.id, image));
              }}
              onDone={() => {
                // onImage took care of success; a failure or a timeout lands here with the queue unchanged.
                setMaking((state) => (state && state.queue[0]?.id === current.id ? { ...state, queue: state.queue.slice(1), failed: state.failed + 1 } : state));
              }}
            />
          )}
        </div>
      )}
      {apps === null && !error ? (
        <p className="small muted">불러오는 중…</p>
      ) : (
        <AdminTable
          columns={COLUMNS}
          rows={apps ?? []}
          rowKey={(app) => app.id}
          rowHref={(app) => `/admin/apps/${app.id}`}
          empty="아직 기능 상자를 쓴 앱이 없습니다. 앱이 게시되거나, 회원이 앱에 로그인하거나 AI를 쓰면 여기에 보여요."
          caption="게시된 앱과 기능 상자를 쓴 프로젝트"
        />
      )}
    </>
  );
}
