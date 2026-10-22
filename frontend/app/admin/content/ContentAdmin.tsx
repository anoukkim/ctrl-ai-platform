"use client";

/**
 * Admin › Community › 신고 (ctrlaiapps-publish → admin-ui-unify).
 *
 * 맨 위 카드가 열린 신고의 수, 그 아래 두 목록: 앱 신고(앱 자체, 또는 앱의
 * 공유 데이터 항목 하나)와 댓글 신고(CtrlAITube 영상 · 앱 댓글). 줄을 누르면
 * 오른쪽 판에서 내용을 읽고 처리합니다 — 항목 숨기기, 게시 내리기, 댓글
 * 숨기기 · 지우기, 신고 닫기. 모두 확인창(숨기기 · 지우기 · 내리기는 사유
 * 필수)을 지나 감사 기록에 남습니다.
 *
 * 앱 자체(기능 상자, 데이터, 멈추기)는 Community › 앱에서. 숨기더라도 만든
 * 사람의 이름은 지우지 않습니다 — 탈퇴한 회원은 "탈퇴 회원"으로 남습니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ConfirmDialog, { type ConfirmRequest } from "@/app/components/ConfirmDialog";
import { useAdminNav } from "@/app/components/AdminNavProvider";
import { useToast } from "@/app/components/ToastProvider";

import { useAdminQuarterOptional, withQuarter } from "../AdminQuarterProvider";
import {
  ItemList,
  ItemRow,
  PanelBar,
  PanelSection,
  Pill,
  SidePanel,
  Stack,
  Stats,
  SubHeading,
  Tag,
} from "../components/AdminUI";
import {
  adminAppComment,
  adminDataItem,
  adminUnpublish,
  listAppCommentReports,
  listAppReports,
  resolveAppCommentReport,
  resolveAppReport,
  type AdminAppCommentReport,
  type AdminReport,
} from "@/lib/apps";
import { describeError } from "@/lib/http";
import { relativeTime } from "@/lib/relative-time";
import { adminTubeComment, listTubeReports, resolveTubeReport, type AdminTubeReport } from "@/lib/tube";

import styles from "../community/community.module.css";

/** ctrlaiapps-reactions: 영상 댓글과 앱 댓글의 신고를 한 목록에서 — 어느 쪽인지만 달라요. */
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

type Filter = "all" | "apps" | "comments";
type Open = { kind: "app"; id: number } | { kind: "comment"; key: string };

const commentKey = (report: CommentReport) => `${report.source}-${report.id}`;
const commentHref = (report: CommentReport) =>
  report.source === "app" ? `/ctrlaistore/${report.video_slug}` : `/ctrlaitube/${report.video_slug}`;

export default function AdminContentPage() {
  const toast = useToast();
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [tubeReports, setTubeReports] = useState<CommentReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Open | null>(null);
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
      setOpen(null);
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

  const appsHref = withQuarter("/admin/community?tab=apps", quarter?.selected?.id);
  const appCount = reports?.length ?? null;
  const commentCount = tubeReports?.length ?? null;
  const total = appCount !== null && commentCount !== null ? appCount + commentCount : null;

  const openApp = open?.kind === "app" ? (reports ?? []).find((row) => row.id === open.id) ?? null : null;
  const openComment =
    open?.kind === "comment" ? (tubeReports ?? []).find((row) => commentKey(row) === open.key) ?? null : null;

  const chip = (value: Filter, label: string, count: number | null) => (
    <button
      key={value}
      type="button"
      className="chip"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
    >
      {label}
      {count !== null && count > 0 ? ` ${count}` : ""}
    </button>
  );

  return (
    <Stack>
      <Stats
        items={[
          { key: "open", value: total ?? "…", label: "열린 신고", tone: total ? "warn" : undefined },
          { key: "apps", value: appCount ?? "…", label: "앱 · 공유 데이터" },
          { key: "comments", value: commentCount ?? "…", label: "댓글 (영상 · 앱)" },
        ]}
      />

      <PanelBar
        left={
          <div className={styles.chips} role="group" aria-label="신고 종류">
            {chip("all", "전체", total)}
            {chip("apps", "앱", appCount)}
            {chip("comments", "댓글", commentCount)}
          </div>
        }
        note={
          <>
            앱 자체는 <Link href={appsHref}>Community › 앱</Link>에서
          </>
        }
        help={
          <>
            <p>
              줄을 누르면 오른쪽에서 처리해요. 앱 신고는 공유 데이터 항목 숨기기 · 게시 내리기 · 신고 닫기, 댓글 신고는 댓글
              숨기기 · 지우기(답글까지) · 신고 닫기.
            </p>
            <p>
              게시를 내려도 만든 사람의 파일과 버전은 남고 다시 게시할 수 있어요. 숨기기 · 지우기 · 내리기는 사유가 필요하고,
              모든 처리는 감사 기록에 남습니다. 만든 사람의 이름은 지우지 않아요.
            </p>
          </>
        }
      />

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {filter !== "comments" && (
        <section aria-labelledby="reports-title">
          <SubHeading extra={appCount !== null ? `${appCount}건` : undefined}>
            <span id="reports-title">앱 신고</span>
          </SubHeading>
          {reports === null ? (
            <p className="small muted">불러오는 중…</p>
          ) : (
            <ItemList testId="reports" empty={reports.length === 0 ? "열린 신고가 없습니다." : undefined}>
              {reports.map((report) => (
                <ItemRow
                  key={report.id}
                  testId="report"
                  onClick={() => setOpen({ kind: "app", id: report.id })}
                  title={report.app_name}
                  tags={
                    <>
                      <Pill tone="warn">열림</Pill>
                      {report.data_item_id !== null && <Tag>공유 데이터</Tag>}
                      {!report.still_listed && <Tag>내려감</Tag>}
                    </>
                  }
                  sub={
                    report.data_item_id !== null ? (
                      <span data-testid="report-excerpt">
                        공유 데이터: <code>{report.item_excerpt}</code>
                        {!report.item_live && " · 이미 숨기거나 지웠어요"}
                      </span>
                    ) : (
                      <>
                        신고 {report.reporter_username ? `@${report.reporter_username}` : "—"} ·{" "}
                        {relativeTime(report.created_at)}
                      </>
                    )
                  }
                  cells={[{ label: "사유", value: report.reason, keep: true }]}
                  action={
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => setOpen({ kind: "app", id: report.id })}
                      aria-label={`'${report.app_name}' 신고 처리`}
                    >
                      처리
                    </button>
                  }
                />
              ))}
            </ItemList>
          )}
        </section>
      )}

      {filter !== "apps" && (
        <section aria-labelledby="tube-reports-title">
          <SubHeading extra={commentCount !== null ? `${commentCount}건` : undefined}>
            <span id="tube-reports-title">댓글 신고 (영상 · 앱)</span>
          </SubHeading>
          {tubeReports === null ? (
            <p className="small muted">불러오는 중…</p>
          ) : (
            <ItemList testId="tube-reports" empty={tubeReports.length === 0 ? "열린 신고가 없습니다." : undefined}>
              {tubeReports.map((report) => (
                <ItemRow
                  key={commentKey(report)}
                  testId="tube-report"
                  onClick={() => setOpen({ kind: "comment", key: commentKey(report) })}
                  title={report.video_title}
                  tags={
                    <>
                      <Pill tone="warn">열림</Pill>
                      <Tag>{report.source === "app" ? "앱" : "영상"}</Tag>
                    </>
                  }
                  sub={
                    <span data-testid="tube-report-excerpt">
                      {report.author_username || "—"}: <code>{report.excerpt}</code>
                      {!report.comment_live && " · 이미 숨기거나 지웠어요"}
                    </span>
                  }
                  cells={[
                    { label: "사유", value: report.reason, keep: true },
                    { label: "신고", value: `${report.reporter_username || "—"} · ${relativeTime(report.created_at)}` },
                  ]}
                  action={
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => setOpen({ kind: "comment", key: commentKey(report) })}
                      aria-label={`'${report.video_title}' 댓글 신고 처리`}
                    >
                      처리
                    </button>
                  }
                />
              ))}
            </ItemList>
          )}
        </section>
      )}

      {openApp && (
        <SidePanel
          title={openApp.app_name}
          subtitle="앱 신고"
          onClose={() => setOpen(null)}
          testId="report-panel"
          footer={
            <>
              <button className="btn btn-sm" type="button" onClick={() => setOpen(null)}>
                닫기
              </button>
              <button className="btn btn-sm btn-primary" type="button" onClick={() => askResolve(openApp)}>
                신고 닫기
              </button>
            </>
          }
        >
          <PanelSection title="신고">
            <dl className={styles.facts}>
              <dt>사유</dt>
              <dd>{openApp.reason}</dd>
              <dt>신고한 회원</dt>
              <dd>{openApp.reporter_username || "—"}</dd>
              <dt>언제</dt>
              <dd>{relativeTime(openApp.created_at)}</dd>
              <dt>앱</dt>
              <dd>
                {openApp.still_listed ? (
                  <Link href={`/ctrlaistore/${openApp.app_slug}`}>CtrlAIApps에서 보기</Link>
                ) : (
                  "게시 내려감"
                )}
              </dd>
            </dl>
          </PanelSection>
          {openApp.data_item_id !== null && (
            <PanelSection title="신고된 공유 데이터">
              <pre className={`${styles.quote} ${styles.quoteMono}`}>{openApp.item_excerpt}</pre>
              {openApp.item_live ? (
                <div className={styles.actions}>
                  <button className="btn btn-sm btn-danger" type="button" onClick={() => askHideItem(openApp)}>
                    항목 숨기기
                  </button>
                </div>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  이미 숨기거나 지웠어요.
                </p>
              )}
            </PanelSection>
          )}
          {openApp.still_listed && (
            <PanelSection title="앱 전체">
              <p className="small muted" style={{ margin: 0 }}>
                내려도 만든 사람의 파일과 버전은 남고, 다시 게시할 수 있어요.
              </p>
              <div className={styles.actions}>
                <button
                  className="btn btn-sm btn-danger"
                  type="button"
                  onClick={() => askUnpublish(openApp.project_id, openApp.app_name)}
                >
                  게시 내리기
                </button>
              </div>
            </PanelSection>
          )}
        </SidePanel>
      )}

      {openComment && (
        <SidePanel
          title={openComment.video_title}
          subtitle={openComment.source === "app" ? "앱 댓글 신고" : "영상 댓글 신고"}
          onClose={() => setOpen(null)}
          testId="comment-report-panel"
          footer={
            <>
              <button className="btn btn-sm" type="button" onClick={() => setOpen(null)}>
                닫기
              </button>
              <button className="btn btn-sm btn-primary" type="button" onClick={() => askResolveTube(openComment)}>
                신고 닫기
              </button>
            </>
          }
        >
          <PanelSection title="댓글">
            <pre className={styles.quote}>{openComment.excerpt}</pre>
            <dl className={styles.facts}>
              <dt>쓴 회원</dt>
              <dd>{openComment.author_username || "—"}</dd>
              <dt>사유</dt>
              <dd>{openComment.reason}</dd>
              <dt>신고한 회원</dt>
              <dd>{openComment.reporter_username || "—"}</dd>
              <dt>언제</dt>
              <dd>{relativeTime(openComment.created_at)}</dd>
              <dt>어디</dt>
              <dd>
                <Link href={commentHref(openComment)}>{openComment.source === "app" ? "앱에서 보기" : "영상에서 보기"}</Link>
              </dd>
            </dl>
          </PanelSection>
          <PanelSection title="처리">
            {openComment.comment_live ? (
              <div className={styles.actions}>
                <button className="btn btn-sm btn-danger" type="button" onClick={() => askTubeComment(openComment, "hide")}>
                  댓글 숨기기
                </button>
                <button className="btn btn-sm btn-danger" type="button" onClick={() => askTubeComment(openComment, "delete")}>
                  댓글 지우기
                </button>
              </div>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                이미 숨기거나 지웠어요. 신고만 닫으면 돼요.
              </p>
            )}
          </PanelSection>
        </SidePanel>
      )}

      <ConfirmDialog busy={busy} error={confirmError} request={confirm} onClose={() => setConfirm(null)} />
    </Stack>
  );
}
