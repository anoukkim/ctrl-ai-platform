"use client";

/**
 * 분기 수정 (admin-ui-unify) — 오른쪽 판에서 이름과 1인 지원금을 바꿉니다.
 *
 * 날짜는 여기서 바꾸지 않습니다: 신청 마감일은 「신청 기한 연장」이, 분기
 * 기간은 만들 때 정합니다. 1인 지원금을 바꿔도 이미 승인된 지갑은 그대로이고
 * (지갑은 승인 때 복사됩니다), 바꾼 내용은 백엔드가 감사 기록에 남깁니다.
 */

import { useState } from "react";

import { describeError } from "@/lib/http";
import { formatDate, updateQuarter, type Quarter } from "@/lib/quarters";

import { NumField, PanelSection, SidePanel } from "../components/AdminUI";
import { Field } from "./QuarterForm";

import styles from "./quarters.module.css";

export default function QuarterEditPanel({
  quarter,
  onClose,
  onSaved,
}: {
  quarter: Quarter;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(quarter.display_name);
  const [limit, setLimit] = useState(String(quarter.subsidy_limit_krw));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limitKrw = Number(limit.replaceAll(",", ""));
  const problem = !name.trim()
    ? "화면에 보일 이름을 적어 주세요."
    : !limit.trim() || !Number.isInteger(limitKrw) || limitKrw < 0
      ? "1인 지원금을 0 이상의 숫자로 적어 주세요."
      : null;
  const changes: { display_name?: string; subsidy_limit_krw?: number } = {};
  if (name.trim() !== quarter.display_name) changes.display_name = name.trim();
  if (problem === null && limitKrw !== quarter.subsidy_limit_krw) changes.subsidy_limit_krw = limitKrw;
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateQuarter(quarter.id, changes);
      onSaved(`${changes.display_name ?? quarter.display_name} 분기를 고쳤습니다.`);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <SidePanel
      title={`${quarter.display_name} 수정`}
      subtitle={`${quarter.code} · ${formatDate(quarter.starts_at)} – ${formatDate(quarter.ends_at)}`}
      onClose={onClose}
      testId="quarter-edit"
      footer={
        <>
          <button className="btn btn-sm" type="button" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            onClick={() => void save()}
            disabled={busy || problem !== null || !dirty}
          >
            {busy ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      <PanelSection title="이름">
        <Field htmlFor="quarter-edit-name" label="화면에 보일 이름">
          <input id="quarter-edit-name" value={name} maxLength={50} onChange={(event) => setName(event.target.value)} />
        </Field>
      </PanelSection>
      <PanelSection title="지원금">
        <NumField
          label="1인 지원금"
          hint="새로 신청하는 회원부터 · 이미 올라온 신청과 승인된 지갑은 그대로"
          unit="원"
          min={0}
          step={1000}
          value={limit}
          onChange={setLimit}
        />
      </PanelSection>
      <p className={styles.hint}>날짜: 신청 마감일은 목록의 「신청 기한 연장」에서 바꿔요. 바꾼 내용은 감사 기록에 남아요.</p>
      {(problem ?? error) && (
        <p className={styles.error} role="alert">
          {problem ?? error}
        </p>
      )}
    </SidePanel>
  );
}
