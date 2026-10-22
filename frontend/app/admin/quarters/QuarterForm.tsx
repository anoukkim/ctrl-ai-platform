"use client";

/**
 * 새 분기를 만드는 양식 — 오른쪽 판(`SidePanel`)에 열립니다(admin-ui-unify).
 *
 * 지금까지 분기를 만드는 길은 `POST /api/admin/quarters`를 직접 부르는
 * 것뿐이었습니다. 그것은 이 제품을 쓰는 사람에게 요구할 수 있는 일이
 * 아닙니다 — CTRL+AI는 코드를 모르는 회원을 위한 곳이고, 관리자라고
 * 해서 다르지 않습니다.
 *
 * 검사는 여기와 백엔드 양쪽에 있습니다. 여기 있는 것은 날짜를 고치러
 * 서버까지 다녀오지 않기 위해서이고, 백엔드에 있는 것은 이 화면이 유일한
 * 입구가 아니기 때문입니다. 둘 중 하나만 두면 어느 쪽이든 뚫립니다.
 *
 * fix-quarter-form-autofill (2026-10-14): 올바른 코드(2026-Q4)를 적으면
 * 이름, 분기 시작·종료일, 신청 시작·마감일이 채워집니다. 채운 값은 고칠 수
 * 있고, **손으로 고친 칸은 코드를 다시 바꿔도 덮어쓰지 않습니다.** 날짜
 * 고르개는 min/max로 순서가 어긋난 날을 고를 수 없게 합니다.
 */

import { useMemo, useRef, useState } from "react";

import { CODE_ERROR, autofill, parseQuarterCode } from "@/lib/quarter-code";
import { formatKrw } from "@/lib/quarters";

import { PanelSection, SidePanel } from "../components/AdminUI";

import styles from "./quarters.module.css";

export interface QuarterInput {
  code: string;
  display_name: string;
  starts_at: string;
  ends_at: string;
  application_opens_at: string | null;
  application_closes_at: string | null;
  subsidy_limit_krw: number | null;
}

/** 분기의 기본 1인 지원금. 백엔드 설정값(QUARTERLY_SUBSIDY_LIMIT_KRW)과 같은 숫자입니다. */
const DEFAULT_LIMIT = 80_000;

/** 코드가 이만큼 길어지면 다 적은 것으로 보고 바로 알려 줍니다(2026-Q4 = 7자). */
const CODE_FULL_LENGTH = 7;

type AutoField = "displayName" | "startsAt" | "endsAt" | "opensAt" | "closesAt";

export default function QuarterForm({
  busy,
  onSubmit,
  onCancel,
  error,
}: {
  busy: boolean;
  /** The last create attempt's failure — shown here, the page's message is under the panel. */
  error?: string | null;
  /** 확인창에 보여 줄 요약을 함께 넘깁니다. */
  onSubmit: (input: QuarterInput, summary: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [limit, setLimit] = useState(String(DEFAULT_LIMIT));
  /** 한 번이라도 보내려 한 뒤에만 빨간 글씨를 보여 줍니다. */
  const [attempted, setAttempted] = useState(false);
  /** 관리자가 손으로 고친 칸 — 코드가 바뀌어도 그대로 둡니다. */
  const touched = useRef<Set<AutoField>>(new Set());

  const setters: Record<AutoField, (value: string) => void> = {
    displayName: setDisplayName,
    startsAt: setStartsAt,
    endsAt: setEndsAt,
    opensAt: setOpensAt,
    closesAt: setClosesAt,
  };

  /** 손으로 고친 칸으로 표시하고 값을 바꿉니다. */
  function edit(field: AutoField, value: string) {
    touched.current.add(field);
    setters[field](value);
  }

  /** 코드가 바뀌면, 올바른 코드일 때 손대지 않은 칸만 채웁니다. */
  function changeCode(value: string) {
    setCode(value);
    const parsed = parseQuarterCode(value);
    if (parsed === null) return;
    const filled = autofill(parsed);
    const values: Record<AutoField, string> = {
      displayName: filled.display_name,
      startsAt: filled.starts_at,
      endsAt: filled.ends_at,
      opensAt: filled.application_opens_at,
      closesAt: filled.application_closes_at,
    };
    for (const field of Object.keys(values) as AutoField[]) {
      if (!touched.current.has(field)) setters[field](values[field]);
    }
  }

  const limitKrw = Number(limit.replaceAll(",", ""));

  /**
   * 칸마다의 잘못된 점. 비어 있으면 보낼 수 있습니다.
   *
   * 한국어로, 무엇을 고쳐야 하는지까지 적습니다 — "잘못된 값입니다"는
   * 고칠 방법을 알려 주지 않습니다.
   */
  const errors = useMemo(() => {
    const found: Record<string, string> = {};

    if (!code.trim()) found.code = "분기 코드를 적어 주세요.";
    else if (parseQuarterCode(code) === null) found.code = `${CODE_ERROR}.`;

    if (!displayName.trim()) found.displayName = "화면에 보일 이름을 적어 주세요.";

    if (!startsAt) found.startsAt = "시작일을 골라 주세요.";
    if (!endsAt) found.endsAt = "종료일을 골라 주세요.";
    else if (startsAt && endsAt <= startsAt)
      found.endsAt = "종료일은 시작일보다 뒤여야 합니다.";

    // 신청 기간은 생략할 수 있지만, 한쪽만 적을 수는 없습니다.
    if (Boolean(opensAt) !== Boolean(closesAt)) {
      found.opensAt = "신청 기간은 시작일과 마감일을 함께 적거나 둘 다 비워 주세요.";
    } else if (opensAt && closesAt) {
      if (closesAt < opensAt) found.closesAt = "신청 마감일은 신청 시작일보다 뒤여야 합니다.";
      else if (endsAt && closesAt > endsAt)
        found.closesAt = "신청 마감일은 분기 종료일보다 뒤일 수 없습니다.";
    }

    if (!limit.trim() || Number.isNaN(limitKrw) || limitKrw < 0) {
      found.limit = "1인 지원금을 0 이상의 숫자로 적어 주세요.";
    }

    return found;
  }, [code, displayName, startsAt, endsAt, opensAt, closesAt, limit, limitKrw]);

  const valid = Object.keys(errors).length === 0;

  function submit() {
    setAttempted(true);
    if (!valid) return;

    const input: QuarterInput = {
      code: parseQuarterCode(code)?.code ?? code.trim().toUpperCase(),
      display_name: displayName.trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      application_opens_at: opensAt || null,
      application_closes_at: closesAt || null,
      subsidy_limit_krw: limitKrw,
    };

    const summary =
      `${input.display_name}(${input.code}) 분기를 만듭니다. ` +
      `기간은 ${input.starts_at} – ${input.ends_at}, ` +
      (input.application_opens_at
        ? `신청은 ${input.application_opens_at} – ${input.application_closes_at}, `
        : "신청 기간은 아직 정하지 않았고, ") +
      `참여 회원 한 명의 지원금은 ${formatKrw(limitKrw)}입니다. ` +
      "분기는 준비 상태로 만들어지며, 신청은 따로 열어야 합니다.";

    onSubmit(input, summary);
  }

  function errorFor(field: string): string | undefined {
    // 코드는 다 적은 뒤라면 보내기 전에도 바로 알려 줍니다.
    if (field === "code" && code.trim().length >= CODE_FULL_LENGTH) return errors.code;
    return attempted ? errors[field] : undefined;
  }

  return (
    <SidePanel
      title="새 분기"
      subtitle="준비 상태로 만들어져요 · 신청은 만든 뒤 따로 열어요"
      onClose={onCancel}
      testId="quarter-form"
      footer={
        <>
          <button className="btn btn-sm" type="button" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={submit}>
            분기 만들기
          </button>
        </>
      }
    >
      <PanelSection title="이름">
        <Field
          htmlFor="quarter-code"
          label="분기 코드"
          hint="2026-Q4 꼴. 적으면 이름과 날짜가 채워져요(고칠 수 있음)."
          error={errorFor("code")}
        >
          <input
            id="quarter-code"
            value={code}
            placeholder="2026-Q4"
            onChange={(event) => changeCode(event.target.value)}
          />
        </Field>

        <Field htmlFor="quarter-name" label="화면에 보일 이름" error={errorFor("displayName")}>
          <input
            id="quarter-name"
            value={displayName}
            placeholder="2026 Q4"
            onChange={(event) => edit("displayName", event.target.value)}
          />
        </Field>
      </PanelSection>

      <PanelSection title="분기 기간">
        <div className={styles.formPair}>
          <Field htmlFor="quarter-starts" label="분기 시작일" error={errorFor("startsAt")}>
            <input
              id="quarter-starts"
              type="date"
              value={startsAt}
              onChange={(event) => edit("startsAt", event.target.value)}
            />
          </Field>

          <Field htmlFor="quarter-ends" label="분기 종료일" error={errorFor("endsAt")}>
            <input
              id="quarter-ends"
              type="date"
              value={endsAt}
              min={startsAt || undefined}
              onChange={(event) => edit("endsAt", event.target.value)}
            />
          </Field>
        </div>
      </PanelSection>

      <PanelSection title="신청 기간">
        <div className={styles.formPair}>
          <Field htmlFor="quarter-opens" label="신청 시작일" error={errorFor("opensAt")}>
            <input
              id="quarter-opens"
              type="date"
              value={opensAt}
              max={endsAt || undefined}
              onChange={(event) => edit("opensAt", event.target.value)}
            />
          </Field>

          <Field htmlFor="quarter-closes" label="신청 마감일" error={errorFor("closesAt")}>
            <input
              id="quarter-closes"
              type="date"
              value={closesAt}
              min={opensAt || startsAt || undefined}
              max={endsAt || undefined}
              onChange={(event) => edit("closesAt", event.target.value)}
            />
          </Field>
        </div>
        <p className={styles.hint}>비워 두면 나중에 정할 수 있어요.</p>
      </PanelSection>

      <PanelSection title="지원금">
        <Field
          htmlFor="quarter-limit"
          label="1인 지원금 (원)"
          hint="참여 신청 한 번이 받는 금액 · 모든 기능이 이 지갑 하나에서 써요. 나중에 바꿔도 이미 승인된 지갑은 그대로예요."
          error={errorFor("limit")}
        >
          <input
            id="quarter-limit"
            inputMode="numeric"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
        </Field>
      </PanelSection>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {attempted && !valid && (
        <p className={styles.error} role="alert">
          적지 않았거나 잘못된 칸이 있어요. 빨간 글씨를 확인해 주세요.
        </p>
      )}
    </SidePanel>
  );
}

/**
 * 라벨 한 줄 + 칸 + 설명.
 *
 * `htmlFor`는 장식이 아닙니다. 라벨을 눌렀을 때 칸으로 초점이 가고,
 * 화면 낭독기가 "분기 코드, 입력란"이라고 읽어 주는 것이 전부 이 연결에
 * 달려 있습니다. 그래서 칸의 id를 Field가 받습니다.
 */
export function Field({
  htmlFor,
  label,
  hint,
  error,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.formField}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : (
        hint && <span className={styles.hint}>{hint}</span>
      )}
    </div>
  );
}
