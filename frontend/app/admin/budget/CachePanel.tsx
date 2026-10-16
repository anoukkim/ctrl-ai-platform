"use client";

/**
 * 캐시 패널 (cost-clarity) — 모델별·날짜별(KST) 캐시 적중률, 읽고 쓴 토큰,
 * 캐시로 아낀 금액.
 *
 * 아낀 금액 = 캐시에서 읽은 토큰을 그냥 입력으로 냈다면 들었을 금액 −
 * 실제로 낸 캐시 읽기 금액. 처음 캐시에 쓸 때 더 낸 금액(쓰기 1.25배)은
 * "캐시 쓰기" 칸에 따로 보입니다. 채팅 답장만 셉니다 — 빌더와 프롬프트
 * 도움은 캐시를 쓰지 않습니다. Haiku 4.5는 4,096토큰보다 짧은 앞부분을
 * 캐시하지 않아서 짧은 대화에서는 적중률이 0%인 것이 정상입니다.
 */

import { useEffect, useState } from "react";

import Skeleton from "@/app/components/Skeleton";
import { exportUrl, getCachePanel, type CacheRow } from "@/lib/accounting";
import { describeError } from "@/lib/http";
import { formatWonPart } from "@/lib/money";

import AdminTable from "../components/AdminTable";

import styles from "../admin.module.css";

const DAY_CHOICES = [7, 14, 30];

export default function CachePanel() {
  const [days, setDays] = useState(14);
  const [loaded, setLoaded] = useState<{ days: number; rows: CacheRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCachePanel(days)
      .then((rows) => {
        if (!cancelled) setLoaded({ days, rows });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const rows = loaded !== null && loaded.days === days ? loaded.rows : null;
  const saved = rows?.reduce((sum, row) => sum + row.saved_krw, 0) ?? 0;

  return (
    <>
      <div className={styles.actionRow} role="group" aria-label="기간">
        {DAY_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            className="chip"
            aria-pressed={choice === days}
            onClick={() => setDays(choice)}
          >
            최근 {choice}일
          </button>
        ))}
        <a className="btn btn-sm" href={exportUrl.caching(days)} download>
          캐시 CSV
        </a>
      </div>
      {error !== null ? (
        <div className="card">
          <p className="small muted">캐시 기록을 불러오지 못했습니다. {error}.</p>
        </div>
      ) : rows === null ? (
        <Skeleton />
      ) : (
        <>
          <p className="small muted" data-testid="cache-total">
            최근 {days}일 동안 캐시로 아낀 금액 약 {formatWonPart(saved)}
          </p>
          <AdminTable
            columns={[
              { key: "day", header: "날짜", render: (row) => row.day.replaceAll("-", ".") },
              { key: "model", header: "모델", render: (row) => row.model_id },
              {
                key: "replies",
                header: "답장 (적중)",
                numeric: true,
                render: (row) => `${row.replies} (${row.hit_replies})`,
              },
              {
                key: "rate",
                header: "적중률",
                numeric: true,
                render: (row) => (row.hit_rate === null ? "–" : `${Math.round(row.hit_rate * 100)}%`),
              },
              {
                key: "read",
                header: "읽은 토큰",
                numeric: true,
                render: (row) => row.read_tokens.toLocaleString("ko-KR"),
              },
              {
                key: "written",
                header: "쓴 토큰",
                numeric: true,
                render: (row) => row.write_tokens.toLocaleString("ko-KR"),
              },
              {
                key: "write",
                header: "캐시 쓰기",
                numeric: true,
                render: (row) => formatWonPart(row.write_krw),
              },
              {
                key: "saved",
                header: "아낀 금액",
                numeric: true,
                render: (row) => `${formatWonPart(row.saved_krw)}${row.estimated ? " (어림)" : ""}`,
              },
            ]}
            rows={rows}
            rowKey={(row) => `${row.day}-${row.model_id}`}
            empty="이 기간에는 채팅 답장이 없습니다."
            caption="모델별·날짜별 캐시"
          />
          <p className="small dim" style={{ marginTop: "0.6rem" }}>
            적중률 = 캐시에서 읽은 토큰 ÷ 입력 전체(새 입력 + 캐시 쓰기 + 캐시 읽기). 같은
            대화를 5분 안에 이어 보내면 읽기가 생깁니다. Haiku 4.5는 앞부분이 4,096토큰보다
            짧으면 캐시하지 않으므로 0%가 정상입니다.
          </p>
        </>
      )}
    </>
  );
}
