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
 * "탈퇴 회원"으로 이름이 남습니다. 영상(Phase 8)은 아직 없습니다.
 *
 * app-platform P3: 앱마다 ctrlai.db에 가진 데이터 크기와, "데이터" 단추로
 * 여는 공유 항목 목록(숨기기 · 지우기, 사유 필수, 감사 기록). 공유 항목
 * 하나를 신고한 건은 신고 표에 그 내용 일부와 함께 나옵니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import PageHeader from "@/app/components/PageHeader";
import { useToast } from "@/app/components/ToastProvider";
import {
  adminDataItem,
  adminUnpublish,
  listAppReports,
  resolveAppReport,
  type AdminReport,
} from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";

import { sectionLabel } from "../sections";

export default function AdminContentPage() {
  const toast = useToast();
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(() => {
    listAppReports()
      .then((rows) => setReports(rows))
      .catch((caught: unknown) => setError(describeError(caught)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = (action: () => Promise<{ detail: string }>) => async () => {
    setBusy(true);
    setConfirmError(null);
    try {
      const result = await action();
      toast.show(result.detail);
      setConfirm(null);
      load();
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

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title={sectionLabel("content")}
        subtitle={<>회원들의 신고입니다. 앱 자체(기능 상자, 데이터, 멈추기)는 <Link href="/admin/apps">Apps</Link>에서 다룹니다.</>}
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

      <ConfirmDialog
        busy={busy}
        error={confirmError}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
