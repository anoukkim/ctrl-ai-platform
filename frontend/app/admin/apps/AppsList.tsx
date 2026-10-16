"use client";

/**
 * Admin › Apps (/admin/apps) — 회원 앱의 기능 상자 (app-platform P4b).
 *
 * 게시된 앱 전부와, 게시하지 않았어도 기능 상자를 쓴 프로젝트(동의가
 * 있거나 AI를 부른 것 — 만든 사람의 미리보기도 포함)가 한 줄씩. 줄을 누르면
 * 앱 하나의 상세로 갑니다 — 멈추기, 데이터, 게시 내리기는 거기서 합니다.
 * Content는 신고 큐만 남았습니다.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import PageHeader from "@/app/components/PageHeader";
import { describeError } from "@/lib/http";
import { formatBytes, listAdminAppOverview, type AdminAppOverview } from "@/lib/apps";
import { relativeTime } from "@/lib/relative-time";

import AdminTable, { type Column } from "../components/AdminTable";
import { sectionLabel } from "../sections";

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
    </>
  );
}

const COLUMNS: Column<AdminAppOverview>[] = [
  {
    key: "name",
    header: "앱",
    render: (app) => (
      <>
        <Link href={`/admin/apps/${app.id}`}>
          <strong>{app.name}</strong>
        </Link>{" "}
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

  useEffect(() => {
    let cancelled = false;
    listAdminAppOverview()
      .then((rows) => {
        if (!cancelled) setApps(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
