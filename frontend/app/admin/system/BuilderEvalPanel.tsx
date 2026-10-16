"use client";

/**
 * Admin › System › 빌더 점검 (quality-tuning Q2).
 *
 * 운영자가 서버에서 직접 돌리는 점검의 보고서입니다 — 단계별 만들기를 정해
 * 둔 예시 아이디어 다섯 개로 실제 Claude에 돌려 보고(관리자 지갑에서 차감),
 * 성공 여부·걸린 시간·쓴 돈·파일 수·점검이 고친 파일을 남깁니다. 화면은
 * 읽기만 합니다. 돌리는 명령은 아래에 그대로 적어 둡니다.
 */

import { useEffect, useState } from "react";

import ChatMarkdown from "@/app/components/ChatMarkdown";
import { formatWhen } from "@/lib/admin";
import { describeError, request } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";

import styles from "../admin.module.css";

interface BuilderEvalReport {
  id: number;
  created_at: string;
  provider: string;
  ideas: number;
  succeeded: number;
  total_krw: number;
  run_by_username: string;
  markdown: string;
}

export const BUILDER_EVAL_COMMAND =
  "docker compose -f docker-compose.prod.yml exec api python -m app.tools.builder_eval --ideas 5 --max-krw 3000";

export default function BuilderEvalPanel() {
  const [reports, setReports] = useState<BuilderEvalReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<BuilderEvalReport[]>("/admin/claude-pricing/builder-eval")
      .then(setReports)
      .catch((caught: unknown) => setError(describeError(caught)));
  }, []);

  return (
    <>
      <div className="card">
        <p className="small dim">서버에서 이렇게 돌립니다(예산 한도를 넘기지 않아요):</p>
        <pre className={styles.command}>
          <code>{BUILDER_EVAL_COMMAND}</code>
        </pre>
        {error && (
          <p className="small" role="alert" style={{ color: "var(--error-text)" }}>
            {error}
          </p>
        )}
        {reports !== null && reports.length === 0 && (
          <p className="small dim">아직 점검한 적이 없어요.</p>
        )}
        {reports?.map((report, index) => (
          <details key={report.id} open={index === 0} className={styles.evalReport}>
            <summary>
              {formatWhen(report.created_at)} · 성공 {report.succeeded}/{report.ideas} ·{" "}
              {formatKrw(report.total_krw)} · {report.provider === "mock" ? "mock" : "실제 Claude"}
              {report.run_by_username ? ` · ${report.run_by_username}` : ""}
            </summary>
            <ChatMarkdown text={report.markdown} />
          </details>
        ))}
      </div>
    </>
  );
}
