"use client";

/**
 * Admin › Community › 앱 › 앱 하나 (app-platform P4b → admin-ui-unify).
 *
 * 제목(앱 이름)은 틀이 빵가루 끝으로 그립니다. 맨 위 카드가 AI 사용(방문자
 * 오늘 · 이번 분기, 만든 사람의 미리보기)과 연결 동의, 그 아래 상태 카드와
 * 기능 상자 스위치. 공유 데이터와 예시 앱의 ZIP 미리보기는 오른쪽 판에서
 * 엽니다. 멈추기 · 다시 켜기 · 게시 내리기는 확인창(멈추기와 내리기는 사유
 * 필수)을 지나 감사 기록에 남습니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useToast } from "@/app/components/ToastProvider";
import { setAppSdk } from "@/lib/app-platform";
import { adminUnpublish, formatBytes, getAdminApp, type AdminAppOverview } from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";

import { useBreadcrumbTail } from "../../AdminFrame";
import { useAdminQuarterOptional, withQuarter } from "../../AdminQuarterProvider";
import { PanelBar, SettingsCard, SettingsGrid, Stack, Stats, SwitchRow } from "../../components/AdminUI";
import AppDataPanel from "../../content/AppDataPanel";
import HandoffPreview from "../../content/HandoffPreview";
import { AppStateBadges } from "../AppsList";

import styles from "../../community/community.module.css";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const calls = (count: number, krw: number) => (count > 0 ? `${count}회 · ${won(krw)}` : "없음");

export default function AppDetailView({ projectId }: { projectId: number }) {
  const toast = useToast();
  const quarter = useAdminQuarterOptional();
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

  if (error && !app) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }
  if (!app) return <p className="small muted">불러오는 중…</p>;

  return (
    <Stack>
      <PanelBar
        left={
          <div className={styles.links}>
            <AppStateBadges app={app} />
            <span>
              만든 사람{" "}
              <Link href={withQuarter(`/admin/members/${app.owner_id}`, quarter?.selected?.id)}>{app.owner_name}</Link> (@
              {app.owner_username})
            </span>
            {app.published && app.slug && <Link href={`/ctrlaistore/${app.slug}`}>CtrlAIApps에서 보기</Link>}
            {app.app_url && (
              <a href={app.app_url} target="_blank" rel="noreferrer">
                앱 열기
              </a>
            )}
          </div>
        }
        help={
          <p>
            방문자의 AI는 각자의 동아리 지원금에서, 미리보기는 만든 사람의 지원금에서 나갔어요. 1회 상한 1,000원, 하루 상한은
            System의 설정을 따릅니다. AI 공개(데모만 · 전체 기능)는 만든 사람이 정해요. 멈추기 · 게시 내리기 · 데이터
            숨기기는 사유를 적고 감사 기록에 남습니다.
          </p>
        }
        actions={
          <>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => setDataOpen(true)}
              title="이 앱이 ctrlai.db에 가진 목록과 공유 항목 — 숨기기 · 지우기"
            >
              공유 데이터 보기
            </button>
            {app.example && (
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => setZipOpen(true)}
                title="회원이 내려받는 ZIP에 무엇이 들어가는지"
              >
                ZIP 미리보기
              </button>
            )}
            {app.published && (
              <button className="btn btn-sm btn-danger" type="button" onClick={askUnpublish}>
                게시 내리기
              </button>
            )}
          </>
        }
      />

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div data-testid="app-ai">
        <Stats
          items={[
            { key: "today", value: calls(app.ai.today_calls, app.ai.today_krw), label: "오늘 · 방문자 AI" },
            { key: "quarter", value: calls(app.ai.quarter_calls, app.ai.quarter_krw), label: "이번 분기 · 방문자 AI" },
            {
              key: "preview",
              value: calls(app.ai.preview_quarter_calls, app.ai.preview_quarter_krw),
              label: "이번 분기 · 만든 사람의 미리보기",
            },
            { key: "consents", value: app.consents > 0 ? `${app.consents}명` : "없음", label: "연결 동의" },
          ]}
        />
      </div>

      <SettingsGrid>
        <SettingsCard title="기능 상자" extra={app.sdk_enabled ? "켜짐" : "멈춤"}>
          <SwitchRow
            label="기능 상자 켜기"
            hint={
              app.sdk_enabled
                ? "끄면 이 앱의 로그인 · AI · 데이터 요청을 모두 거절해요 (사유 필수)"
                : `멈춘 이유: ${app.sdk_disabled_reason || "사유 없음"}`
            }
            checked={app.sdk_enabled}
            onChange={askSdk}
            testId="app-sdk-switch"
          />
        </SettingsCard>

        <SettingsCard title="상태">
          <dl className={styles.facts} data-testid="app-state">
            <dt>게시</dt>
            <dd>
              {app.published
                ? `v${app.version_number}${app.published_at ? ` · ${relativeTime(app.published_at)}` : ""}`
                : "미게시 (미리보기만)"}
            </dd>
            <dt>기능 상자</dt>
            <dd>{app.sdk_enabled ? "켜짐" : `멈춤 — ${app.sdk_disabled_reason || "사유 없음"}`}</dd>
            <dt>AI 공개</dt>
            <dd>
              {!app.uses_ai
                ? "AI를 쓰지 않음"
                : app.ai_access === "full"
                  ? "전체 기능 — 방문자가 자기 지원금으로"
                  : "데모만 — 방문자의 호출은 거부 (0원)"}
            </dd>
            <dt>데이터</dt>
            <dd>
              {app.data_items > 0 ? `${app.data_items.toLocaleString("ko-KR")}개 · ${formatBytes(app.data_bytes)}` : "없음"}
            </dd>
            <dt>열린 신고</dt>
            <dd>
              {app.open_reports > 0 ? (
                <>
                  {app.open_reports}건 —{" "}
                  <Link href={withQuarter("/admin/community", quarter?.selected?.id)}>신고 보기</Link>
                </>
              ) : (
                "없음"
              )}
            </dd>
          </dl>
        </SettingsCard>
      </SettingsGrid>

      {zipOpen && <HandoffPreview projectId={app.id} name={app.name} onClose={() => setZipOpen(false)} />}
      {dataOpen && (
        <AppDataPanel projectId={app.id} name={app.name} onChanged={load} onClose={() => setDataOpen(false)} />
      )}

      <ConfirmDialog busy={busy} error={confirmError} request={confirm} onClose={() => setConfirm(null)} />
    </Stack>
  );
}
