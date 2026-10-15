"use client";

/**
 * Admin › Content (/admin/content) — 게시된 앱과 신고 (ctrlaiapps-publish).
 *
 * 열린 신고를 먼저, 그 아래 CtrlAIApps에 올라 있는 앱 전부. 앱을 내리면
 * (감사 기록에 남음) 만든 사람에게는 게시 취소와 같아서 버전은 모두 남고
 * 다시 게시할 수 있습니다. 신고만 닫고 앱을 두는 것도 기록에 남습니다.
 *
 * 숨기더라도 만든 사람의 이름은 지우지 않습니다. 탈퇴한 회원의 작품에도
 * "탈퇴 회원"으로 이름이 남습니다. 영상(Phase 8)은 아직 없습니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import PageHeader from "@/app/components/PageHeader";
import { useToast } from "@/app/components/ToastProvider";
import {
  adminUnpublish,
  listAdminApps,
  listAppReports,
  resolveAppReport,
  type AdminApp,
  type AdminReport,
} from "@/lib/apps";
import { setAppSdk } from "@/lib/app-platform";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";

import { sectionLabel } from "../sections";
import HandoffPreview from "./HandoffPreview";

export default function AdminContentPage() {
  const toast = useToast();
  const [apps, setApps] = useState<AdminApp[] | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdminApp | null>(null);

  const load = useCallback(() => {
    Promise.all([listAdminApps(), listAppReports()])
      .then(([appRows, reportRows]) => {
        setApps(appRows);
        setReports(reportRows);
      })
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

  const askSdk = (app: AdminApp) => {
    setConfirmError(null);
    if (app.sdk_enabled) {
      setConfirm({
        title: `'${app.name}' 기능 상자 멈추기`,
        effect: [
          "이 앱의 로그인 · AI · 데이터 요청을 바로 모두 거절합니다. 앱 화면은 그대로 열려요.",
          "방문자에게는 '관리자가 잠시 멈췄어요'라고 보여요. 감사 기록에 남습니다.",
        ],
        confirmLabel: "멈추기",
        danger: true,
        reason: { label: "사유", placeholder: "예: AI 비용이 비정상적으로 나감", required: true },
        onConfirm: (reason) => run(() => setAppSdk(app.id, false, reason))(),
      });
    } else {
      setConfirm({
        title: `'${app.name}' 기능 상자 다시 켜기`,
        effect: `멈춘 이유: ${app.sdk_disabled_reason || "—"}. 다시 켜면 로그인과 AI가 바로 동작해요. 감사 기록에 남습니다.`,
        confirmLabel: "다시 켜기",
        onConfirm: () => run(() => setAppSdk(app.id, true))(),
      });
    }
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
        subtitle={<>CtrlAIApps에 게시된 앱과 회원들의 신고입니다.</>}
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
                    <td>{report.reason}</td>
                    <td>{report.reporter_username || "—"}</td>
                    <td>{relativeTime(report.created_at)}</td>
                    <td className="actions-cell">
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

      <section className="card" aria-labelledby="apps-title" style={{ marginTop: "1rem" }}>
        <h2 className="section-title" id="apps-title">
          게시된 앱 {apps ? `(${apps.length})` : ""}
        </h2>
        {apps === null ? (
          <p className="small muted">불러오는 중…</p>
        ) : apps.length === 0 ? (
          <p className="small muted">아직 게시된 앱이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" data-testid="published-apps">
              <thead>
                <tr>
                  <th>앱</th>
                  <th>만든 사람</th>
                  <th>버전</th>
                  <th>신고</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <Link href={`/ctrlaistore/${app.slug}`}>{app.name}</Link>
                    </td>
                    <td>{app.author_name}</td>
                    <td>
                      v{app.version_number}
                      {app.published_at ? ` · ${relativeTime(app.published_at)}` : ""}
                    </td>
                    <td>
                      {app.open_reports > 0 ? <span className="badge badge-warn">{app.open_reports}</span> : "—"}
                      {!app.sdk_enabled && <span className="badge badge-muted"> 기능 상자 멈춤</span>}
                    </td>
                    <td className="actions-cell">
                      <button
                        className="btn btn-sm"
                        type="button"
                        onClick={() => askSdk(app)}
                        title={app.sdk_enabled ? "로그인 · AI · 데이터를 멈춰요" : `멈춘 이유: ${app.sdk_disabled_reason}`}
                      >
                        {app.sdk_enabled ? "기능 상자 멈추기" : "기능 상자 다시 켜기"}
                      </button>{" "}
                      {app.example && (
                        <>
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => setPreview(app)}
                            title="회원이 내려받는 ZIP에 무엇이 들어가는지"
                          >
                            ZIP 미리보기
                          </button>{" "}
                        </>
                      )}
                      <button
                        className="btn btn-sm btn-danger"
                        type="button"
                        onClick={() => askUnpublish(app.id, app.name)}
                      >
                        게시 내리기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {preview && (
        <HandoffPreview projectId={preview.id} name={preview.name} onClose={() => setPreview(null)} />
      )}

      <ConfirmDialog
        busy={busy}
        error={confirmError}
        request={confirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
