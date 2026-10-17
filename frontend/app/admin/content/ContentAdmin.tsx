"use client";

/**
 * Admin › Content (/admin/content) — 신고와 게시 내리기 (ctrlaiapps-publish).
 *
 * app-platform P4b: 앱 자체(기능 상자 멈추기, 데이터, ZIP 미리보기)는
 * Admin › Apps로 갔습니다. 여기는 신고 큐만 — 신고마다 항목 숨기기,
 * 게시 내리기, 신고 닫기.
 *
 * 열린 신고를 먼저, 그 아래 CtrlAIApps에 올라 있는 앱 전부. 앱을 내리면
 * (감사 기록에 남음) 만든 사람에게는 게시 취소와 같아서 버전은 모두 남고
 * 다시 게시할 수 있습니다. 신고만 닫고 앱을 두는 것도 기록에 남습니다.
 *
 * 숨기더라도 만든 사람의 이름은 지우지 않습니다. 탈퇴한 회원의 작품에도
 * "탈퇴 회원"으로 이름이 남습니다.
 *
 * promo-videos: 아래 둘째 표는 CtrlAITube 댓글의 신고입니다 — 숨기기
 * (모두에게 안 보임, 사유, 감사 기록), 지우기(답글까지, 감사 기록), 신고
 * 닫기(댓글 유지).
 *
 * app-platform P3: 앱마다 ctrlai.db에 가진 데이터 크기와, "데이터" 단추로
 * 여는 공유 항목 목록(숨기기 · 지우기, 사유 필수, 감사 기록). 공유 항목
 * 하나를 신고한 건은 신고 표에 그 내용 일부와 함께 나옵니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import PageHeader from "@/app/components/PageHeader";
import { useAdminNav } from "@/app/components/AdminNavProvider";
import { useToast } from "@/app/components/ToastProvider";

import { useAdminQuarterOptional, withQuarter } from "../AdminQuarterProvider";
import {
  adminDataItem,
  adminUnpublish,
  listAppReports,
  resolveAppReport,
  type AdminReport,
} from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";
import { adminTubeComment, listTubeReports, resolveTubeReport, type AdminTubeReport } from "@/lib/tube";
import {
  adminAppComment,
  listAppCommentReports,
  resolveAppCommentReport,
  type AdminAppCommentReport,
} from "@/lib/apps";

/** ctrlaiapps-reactions: 영상 댓글과 앱 댓글의 신고를 한 표에서 — 어느 쪽인지만 달라요. */
type CommentReport = AdminTubeReport & { source: "video" | "app" };

function fromApp(row: AdminAppCommentReport): CommentReport {
  return {
    id: row.id,
    comment_id: row.comment_id,
    video_slug: row.app_slug,
    video_title: row.app_name,
    reason: row.reason,
    excerpt: row.excerpt,
    reporter_username: row.reporter_username,
    author_username: row.author_username,
    created_at: row.created_at,
    comment_live: row.comment_live,
    source: "app",
  };
}

import { sectionLabel } from "../sections";

export default function AdminContentPage() {
  const toast = useToast();
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [tubeReports, setTubeReports] = useState<CommentReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAppReports()
      .then((rows) => setReports(rows))
      .catch((caught: unknown) => setError(describeError(caught)));
    // Each queue on its own: one that fails to load must not hide the other.
    void Promise.allSettled([listTubeReports(), listAppCommentReports()]).then(([videos, apps]) => {
      const rows: CommentReport[] = [];
      if (videos.status === "fulfilled") rows.push(...videos.value.map((row) => ({ ...row, source: "video" as const })));
      else setError(describeError(videos.reason));
      if (apps.status === "fulfilled") rows.push(...apps.value.map(fromApp));
      else setError(describeError(apps.reason));
      setTubeReports(rows.sort((a, b) => a.created_at.localeCompare(b.created_at)));
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // admin-consolidation v3: 열린 신고 drives the Community badges and the
  // Dashboard's 처리할 일 — read them again after each handled report.
  const quarter = useAdminQuarterOptional();
  const nav = useAdminNav();
  const run = (action: () => Promise<{ detail: string }>) => async () => {
    setBusy(true);
    setConfirmError(null);
    try {
      const result = await action();
      toast.show(result.detail);
      setConfirm(null);
      load();
      void quarter?.refresh();
      void nav.refresh();
    } catch (caught) {
      setConfirmError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const askUnpublish = (projectId: number, name: string) => {
    setConfirmError(null);
    setConfirm({
      title: `'${name}' 게시 내리기`,
      effect: [
        "CtrlAIApps와 앱 주소에서 내립니다. 만든 사람의 파일과 버전은 그대로 남고, 다시 게시할 수 있어요.",
        "이 앱의 열린 신고는 처리된 것으로 닫힙니다. 감사 기록에 남습니다.",
      ],
      confirmLabel: "게시 내리기",
      danger: true,
      reason: { label: "사유", placeholder: "예: 개인정보를 묻는 화면", required: true },
      onConfirm: (reason) => run(() => adminUnpublish(projectId, reason))(),
    });
  };

  const askHideItem = (report: AdminReport) => {
    if (report.data_item_id === null) return;
    const itemId = report.data_item_id;
    setConfirmError(null);
    setConfirm({
      title: "신고된 항목 숨기기",
      effect: [
        `'${report.app_name}'의 공유 데이터에서 이 항목을 모든 방문자에게 숨깁니다: ${report.item_excerpt}`,
        "이 항목의 열린 신고는 처리된 것으로 닫힙니다. 감사 기록에 남습니다.",
      ],
      confirmLabel: "숨기기",
      danger: true,
      reason: { label: "사유", placeholder: "예: 욕설", required: true },
      onConfirm: (reason) => run(() => adminDataItem(itemId, "hide", reason))(),
    });
  };

  const askResolve = (report: AdminReport) => {
    setConfirmError(null);
    setConfirm({
      title: "신고 닫기 (게시 유지)",
      effect: `'${report.app_name}'은 그대로 두고 이 신고만 닫습니다. 감사 기록에 남습니다.`,
      confirmLabel: "신고 닫기",
      reason: { label: "메모 (선택)", placeholder: "예: 확인해 보니 문제 없음" },
      onConfirm: (note) => run(() => resolveAppReport(report.id, note))(),
    });
  };

  const askTubeComment = (report: CommentReport, action: "hide" | "delete") => {
    setConfirmError(null);
    const hide = action === "hide";
    const what = report.source === "app" ? "앱 댓글" : "영상 댓글";
    setConfirm({
      title: hide ? `${what} 숨기기` : `${what} 지우기`,
      effect: [
        `'${report.video_title}'의 이 댓글을 ${hide ? "모든 회원에게 숨깁니다" : "답글까지 완전히 지웁니다"}: ${report.excerpt}`,
        "이 댓글의 열린 신고는 처리된 것으로 닫힙니다. 감사 기록에 남습니다.",
      ],
      confirmLabel: hide ? "숨기기" : "지우기",
      danger: true,
      reason: { label: "사유", placeholder: "예: 욕설", required: true },
      onConfirm: (reason) =>
        run(() =>
          report.source === "app"
            ? adminAppComment(report.comment_id as number, action, reason)
            : adminTubeComment(report.comment_id as number, action, reason),
        )(),
    });
  };

  const askResolveTube = (report: CommentReport) => {
    setConfirmError(null);
    setConfirm({
      title: "신고 닫기 (댓글 유지)",
      effect: "댓글은 그대로 두고 이 신고만 닫습니다. 감사 기록에 남습니다.",
      confirmLabel: "신고 닫기",
      reason: { label: "메모 (선택)", placeholder: "예: 확인해 보니 문제 없음" },
      onConfirm: (note) =>
        run(() => (report.source === "app" ? resolveAppCommentReport(report.id, note) : resolveTubeReport(report.id, note)))(),
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={sectionLabel("content")}
        subtitle={<>회원들의 신고입니다. 앱 자체(기능 상자, 데이터, 멈추기)는 <Link href={withQuarter("/admin/community?tab=apps", quarter?.selected?.id)}>Community › 앱</Link>에서 다룹니다.</>}
      />

      {error && (
        <p className="small" role="alert">
          {error}
        </p>
      )}

      <section className="card" aria-labelledby="reports-title">
        <h2 className="section-title" id="reports-title">
          열린 신고 {reports ? `(${reports.length})` : ""}
        </h2>
        {reports === null ? (
          <p className="small muted">불러오는 중…</p>
        ) : reports.length === 0 ? (
          <p className="small muted">열린 신고가 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="reports">
              <thead>
                <tr>
                  <th>앱</th>
                  <th>사유</th>
                  <th>신고한 회원</th>
                  <th>언제</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      {report.still_listed ? (
                        <Link href={`/ctrlaistore/${report.app_slug}`}>{report.app_name}</Link>
                      ) : (
                        <>
                          {report.app_name} <span className="badge badge-muted">내려감</span>
                        </>
                      )}
                    </td>
                    <td>
                      {report.reason}
                      {report.data_item_id !== null && (
                        <>
                          <br />
                          <span className="small muted" data-testid="report-excerpt">
                            공유 데이터: <code>{report.item_excerpt}</code>
                            {!report.item_live && " · 이미 숨기거나 지웠어요"}
                          </span>
                        </>
                      )}
                    </td>
                    <td>{report.reporter_username || "—"}</td>
                    <td>{relativeTime(report.created_at)}</td>
                    <td className="actions-cell">
                      {report.data_item_id !== null && report.item_live && (
                        <>
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => askHideItem(report)}>
                            항목 숨기기
                          </button>{" "}
                        </>
                      )}
                      {report.still_listed && (
                        <button
                          className="btn btn-sm btn-danger"
                          type="button"
                          onClick={() => askUnpublish(report.project_id, report.app_name)}
                        >
                          게시 내리기
                        </button>
                      )}{" "}
                      <button className="btn btn-sm" type="button" onClick={() => askResolve(report)}>
                        신고 닫기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="tube-reports-title">
        <h2 className="section-title" id="tube-reports-title">
          댓글 신고 (영상 · 앱) {tubeReports ? `(${tubeReports.length})` : ""}
        </h2>
        {tubeReports === null ? (
          <p className="small muted">불러오는 중…</p>
        ) : tubeReports.length === 0 ? (
          <p className="small muted">열린 신고가 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="tube-reports">
              <thead>
                <tr>
                  <th>영상·앱 · 댓글</th>
                  <th>사유</th>
                  <th>쓴 회원</th>
                  <th>신고한 회원</th>
                  <th>언제</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tubeReports.map((report) => (
                  <tr key={`${report.source}-${report.id}`}>
                    <td>
                      <span className="badge badge-muted">{report.source === "app" ? "앱" : "영상"}</span>{" "}
                      <Link href={report.source === "app" ? `/ctrlaistore/${report.video_slug}` : `/ctrlaitube/${report.video_slug}`}>
                        {report.video_title}
                      </Link>
                      <br />
                      <span className="small muted" data-testid="tube-report-excerpt">
                        <code>{report.excerpt}</code>
                        {!report.comment_live && " · 이미 숨기거나 지웠어요"}
                      </span>
                    </td>
                    <td>{report.reason}</td>
                    <td>{report.author_username || "—"}</td>
                    <td>{report.reporter_username || "—"}</td>
                    <td>{relativeTime(report.created_at)}</td>
                    <td className="actions-cell">
                      {report.comment_live && (
                        <>
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => askTubeComment(report, "hide")}>
                            댓글 숨기기
                          </button>{" "}
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => askTubeComment(report, "delete")}>
                            댓글 지우기
                          </button>{" "}
                        </>
                      )}
                      <button className="btn btn-sm" type="button" onClick={() => askResolveTube(report)}>
                        신고 닫기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        busy={busy}
        error={confirmError}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
