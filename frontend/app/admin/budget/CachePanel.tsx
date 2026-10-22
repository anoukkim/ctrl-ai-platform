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

import { DataTable, Mono, PanelBar, Stack } from "../components/AdminUI";

import styles from "../quarters/quarters.module.css";

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
    <Stack>
      <PanelBar
        left={
          <span className={styles.buttons} role="group" aria-label="기간">
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
          </span>
        }
        help={
          <p>
            적중률 = 캐시에서 읽은 토큰 ÷ 입력 전체(새 입력 + 캐시 쓰기 + 캐시 읽기). 같은 대화를 5분 안에 이어 보내면
            읽기가 생겨요. 아낀 금액은 읽은 토큰을 그냥 입력으로 냈다면 들었을 금액 − 실제 낸 캐시 읽기 금액이에요. 채팅
            답장만 세요. Haiku 4.5는 앞부분이 4,096토큰보다 짧으면 캐시하지 않으므로 0%가 정상이에요.
          </p>
        }
        actions={
          <a className="btn btn-sm" href={exportUrl.caching(days)} download>
            캐시 CSV
          </a>
        }
      />
      {error !== null ? (
        <p className={styles.muted}>캐시 기록을 불러오지 못했습니다. {error}.</p>
      ) : rows === null ? (
        <Skeleton />
      ) : (
        <>
          <p className={styles.muted} data-testid="cache-total">
            최근 {days}일 동안 캐시로 아낀 금액 약 {formatWonPart(saved)}
          </p>
          <DataTable testId="cache-table">
            <caption className="sr-only">모델별·날짜별 캐시</caption>
            <thead>
              <tr>
                <th scope="col">날짜</th>
                <th scope="col">모델</th>
                <th scope="col" data-numeric="">답장 (적중)</th>
                <th scope="col" data-numeric="">적중률</th>
                <th scope="col" data-numeric="">읽은 토큰</th>
                <th scope="col" data-numeric="">쓴 토큰</th>
                <th scope="col" data-numeric="">캐시 쓰기</th>
                <th scope="col" data-numeric="">아낀 금액</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="small dim">
                    이 기간에는 채팅 답장이 없어요.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.day}-${row.model_id}`}>
                    <td>{row.day.replaceAll("-", ".")}</td>
                    <td>
                      <Mono>{row.model_id}</Mono>
                    </td>
                    <td data-numeric="">
                      {row.replies} ({row.hit_replies})
                    </td>
                    <td data-numeric="">{row.hit_rate === null ? "–" : `${Math.round(row.hit_rate * 100)}%`}</td>
                    <td data-numeric="">{row.read_tokens.toLocaleString("ko-KR")}</td>
                    <td data-numeric="">{row.write_tokens.toLocaleString("ko-KR")}</td>
                    <td data-numeric="">{formatWonPart(row.write_krw)}</td>
                    <td data-numeric="">
                      {formatWonPart(row.saved_krw)}
                      {row.estimated ? " (어림)" : ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </>
      )}
    </Stack>
  );
}
