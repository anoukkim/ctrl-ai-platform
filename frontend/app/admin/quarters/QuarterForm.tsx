"use client";

/**
 * 새 분기를 만드는 양식.
 *
 * 지금까지 분기를 만드는 길은 `POST /api/admin/quarters`를 직접 부르는
 * 것뿐이었습니다. 그것은 이 제품을 쓰는 사람에게 요구할 수 있는 일이
 * 아닙니다 — CTRL+AI는 코드를 모르는 회원을 위한 곳이고, 관리자라고
 * 해서 다르지 않습니다.
 *
 * 검사는 여기와 백엔드 양쪽에 있습니다. 여기 있는 것은 날짜를 고치러
 * 서버까지 다녀오지 않기 위해서이고, 백엔드에 있는 것은 이 화면이 유일한
 * 입구가 아니기 때문입니다. 둘 중 하나만 두면 어느 쪽이든 뚫립니다.
 */

import { useMemo, useState } from "react";

import { formatKrw } from "@/lib/quarters";

import styles from "../admin.module.css";

export interface QuarterInput {
  code: string;
  display_name: string;
  starts_at: string;
  ends_at: string;
  application_opens_at: string | null;
  application_closes_at: string | null;
  subsidy_limit_krw: number | null;
}

/** 분기 하나의 기본 지원 한도. 백엔드 설정값과 같은 숫자입니다. */
const DEFAULT_LIMIT = 100_000;

/** "2026-Q1" 또는 "2026Q1" 꼴인지. 코드로 분기를 찾는 곳이 여럿입니다. */
const CODE_PATTERN = /^\d{4}-?Q[1-4]$/i;

export default function QuarterForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
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
    else if (!CODE_PATTERN.test(code.trim()))
      found.code = "2026-Q1 꼴로 적어 주세요.";

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
      found.limit = "1인 한도를 0 이상의 숫자로 적어 주세요.";
    }

    return found;
  }, [code, displayName, startsAt, endsAt, opensAt, closesAt, limit, limitKrw]);

  const valid = Object.keys(errors).length === 0;

  function submit() {
    setAttempted(true);
    if (!valid) return;

    const input: QuarterInput = {
      code: code.trim().toUpperCase(),
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
      `1인 한도는 ${formatKrw(limitKrw)}입니다. ` +
      "분기는 준비 상태로 만들어지며, 신청은 따로 열어야 합니다.";

    onSubmit(input, summary);
  }

  function errorFor(field: string): string | undefined {
    return attempted ? errors[field] : undefined;
  }

  return (
    <div className={`card ${styles.quarterForm}`}>
      <div className={styles.formGrid}>
        <Field
          htmlFor="quarter-code"
          label="분기 코드"
          hint="2026-Q1 꼴. 주소와 기록에 쓰입니다."
          error={errorFor("code")}
        >
          <input
            className="field"
            id="quarter-code"
            value={code}
            placeholder="2027-Q1"
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>

        <Field htmlFor="quarter-name" label="화면에 보일 이름" error={errorFor("displayName")}>
          <input
            className="field"
            id="quarter-name"
            value={displayName}
            placeholder="2027 Q1"
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>

        <Field htmlFor="quarter-starts" label="분기 시작일" error={errorFor("startsAt")}>
          <input
            className="field"
            id="quarter-starts"
            type="date"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </Field>

        <Field htmlFor="quarter-ends" label="분기 종료일" error={errorFor("endsAt")}>
          <input
            className="field"
            id="quarter-ends"
            type="date"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </Field>

        <Field
          htmlFor="quarter-opens"
          label="신청 시작일"
          hint="비워 두면 나중에 정할 수 있습니다."
          error={errorFor("opensAt")}
        >
          <input
            className="field"
            id="quarter-opens"
            type="date"
            value={opensAt}
            onChange={(event) => setOpensAt(event.target.value)}
          />
        </Field>

        <Field htmlFor="quarter-closes" label="신청 마감일" error={errorFor("closesAt")}>
          <input
            className="field"
            id="quarter-closes"
            type="date"
            value={closesAt}
            onChange={(event) => setClosesAt(event.target.value)}
          />
        </Field>

        <Field
          htmlFor="quarter-limit"
          label="1인 한도 (원)"
          hint="한 회원이 이 분기에 받을 수 있는 동아리 지원금의 최대입니다."
          error={errorFor("limit")}
        >
          <input
            className="field"
            id="quarter-limit"
            inputMode="numeric"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
        </Field>
      </div>

      {attempted && !valid && (
        <p className="small" role="alert" style={{ color: "var(--error-text)" }}>
          적지 않았거나 잘못된 칸이 있습니다. 위의 빨간 글씨를 확인해 주세요.
        </p>
      )}

      <div className={styles.actionRow}>
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={submit}>
          분기 만들기
        </button>
        <button className="btn btn-sm" type="button" disabled={busy} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

/**
 * 라벨 한 줄 + 칸 + 설명.
 *
 * `htmlFor`는 장식이 아닙니다. 라벨을 눌렀을 때 칸으로 초점이 가고,
 * 화면 낭독기가 "분기 코드, 입력란"이라고 읽어 주는 것이 전부 이 연결에
 * 달려 있습니다. 그래서 칸의 id를 Field가 받습니다.
 */
function Field({
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
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : (
        hint && <span className={styles.fieldHint}>{hint}</span>
      )}
    </div>
  );
}
