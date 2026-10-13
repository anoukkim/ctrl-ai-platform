"use client";

/**
 * Admin › Claude Models › 비용 보정 (cost-calibration).
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

import { getChatCalibration, type ModelCalibration } from "@/lib/admin";
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
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="claude-calibration" style={{ marginTop: "2rem" }}>
      <h2 className="section-title" id="claude-calibration">
        비용 보정
        <span className="small dim" style={{ marginLeft: "0.5rem", fontWeight: 400 }}>
          어림값과 실제 답장 비교 · 최근 200회까지
        </span>
      </h2>

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
    </section>
  );
}
