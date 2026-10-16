"use client";

/**
 * Admin › AI Models › 비용 보정 (cost-calibration).
 *
 * 보내기 전에는 어림만 할 수 있습니다 — 입력은 한 글자에 한 토큰(일부러
 * 넉넉하게), "답장 1회 약 N원"은 입력 3,000 · 출력 800 토큰. 보낸 뒤에는
 * 제공자가 실제 토큰 수를 알려 주고, 사용 기록이 둘을 나란히 갖고
 * 있습니다. 이 표는 모델마다 그 차이를 보여 줍니다. Anthropic Console의
 * 사용량과 맞춰 볼 숫자이기도 합니다.
 *
 * 읽기 전용입니다. 최근 답장이 10개 이상 쌓이면 보정이 저절로 쓰입니다.
 */

import { useEffect, useState } from "react";

import { getChatCacheStats, getChatCalibration, type ModelCacheDay, type ModelCalibration } from "@/lib/admin";
import { describeError } from "@/lib/http";
import { formatKrw } from "@/lib/quarters";
import Skeleton from "@/app/components/Skeleton";

function tokens(value: number | null): string {
  return value === null ? "–" : Math.round(value).toLocaleString("ko-KR");
}

function percent(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

export default function CalibrationPanel() {
  const [rows, setRows] = useState<ModelCalibration[] | null>(null);
  const [cacheDays, setCacheDays] = useState<ModelCacheDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 효과 본문에서 바로 상태를 바꾸지 않도록 약속이 끝난 뒤 반영합니다.
  useEffect(() => {
    let cancelled = false;
    getChatCalibration()
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    // 캐시 절약은 덤입니다: 못 불러와도 본표는 그대로 보입니다.
    getChatCacheStats()
      .then((result) => {
        if (!cancelled) setCacheDays(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>

      {error !== null ? (
        <p className="small muted">보정 정보를 불러오지 못했습니다. {error}.</p>
      ) : rows === null ? (
        <Skeleton />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">모델별 비용 보정</caption>
            <thead>
              <tr>
                <th scope="col">모델</th>
                <th scope="col">답장 수</th>
                <th scope="col">입력: 어림 → 실제</th>
                <th scope="col">보정 배수</th>
                <th scope="col">평균 출력</th>
                <th scope="col">답장 1회 (중앙값 / 평균)</th>
                <th scope="col">공식 어림값</th>
                <th scope="col">캐시 적중</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.model_id}>
                  <td>
                    {row.label}
                    <span className="small dim"> · {row.calibrated ? "보정 중" : "공식 사용"}</span>
                  </td>
                  <td className="numeric">{row.samples.toLocaleString("ko-KR")}</td>
                  <td className="numeric">
                    {tokens(row.avg_estimated_tokens)} → {tokens(row.avg_prompt_tokens)}
                  </td>
                  <td className="numeric">×{row.input_factor.toFixed(2)}</td>
                  <td className="numeric">{tokens(row.avg_output_tokens)}</td>
                  <td className="numeric">
                    {row.median_reply_krw === null ? "–" : formatKrw(row.median_reply_krw)}
                    {row.avg_reply_krw !== null && (
                      <span className="small dim"> / {formatKrw(Math.round(row.avg_reply_krw))}</span>
                    )}
                  </td>
                  <td className="numeric">
                    {row.formula_reply_krw === null ? "–" : formatKrw(row.formula_reply_krw)}
                  </td>
                  <td className="numeric">{percent(row.cache_hit_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="small dim" style={{ marginTop: "0.6rem" }}>
        답장이 10회 이상 쌓인 모델은 회원이 보는 &quot;답장 1회 약 N원&quot;이 실제 답장의 중앙값으로
        바뀌고, 보내기 전 지원금 확인은 입력을 &quot;보정 배수&quot;만큼만 잡습니다(1을 넘지 않고, 출력은
        여전히 최대치로 잡습니다). 대화 기록을 자르는 기준은 바꾸지 않습니다 — 바꾸면 프롬프트
        캐시가 깨집니다.
      </p>

      {/* PART F: 캐싱이 실제로 일하는지 — 모델·일별 적중률과 아낀 돈. */}
      {cacheDays !== null && cacheDays.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: "1.4rem" }} id="cache-savings">
            캐시 절약 <span className="small dim" style={{ fontWeight: 400 }}>최근 14일 · KST</span>
          </h3>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">모델별 일별 캐시 활동</caption>
              <thead>
                <tr>
                  <th scope="col">날짜</th>
                  <th scope="col">모델</th>
                  <th scope="col">답장</th>
                  <th scope="col">캐시 적중</th>
                  <th scope="col">캐시에서 읽음</th>
                  <th scope="col">아낀 금액</th>
                </tr>
              </thead>
              <tbody>
                {cacheDays.map((day) => (
                  <tr key={`${day.day}-${day.model_id}`}>
                    <td className="numeric">{day.day}</td>
                    <td>{day.label}</td>
                    <td className="numeric">{day.replies.toLocaleString("ko-KR")}</td>
                    <td className="numeric">
                      {day.replies > 0 ? Math.round((day.cache_hit_replies / day.replies) * 100) : 0}%
                    </td>
                    <td className="numeric">{day.read_tokens.toLocaleString("ko-KR")} 토큰</td>
                    <td className="numeric">{formatKrw(day.saved_krw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small dim" style={{ marginTop: "0.6rem" }}>
            아낀 금액은 캐시에서 읽은 토큰을 입력 요금 대신 읽기 요금으로 계산한 차이 — 오늘의
            카탈로그 요금 기준 어림입니다. 두 번째 답장부터 적중이 쌓이는 것이 정상이고, Haiku는
            대화가 길어져야(4,096 토큰 이상) 캐시가 잡히기 시작합니다.
          </p>
        </>
      )}
    </>
  );
}
