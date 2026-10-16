"use client";

/**
 * Admin › Apps › 앱 하나 (app-platform P4b).
 *
 * 한 앱에 할 수 있는 모든 일이 여기 있습니다: 기능 상자 멈추기/켜기,
 * 공유 데이터 보기와 숨기기, 게시 내리기, 예시 앱의 ZIP 미리보기. 숫자는
 * 방문자의 AI 사용(오늘 · 이번 분기)과 만든 사람의 미리보기 사용을 따로
 * 보여 줍니다 — 둘 다 각자의 지원금에서 나갔습니다. 모든 작업은 확인창을
 * 지나고 감사 기록에 남습니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import PageHeader from "@/app/components/PageHeader";
import { useToast } from "@/app/components/ToastProvider";
import { setAppSdk } from "@/lib/app-platform";
import { adminUnpublish, formatBytes, getAdminApp, type AdminAppOverview } from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";

import { useBreadcrumbTail } from "../../AdminFrame";
import AppDataPanel from "../../content/AppDataPanel";
import HandoffPreview from "../../content/HandoffPreview";
import Fact from "../../members/[id]/Fact";
import { AppStateBadges } from "../AppsList";

import styles from "../../admin.module.css";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export default function AppDetailView({ projectId }: { projectId: number }) {
  const toast = useToast();
  const [app, setApp] = useState<AdminAppOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [zipOpen, setZipOpen] = useState(false);

  useBreadcrumbTail(app?.name ?? null);

  const load = useCallback(() => {
    getAdminApp(projectId)
      .then((row) => {
        setApp(row);
        setError(null);
      })
      .catch((caught: unknown) => setError(describeError(caught)));
  }, [projectId]);

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

  const askSdk = () => {
    if (!app) return;
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

  const askUnpublish = () => {
    if (!app) return;
    setConfirmError(null);
    setConfirm({
      title: `'${app.name}' 게시 내리기`,
      effect: [
        "CtrlAIApps와 앱 주소에서 내립니다. 만든 사람의 파일과 버전은 그대로 남고, 다시 게시할 수 있어요.",
        "이 앱의 열린 신고는 처리된 것으로 닫힙니다. 감사 기록에 남습니다.",
      ],
      confirmLabel: "게시 내리기",
      danger: true,
      reason: { label: "사유", placeholder: "예: 개인정보를 묻는 화면", required: true },
      onConfirm: (reason) => run(() => adminUnpublish(app.id, reason))(),
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin › Apps"
        title={app ? app.name : "앱"}
        titleAddon={app ? <AppStateBadges app={app} /> : undefined}
        subtitle={
          app ? (
            <>
              만든 사람 <Link href={`/admin/members/${app.owner_id}`}>{app.owner_name}</Link> (@{app.owner_username})
              {app.published && app.slug && (
                <>
                  {" · "}
                  <Link href={`/ctrlaistore/${app.slug}`}>CtrlAIApps에서 보기</Link>
                </>
              )}
              {app.app_url && (
                <>
                  {" · "}
                  <a href={app.app_url} target="_blank" rel="noreferrer">
                    앱 열기
                  </a>
                </>
              )}
            </>
          ) : undefined
        }
      />

      {error && (
        <p className="small" role="alert">
          {error}
        </p>
      )}
      {!app && !error && <p className="small muted">불러오는 중…</p>}

      {app && (
        <>
          <section className="card" aria-labelledby="app-ai-title">
            <h2 className="section-title" id="app-ai-title">
              AI 사용 (기능 상자)
            </h2>
            <div className={styles.factGrid} data-testid="app-ai">
              <Fact label="오늘 · 방문자" value={app.ai.today_calls > 0 ? `${app.ai.today_calls}회 · ${won(app.ai.today_krw)}` : "없음"} mono />
              <Fact label="이번 분기 · 방문자" value={app.ai.quarter_calls > 0 ? `${app.ai.quarter_calls}회 · ${won(app.ai.quarter_krw)}` : "없음"} mono />
              <Fact
                label="이번 분기 · 만든 사람의 미리보기"
                value={app.ai.preview_quarter_calls > 0 ? `${app.ai.preview_quarter_calls}회 · ${won(app.ai.preview_quarter_krw)}` : "없음"}
                mono
              />
              <Fact label="연결 동의" value={app.consents > 0 ? `${app.consents}명` : "없음"} mono />
            </div>
            <p className="small muted" style={{ marginTop: "0.6rem" }}>
              방문자의 AI는 각자의 동아리 지원금에서, 미리보기는 만든 사람의 지원금에서 나갔어요. 1회 상한 200원, 하루 상한은 System의 설정을 따릅니다.
            </p>
          </section>

          <section className="card" aria-labelledby="app-state-title" style={{ marginTop: "1rem" }}>
            <h2 className="section-title" id="app-state-title">
              상태
            </h2>
            <div className={styles.factGrid} data-testid="app-state">
              <Fact
                label="게시"
                value={app.published ? `v${app.version_number}${app.published_at ? ` · ${relativeTime(app.published_at)}` : ""}` : "미게시 (미리보기만)"}
              />
              <Fact label="기능 상자" value={app.sdk_enabled ? "켜짐" : `멈춤 — ${app.sdk_disabled_reason || "사유 없음"}`} />
              <Fact label="데이터 (ctrlai.db)" value={app.data_items > 0 ? `${app.data_items.toLocaleString("ko-KR")}개 · ${formatBytes(app.data_bytes)}` : "없음"} mono />
              <Fact label="열린 신고" value={app.open_reports > 0 ? `${app.open_reports}건 — Content에서 처리` : "없음"} />
            </div>
            <div className={styles.actionRow}>
              <button className={app.sdk_enabled ? "btn btn-sm btn-danger" : "btn btn-sm"} type="button" onClick={askSdk}>
                {app.sdk_enabled ? "기능 상자 멈추기" : "기능 상자 다시 켜기"}
              </button>
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => setDataOpen(true)}
                title="이 앱이 ctrlai.db에 가진 목록과 공유 항목 — 숨기기 · 지우기"
              >
                공유 데이터 보기
              </button>
              {app.example && (
                <button className="btn btn-sm" type="button" onClick={() => setZipOpen(true)} title="회원이 내려받는 ZIP에 무엇이 들어가는지">
                  ZIP 미리보기
                </button>
              )}
              {app.published && (
                <button className="btn btn-sm btn-danger" type="button" onClick={askUnpublish}>
                  게시 내리기
                </button>
              )}
              {app.open_reports > 0 && (
                <Link className="btn btn-sm" href="/admin/content">
                  신고 보기
                </Link>
              )}
            </div>
          </section>
        </>
      )}

      {app && zipOpen && <HandoffPreview projectId={app.id} name={app.name} onClose={() => setZipOpen(false)} />}
      {app && dataOpen && (
        <AppDataPanel projectId={app.id} name={app.name} onChanged={load} onClose={() => setDataOpen(false)} />
      )}

      <ConfirmDialog busy={busy} error={confirmError} request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
