"use client";

/**
 * Quarters › 분기 · 예산 (admin-consolidation v3; admin-ui-unify) — "산 돈이
 * 어디로 나뉘었나". 위에서 아래로: PanelBar(보고 있는 분기 · ? · 새 분기),
 * 지금 분기의 상태, 돈의 흐름(숫자 카드 + 막대), 분기 마감 다섯 단계, 분기
 * 목록. 구역 제목과 설명은 AdminFrame이 한 번 그립니다.
 */

import { useState } from "react";

import { QUARTER_STATUS_LABEL, formatDate, formatKrw } from "@/lib/quarters";

import { useAdminQuarter } from "../AdminQuarterProvider";
import { PanelBar, Stack, StatusStrip } from "../components/AdminUI";
import ResultMessage, { type Result } from "../components/ResultMessage";
import CloseStepper from "./CloseStepper";
import MoneyFlowCard from "./MoneyFlowCard";
import QuarterAdmin, { QUARTER_TONE } from "./QuarterAdmin";

export default function QuarterPlan() {
  const { quarters, selected, refresh } = useAdminQuarter();
  const [result, setResult] = useState<Result | null>(null);
  // After a step, the quarter list below reads itself again.
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);

  return (
    <Stack>
      <PanelBar
        note={selected ? `보고 있는 분기 · ${selected.display_name} (오른쪽 위에서 바꿔요)` : "아직 분기가 없어요"}
        help={
          <>
            <p>
              분기를 만들고 신청을 열고 닫아요. 새 분기는 준비 상태로 만들어지고, 목록의 관리 메뉴에서 신청을 열어야 회원이
              Profile에서 신청할 수 있어요. 올라온 신청은 Members의 승인 대기에서 심사해요.
            </p>
            <p>
              돈의 흐름은 원 기준(장부의 단위)이에요. 실제 원가(제공자 청구, 달러)와 회원 지갑에서 빠진 돈은 따로 기록돼요
              — 원가는 「사용 분석」 탭. 산 크레딧은 분기를 넘어 남아요.
            </p>
            <p>
              목록의 사용 명수는 그 분기에 한 번이라도 예산을 쓴 회원 수(같은 회원은 한 명), 사용률은 사용 명수 ÷ 참여
              회원이에요. 1인 지원금을 바꿔도 이미 승인된 지갑은 그대로예요.
            </p>
          </>
        }
        actions={
          <button className="btn btn-sm btn-primary" type="button" onClick={() => setCreating(true)}>
            + 새 분기
          </button>
        }
      />
      {selected && (
        <StatusStrip
          testId="quarter-status"
          items={[
            {
              key: "quarter",
              name: selected.display_name,
              tone: QUARTER_TONE[selected.status],
              state: QUARTER_STATUS_LABEL[selected.status],
              note: `${formatDate(selected.starts_at)} – ${formatDate(selected.ends_at)}`,
            },
            {
              key: "applications",
              name: "신청 기간",
              tone: selected.status === "application_open" ? "accent" : "off",
              state: selected.status === "application_open" ? "받는 중" : "닫힘",
              note: selected.application_opens_at
                ? `${formatDate(selected.application_opens_at)} – ${formatDate(selected.application_closes_at)}`
                : "아직 정하지 않았어요",
            },
            {
              key: "limit",
              name: "1인 지원금",
              tone: "off",
              state: formatKrw(selected.subsidy_limit_krw),
              note: "승인 때 지갑으로 복사돼요",
            },
          ]}
        />
      )}
      <ResultMessage result={result} onDismiss={() => setResult(null)} />
      {selected && <MoneyFlowCard key={`flow-${selected.id}-${version}`} quarter={selected} />}
      {selected && quarters && (
        <CloseStepper
          key={`steps-${selected.id}-${version}`}
          quarter={selected}
          quarters={quarters}
          onCreateNext={() => setCreating(true)}
          onChanged={(message) => {
            setResult({ kind: "ok", text: message });
            void refresh().then(() => setVersion((value) => value + 1));
          }}
        />
      )}
      <QuarterAdmin key={version} creating={creating} onCreatingChange={setCreating} />
    </Stack>
  );
}
