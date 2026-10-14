"use client";

/**
 * 입력창 아래 "도구" (fix-composer-toolbar).
 *
 * 예전에는 생각 과정 보기 · 웹 검색 · 페이지 읽기 · 코드 실행이 같은 모양의
 * 칩 네 개로 늘어서 있었고, 가격은 하나에만 붙어 있었습니다. 이제 버튼
 * 하나("도구", 켠 것이 있으면 "도구 2")가 작은 판을 엽니다 — 넓은 화면에서는
 * 버튼 위의 팝오버, 휴대폰에서는 아래에서 올라오는 시트. 판의 줄마다 이름 ·
 * 한 줄 설명 · 같은 꼴의 가격 · 켜고 끄는 스위치가 있고, 관리자가 이
 * 모델에 열지 않은 도구는 줄 자체가 없습니다. 켠 도구는 버튼 옆에 작은
 * 칩(이름 + ✕)으로 남습니다.
 *
 * 가격은 모두 백엔드가 준 숫자입니다(영수증과 같은 값) — 여기에 박아 둔
 * 금액은 없습니다.
 */

import { SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { ChatModelOption } from "@/lib/chat";
import { formatKrw } from "@/lib/quarters";

import styles from "./ToolsMenu.module.css";

export type ToolOption = "thinking" | "web_search" | "web_fetch" | "code_execution";

export const TOOL_ORDER: ToolOption[] = ["thinking", "web_search", "web_fetch", "code_execution"];

export const TOOL_LABEL: Record<ToolOption, string> = {
  thinking: "생각 과정 보기",
  web_search: "웹 검색",
  web_fetch: "페이지 읽기",
  code_execution: "코드 실행",
};

export const TOOL_EXPLAIN: Record<ToolOption, string> = {
  thinking: "답장 아래에 Claude가 생각한 순서를 접어서 보여 줘요 (영어일 수 있어요)",
  web_search: "웹에서 최신 정보를 찾아 출처와 함께 답해요",
  web_fetch: "대화에 있는 주소의 페이지를 읽고 답해요",
  code_execution: "계산이나 데이터 정리를 코드로 돌려서 답해요",
};

/** 이 모델에서 보여 줄 도구. 관리자가 열지 않은 것은 숨깁니다. */
export function availableTools(model: ChatModelOption | null): ToolOption[] {
  if (!model) return [];
  return TOOL_ORDER.filter((kind) => {
    if (kind === "thinking") return true;
    if (kind === "web_search") return Boolean(model.tools_web_search);
    if (kind === "web_fetch") return Boolean(model.tools_web_fetch);
    return Boolean(model.tools_code_execution);
  });
}

/** 같은 꼴의 가격: "답장마다 +약 5원" · "검색 1회 약 14원" · "읽기 1회 약 7원" · "약 3원". */
export function toolPrice(kind: ToolOption, model: ChatModelOption | null): string {
  const won = (value: number | null | undefined) =>
    value === null || value === undefined ? null : formatKrw(value);
  if (kind === "thinking") {
    const extra = model?.thinking_extra_krw;
    if (extra === 0) return "추가 비용 없음";
    return extra == null ? "답장마다 비용이 조금 더 들어요" : `답장마다 +약 ${won(extra)}`;
  }
  if (kind === "web_search") {
    const value = won(model?.web_search_krw_per_call);
    return value ? `검색 1회 약 ${value}` : "검색할 때마다 비용이 들어요";
  }
  if (kind === "web_fetch") {
    const value = won(model?.web_fetch_krw_per_use);
    return value ? `읽기 1회 약 ${value}` : "읽을 때마다 비용이 들어요";
  }
  const value = won(model?.code_execution_krw_per_use);
  return value ? `약 ${value}` : "실행할 때마다 비용이 들어요";
}

interface Props {
  model: ChatModelOption | null;
  on: Record<ToolOption, boolean>;
  onToggle: (kind: ToolOption, next: boolean) => void;
  disabled?: boolean;
}

export default function ToolsMenu({ model, on, onToggle, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tools = availableTools(model);
  const active = tools.filter((kind) => on[kind]);

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  // Esc로 닫고, 판 바깥을 누르면 닫습니다.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  // 열리면 첫 스위치로 초점을 옮깁니다.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>("[role=switch]")?.focus();
  }, [open]);

  if (tools.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.button} ${active.length > 0 ? styles.buttonActive : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={active.length > 0 ? `도구 ${active.length}개 켜짐` : "도구"}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        data-testid="tools-button"
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>도구</span>
        {active.length > 0 && (
          <span className={styles.count} aria-hidden="true">
            {active.length}
          </span>
        )}
      </button>

      {active.map((kind) => (
        <span className={styles.chip} key={kind} data-testid="tool-on-chip">
          {TOOL_LABEL[kind]}
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={`${TOOL_LABEL[kind]} 끄기`}
            onClick={() => onToggle(kind, false)}
            disabled={disabled}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}

      {open && (
        <>
          <div className={styles.backdrop} aria-hidden="true" />
          <div
            ref={panelRef}
            id={panelId}
            className={styles.panel}
            role="group"
            aria-label="도구"
            data-testid="tools-panel"
          >
            <div className={styles.panelHead}>
              <span className={styles.panelTitle}>도구</span>
              <button
                type="button"
                className={styles.close}
                aria-label="도구 닫기"
                onClick={() => close(true)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <ul className={styles.rows}>
              {tools.map((kind) => {
                const labelId = `${panelId}-${kind}`;
                return (
                  <li className={styles.row} key={kind}>
                    <span className={styles.rowText}>
                      <span className={styles.rowName} id={labelId}>
                        {TOOL_LABEL[kind]}
                      </span>
                      <span className={styles.rowExplain}>{TOOL_EXPLAIN[kind]}</span>
                      <span className={styles.rowPrice} data-testid={`tool-price-${kind}`}>
                        {toolPrice(kind, model)}
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on[kind]}
                      aria-labelledby={labelId}
                      className={`${styles.switch} ${on[kind] ? styles.switchOn : ""}`}
                      onClick={() => onToggle(kind, !on[kind])}
                      disabled={disabled}
                    >
                      <span className={styles.knob} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className={styles.note}>
              켠 도구는 이 대화에만 적용돼요. 웹 검색어는 검색 서비스로 전달돼요.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
