"use client";

/**
 * 모델 + 생각 깊이 고르기(quality-tuning Q1) — Chat 입력창, 새 대화 화면,
 * Builder의 Claude 판, Profile › 기본 모델이 모두 이 하나를 씁니다.
 *
 * 단추는 "<모델> · <깊이>". 누르면 창이 열리고(390px 폭에서는 아래에서
 * 올라오는 시트), 위에는 모델 목록(한 줄 설명과 "1회 약 N원"), 아래에는
 * 생각 깊이 막대(낮음 · 보통 · 높음, 모델이 지원하면 최고)와 그 깊이의
 * 안내, "1회 약 N원 (최대 M원)"이 있습니다. 깊이 조절이 없는 모델은
 * 막대 대신 "이 모델은 깊이 조절이 없어요"라고만 말합니다.
 *
 * 고르는 즉시 `onChange`가 불립니다 — 저장은 부르는 쪽(대화, 프로젝트,
 * 회원 기본값)이 합니다. 숫자는 서버가 보낸 것을 보여 줄 뿐입니다.
 */

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  continueText,
  type DepthLevel,
  levelFor,
  modelCostText,
  type PickerModel,
  priceText,
  triggerText,
} from "@/lib/depth";

import styles from "./model-depth-picker.module.css";

interface Props {
  models: PickerModel[];
  /** 지금 고른 모델. 더는 쓸 수 없는 모델이면 null. */
  current: PickerModel | null;
  level: DepthLevel | null;
  onChange: (model: PickerModel, level: DepthLevel) => void;
  disabled?: boolean;
  /** 입력창처럼 바닥에 있으면 위로, 아니면 아래로 엽니다. */
  placement?: "up" | "down";
  /** 화면 오른쪽에 있으면 "end" — 창의 오른쪽 끝을 단추에 맞춥니다. */
  align?: "start" | "end";
  /** 창 아래 작은 글씨. */
  footnote?: string;
  /** 단추에 붙는 접근성 이름의 앞부분("답장 방식", "빌더 모델"). */
  name?: string;
}

export default function ModelDepthPicker({
  models,
  current,
  level,
  onChange,
  disabled,
  placement = "up",
  align = "start",
  footnote,
  name = "모델과 생각 깊이",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const sliderId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (models.length === 0) return null;

  const step = current ? levelFor(current, level) : null;
  const stepIndex = current && step ? current.levels.findIndex((row) => row.level === step.level) : -1;

  const pickModel = (model: PickerModel) => {
    // 새 모델에 같은 깊이가 없으면 보통으로(levelFor가 고릅니다).
    const next = levelFor(model, level)?.level ?? level ?? "medium";
    onChange(model, next);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${current ? "" : styles.triggerWarn}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={current ? `${name}: ${triggerText(current, level)}. 바꾸기` : `${name}을 골라 주세요`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        data-testid="model-depth-trigger"
      >
        <span className={styles.triggerLabel}>{current ? triggerText(current, level) : "모델을 골라 주세요"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className={styles.backdrop} aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            className={`${styles.popover} ${placement === "down" ? styles.down : styles.up} ${align === "end" ? styles.end : ""}`}
            role="dialog"
            aria-label={name}
            data-testid="model-depth-popover"
          >
            <p className={styles.heading}>모델</p>
            <ul className={styles.list} id={listId} role="listbox" aria-label="모델">
              {models.map((model) => {
                const selected = current?.id === model.id;
                return (
                  <li key={model.id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={`${styles.option} ${selected ? styles.optionSelected : ""}`}
                      onClick={() => {
                        if (!selected) pickModel(model);
                      }}
                    >
                      <span className={styles.optionHead}>
                        <span className={styles.optionLabel}>{model.label}</span>
                        {model.is_default && <span className="badge badge-muted">기본</span>}
                        {model.admin_only && <span className="badge badge-warn">관리자만</span>}
                        <span className={styles.optionCost}>{modelCostText(model, level)}</span>
                        {selected && <Check size={14} aria-hidden="true" className={styles.check} />}
                      </span>
                      <span className={styles.optionDescription}>{model.description}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {current && (
              <div className={styles.depth}>
                <p className={styles.heading} id={sliderId}>
                  생각 깊이
                </p>
                {current.levels.length === 0 || step === null ? (
                  <p className={styles.noDepth} data-testid="no-depth">
                    이 모델은 깊이 조절이 없어요.
                  </p>
                ) : (
                  <>
                    <input
                      className={styles.slider}
                      type="range"
                      min={0}
                      max={current.levels.length - 1}
                      step={1}
                      value={stepIndex}
                      aria-labelledby={sliderId}
                      aria-valuetext={step.label}
                      onChange={(event) => {
                        const next = current.levels[Number(event.target.value)];
                        if (next) onChange(current, next.level);
                      }}
                      data-testid="depth-slider"
                    />
                    <div
                      className={styles.stops}
                      style={{ gridTemplateColumns: `repeat(${current.levels.length}, 1fr)` }}
                    >
                      {current.levels.map((row) => (
                        <button
                          key={row.level}
                          type="button"
                          className={`${styles.stop} ${row.level === step.level ? styles.stopOn : ""}`}
                          onClick={() => onChange(current, row.level)}
                          aria-pressed={row.level === step.level}
                        >
                          {row.label}
                        </button>
                      ))}
                    </div>
                    <p className={styles.hint} data-testid="depth-hint">
                      {step.hint}
                    </p>
                    {step.level === "max" && current.depth_note && (
                      <p className={styles.hint}>{current.depth_note}</p>
                    )}
                  </>
                )}
                <p className={styles.price} data-testid="depth-price">
                  {priceText(current, level)}
                </p>
                {continueText(current, level) && (
                  // feat-auto-continue: 1회 한도에 닿으면 서버가 스스로 이어 쓰고,
                  // 답장 전체는 이 금액을 넘지 않아요.
                  <p className={styles.hint} data-testid="depth-continue">
                    {continueText(current, level)}
                  </p>
                )}
              </div>
            )}
            <p className={styles.footnote}>
              {footnote ??
                "금액은 어림값이에요. 실제로는 쓴 만큼만 차감되고, 괄호 안 금액을 넘지 않아요."}
            </p>
            <button type="button" className={`btn btn-primary ${styles.done}`} onClick={() => setOpen(false)}>
              완료
            </button>
          </div>
        </>
      )}
    </div>
  );
}
