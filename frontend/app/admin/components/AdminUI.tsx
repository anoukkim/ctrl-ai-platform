"use client";

/**
 * Admin의 부품 한 벌 (admin-ui-unify, owner 2026-10-22: "이걸로 전체 admin
 * 적용해").
 *
 * 규칙은 시안 그대로입니다.
 *  1. 구역의 제목과 설명은 틀(`AdminFrame`)이 **한 번** 그립니다. 탭 안의
 *     화면은 제목을 다시 쓰지 않고 `PanelBar`(검색 · ? · 단추)로 시작해요.
 *  2. 연결·상태는 맨 위의 `StatusStrip`에서 — 목록 안의 스위치와 섞지 않아요.
 *  3. 목록은 `ItemList` 하나: 이름과 상태 표(`Tag`), 숫자 두세 개(`ItemRow`의
 *     `cells`), 오른쪽 끝의 단추 하나. 모델 ID 같은 것은 작은 회색 글자.
 *  4. 바꾸는 일은 오른쪽 `SidePanel`에서 — 표 안에 입력칸을 늘어놓지 않아요.
 *  5. 긴 설명은 `PanelBar`의 ? 뒤로 접어요.
 *  6. 숫자 입력은 `NumField`(작은 칸 + 단위), 설정 묶음은 `SettingsCard`.
 */

import { HelpCircle, X } from "lucide-react";
import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";

import styles from "./AdminUI.module.css";

// ------------------------------------------------------------------ tones

export type Tone = "ok" | "warn" | "err" | "off" | "accent";

/** 상태 점과 글자 — 연결됨, 테스트 모드, 보정 중처럼 "지금 어떤가". */
export function Pill({ tone = "off", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`${styles.pill} ${styles[`pill_${tone}`]}`} title={title}>
      {children}
    </span>
  );
}

/** 작은 표 — 회원에게 공개, 기본, 예시 가격처럼 "무엇인가". */
export function Tag({ tone, children, title }: { tone?: "accent" | "warn" | "ok" | "err"; children: ReactNode; title?: string }) {
  return (
    <span className={`${styles.tag} ${tone ? styles[`tag_${tone}`] : ""}`} title={title}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ panel bar

/**
 * 탭 화면의 첫 줄: 왼쪽에 검색이나 짧은 한 줄, ? 단추(누르면 `help`가
 * 아래에 펼쳐짐), 오른쪽에 주요 단추.
 */
export function PanelBar({
  left,
  note,
  help,
  actions,
}: {
  left?: ReactNode;
  /** 왼쪽의 짧은 한 줄 설명. */
  note?: ReactNode;
  /** ?를 누르면 보이는 긴 설명. */
  help?: ReactNode;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={styles.panelTop}>
      <div className={styles.bar}>
        <div className={styles.barLeft}>
          {left}
          {help && (
            <button
              type="button"
              className={styles.helpButton}
              aria-expanded={open}
              aria-controls={id}
              aria-label={open ? "설명 닫기" : "설명 보기"}
              onClick={() => setOpen((value) => !value)}
            >
              <HelpCircle size={15} aria-hidden="true" />
            </button>
          )}
          {note && <span className={styles.barNote}>{note}</span>}
        </div>
        {actions && <div className={styles.barActions}>{actions}</div>}
      </div>
      {help && (
        <div id={id} className={styles.help} hidden={!open}>
          {help}
        </div>
      )}
    </div>
  );
}

/** 탭 화면 안의 작은 소제목(같은 화면에 묶음이 여럿일 때). */
export function SubHeading({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className={styles.subHeading}>
      <h2>{children}</h2>
      {extra && <span className={styles.subHeadingExtra}>{extra}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ status strip

export interface StatusItem {
  key: string;
  name: ReactNode;
  tone: Tone;
  state: ReactNode;
  note?: ReactNode;
  /** 오른쪽 아래의 작은 단추(확인 등). */
  action?: ReactNode;
}

/** 맨 위의 "지금 어떤가" 카드 줄 — 제공자 연결, 서버 상태, 숫자 요약. */
export function StatusStrip({ items, testId }: { items: StatusItem[]; testId?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.status} data-testid={testId}>
      {items.map((item) => (
        <div key={item.key} className={styles.statusCard}>
          <div className={styles.statusRow}>
            <b>{item.name}</b>
            <Pill tone={item.tone}>{item.state}</Pill>
          </div>
          {item.note && <small>{item.note}</small>}
          {item.action && <div className={styles.statusAction}>{item.action}</div>}
        </div>
      ))}
    </div>
  );
}

/** 숫자 요약 카드 줄 — 큰 숫자 하나와 이름. */
export function Stats({ items }: { items: { key: string; value: ReactNode; label: ReactNode; tone?: Tone }[] }) {
  return (
    <div className={styles.stats}>
      {items.map((item) => (
        <div key={item.key} className={styles.stat}>
          <span className={`${styles.statValue} ${item.tone ? styles[`text_${item.tone}`] : ""}`}>{item.value}</span>
          <span className={styles.statLabel}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ list

/** 목록의 틀. `columns`가 있으면 위에 열 이름 줄을 그립니다. */
export function ItemList({
  columns,
  children,
  empty,
  testId,
}: {
  /** 이름 칸 다음의 열 이름(셀 수와 같게). */
  columns?: string[];
  children: ReactNode;
  /** 줄이 하나도 없을 때의 문장 — 줄이 있으면 보이지 않아요. */
  empty?: ReactNode;
  testId?: string;
}) {
  const rows = Children.toArray(children).length;
  return (
    <div className={styles.list} data-testid={testId}>
      {columns && rows > 0 && (
        <div className={styles.colHead} style={gridFor(columns.length)}>
          {columns.map((name, index) => (
            <span key={index} className={index > 0 ? styles.hideNarrow : undefined}>
              {name}
            </span>
          ))}
          <span />
        </div>
      )}
      {children}
      {empty && rows === 0 && <p className={styles.empty}>{empty}</p>}
    </div>
  );
}

/** 묶음 머리(제공자별 등). */
export function ItemGroup({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <b>{title}</b>
        {meta && <span>{meta}</span>}
      </div>
      {children}
    </div>
  );
}

export interface Cell {
  label: string;
  value: ReactNode;
  /** 좁은 화면에서도 남길 칸(하나만). */
  keep?: boolean;
}

function gridFor(cells: number): React.CSSProperties {
  // 이름 칸 + 숫자 칸들 + 단추 칸.
  return { gridTemplateColumns: `minmax(0, 1.6fr) ${"minmax(0, 1fr) ".repeat(Math.max(0, cells - 1))}auto` };
}

/** 목록의 한 줄. */
export function ItemRow({
  title,
  tags,
  sub,
  cells = [],
  action,
  onClick,
  testId,
}: {
  title: ReactNode;
  tags?: ReactNode;
  /** 이름 아래의 작은 회색 줄(설명, ID). */
  sub?: ReactNode;
  cells?: Cell[];
  /** 오른쪽 끝(⋯ 설정 등). */
  action?: ReactNode;
  /** 줄 전체를 눌렀을 때(키보드는 `action`의 단추로). */
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <div
      className={`${styles.item} ${onClick ? styles.itemClickable : ""}`}
      style={gridFor(cells.length + 1)}
      onClick={onClick}
      data-testid={testId}
    >
      <div className={styles.name}>
        <div className={styles.nameTitle}>
          {title}
          {tags}
        </div>
        {sub && <div className={styles.nameSub}>{sub}</div>}
      </div>
      {cells.map((cell) => (
        <div key={cell.label} className={`${styles.kv} ${cell.keep ? styles.keep : ""}`}>
          <span className={styles.k}>{cell.label}</span>
          <span className={styles.v}>{cell.value}</span>
        </div>
      ))}
      <div className={styles.itemAction} onClick={(event) => event.stopPropagation()}>
        {action}
      </div>
    </div>
  );
}

/** 작은 회색 고정폭 글자(모델 ID 등). */
export function Mono({ children }: { children: ReactNode }) {
  return <span className={styles.mono}>{children}</span>;
}

// ------------------------------------------------------------------ side panel

/**
 * 오른쪽 판 — 설정을 바꾸는 곳. Esc, 바깥, ✕로 닫히고, 열릴 때 판으로
 * 초점이 옮겨지며, 닫히면 원래 자리로 돌아갑니다.
 */
export function SidePanel({
  title,
  subtitle,
  onClose,
  footer,
  children,
  width = "narrow",
  testId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: "narrow" | "wide";
  testId?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  // The element that opened the panel, read in the first render — before
  // any autoFocus inside the panel moves the focus at commit.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(() => {
    const previous = opener;
    // An autoFocus field inside keeps the focus; otherwise the panel takes it.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // 판 위에 뜬 확인 창이 먼저 닫히도록.
      if (event.key === "Escape" && !document.querySelector("[role='dialog'][aria-modal='true']:not([data-side-panel])")) {
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [opener]);

  return (
    <>
      <div className={styles.scrim} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className={`${styles.panel} ${width === "wide" ? styles.panelWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-side-panel=""
        tabIndex={-1}
        data-testid={testId}
      >
        <header className={styles.panelHead}>
          <div className={styles.panelTitle}>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className={styles.panelSub}>{subtitle}</div>}
          </div>
          <button type="button" className={styles.close} aria-label="닫기" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.panelBody}>{children}</div>
        {footer && <footer className={styles.panelFoot}>{footer}</footer>}
      </div>
    </>
  );
}

/** 판 안의 묶음 — 작은 대문자 이름 + 내용. */
export function PanelSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panelSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ fields

/** 켜기/끄기 한 줄 — 이름, 짧은 설명, 스위치. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <label className={styles.switchRow} htmlFor={id}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className={styles.switch}
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={testId}
      />
    </label>
  );
}

/** 이름과 짧은 설명 왼쪽, 작은 칸과 단위 오른쪽. */
export function NumField({
  label,
  hint,
  unit,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  inputMode = "numeric",
  type = "number",
  ariaLabel,
  testId,
}: {
  label: ReactNode;
  hint?: ReactNode;
  unit?: ReactNode;
  value: string | number;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  disabled?: boolean;
  inputMode?: "numeric" | "decimal" | "text";
  type?: "number" | "text";
  ariaLabel?: string;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>
        {label}
        {hint && <small>{hint}</small>}
      </label>
      <span className={styles.inp}>
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          data-testid={testId}
        />
        {unit && <span>{unit}</span>}
      </span>
    </div>
  );
}

/** 설정 묶음 카드 — 제목, 오른쪽 작은 글, 내용. */
export function SettingsCard({
  title,
  extra,
  children,
  wide,
}: {
  title: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  /** 줄 전체를 쓰는 카드(표가 든 카드). */
  wide?: boolean;
}) {
  return (
    <section className={`${styles.card} ${wide ? styles.cardWide : ""}`}>
      <h3 className={styles.cardTitle}>
        <span>{title}</span>
        {extra && <small>{extra}</small>}
      </h3>
      {children}
    </section>
  );
}

/** 설정 카드들을 나란히. */
export function SettingsGrid({ children }: { children: ReactNode }) {
  return <div className={styles.cards}>{children}</div>;
}

/** 저장 줄 — "바뀐 값 N개 · 저장". */
export function SaveBar({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.saveBar}>
      {note && <span>{note}</span>}
      {children}
    </div>
  );
}

/** 섹션 아래의 표 — 가로로 넘치면 그 안에서만 스크롤. */
export function DataTable({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className={styles.tableWrap} data-testid={testId}>
      <table className={styles.table}>{children}</table>
    </div>
  );
}

/** 탭 화면의 세로 묶음 — 위에서 아래로 같은 간격. */
export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}
