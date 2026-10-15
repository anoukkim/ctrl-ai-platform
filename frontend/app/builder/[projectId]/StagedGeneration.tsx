"use client";

/**
 * 단계별 만들기의 화면 조각(quality-tuning Q2).
 *
 * - `StartForm` — 빈 프로젝트의 짧은 질문: 만들고 싶은 앱, 누가 쓰나요, 꼭
 *   필요한 기능 3가지, 원하는 분위기. 아이디어는 Chat에서 가져온 설명으로
 *   미리 채워 두고, 질문은 건너뛸 수 있습니다.
 * - `PlanCard` — 만들 계획(파일과 쓰임)과 진행: "index.html 작성 중… ✓
 *   style.css ✓ …", 점검, 실패하면 한국어 이유와 이어서 만들기.
 */

import { Check, Circle, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type { Generation, PlanInput } from "@/lib/generation";
import { STYLE_CHOICES } from "@/lib/projects";
import { formatKrw } from "@/lib/quarters";

import styles from "./staged.module.css";

export interface Progress {
  /** 지금 쓰고 있는 파일. */
  current: string | null;
  /** 이번 실행에서 다 쓴 파일과 그 금액. */
  charged: Record<string, number>;
  check: "idle" | "running" | "done";
  checkFixed: string[];
  checkSummary: string;
}

export const NO_PROGRESS: Progress = {
  current: null,
  charged: {},
  check: "idle",
  checkFixed: [],
  checkSummary: "",
};

interface StartFormProps {
  initialIdea: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onPlan: (input: PlanInput) => void;
}

export function StartForm({ initialIdea, busy, disabled, error, onPlan }: StartFormProps) {
  const [idea, setIdea] = useState(initialIdea);
  const [who, setWho] = useState("");
  const [features, setFeatures] = useState("");
  const [mood, setMood] = useState("");
  const [skipped, setSkipped] = useState(false);

  return (
    <form
      className={styles.start}
      onSubmit={(event) => {
        event.preventDefault();
        if (!idea.trim()) return;
        onPlan(
          skipped
            ? { request: idea.trim(), style: mood.trim() }
            : { request: idea.trim(), who: who.trim(), features: features.trim(), style: mood.trim(), mood: mood.trim() },
        );
      }}
    >
      <p className={styles.title}>어떤 앱을 만들까요?</p>
      <p className={styles.text}>
        몇 가지만 알려 주면 Claude가 먼저 만들 계획(파일과 쓰임)을 보여 줘요. 계획을 보고
        시작하면 파일을 하나씩 쓰고, 마지막에 한 번 점검해요.
      </p>
      <label className={styles.field}>
        <span>만들고 싶은 앱</span>
        <textarea
          className="field"
          rows={3}
          maxLength={2000}
          value={idea}
          placeholder="예: 한 달 지출을 적고 항목별 합계를 보여 주는 가계부"
          onChange={(event) => setIdea(event.target.value)}
          disabled={disabled || busy}
        />
      </label>
      {!skipped && (
        <>
          <label className={styles.field}>
            <span>누가 쓰나요?</span>
            <input
              className="field"
              maxLength={200}
              value={who}
              placeholder="예: 나 혼자, 우리 반 친구들, 동아리 회원"
              onChange={(event) => setWho(event.target.value)}
              disabled={disabled || busy}
            />
          </label>
          <label className={styles.field}>
            <span>꼭 필요한 기능 3가지</span>
            <textarea
              className="field"
              rows={2}
              maxLength={600}
              value={features}
              placeholder="예: 지출 추가, 항목별 합계, 이번 달 그래프"
              onChange={(event) => setFeatures(event.target.value)}
              disabled={disabled || busy}
            />
          </label>
          <fieldset className={styles.moods}>
            <legend>원하는 분위기</legend>
            {["", ...STYLE_CHOICES].map((choice) => (
              <button
                key={choice || "auto"}
                type="button"
                className={`${styles.mood} ${mood === choice ? styles.moodOn : ""}`}
                aria-pressed={mood === choice}
                onClick={() => setMood(choice)}
                disabled={disabled || busy}
              >
                {choice || "아이디어에 맞게"}
              </button>
            ))}
          </fieldset>
        </>
      )}
      <div className={styles.actions}>
        <button className="btn btn-primary" type="submit" disabled={disabled || busy || !idea.trim()}>
          {busy ? "계획을 세우는 중…" : "만들 계획 세우기"}
        </button>
        <button
          type="button"
          className={styles.link}
          aria-pressed={skipped}
          onClick={() => setSkipped((value) => !value)}
          disabled={busy}
        >
          {skipped ? "질문에 답하기" : "질문 건너뛰기"}
        </button>
      </div>
      <p className={styles.note}>
        계획을 세우는 데는 보통 몇 원이 들어요. 시작하기 전에 전체 예상 금액을 보여 드려요.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}{" "}
          <button className={styles.link} type="submit" disabled={disabled || busy || !idea.trim()}>
            다시 시도
          </button>
        </p>
      )}
    </form>
  );
}

interface PlanCardProps {
  generation: Generation;
  running: boolean;
  progress: Progress;
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
}

/** 파일 한 줄의 상태: 다 씀 / 쓰는 중 / 대기. */
function stepState(generation: Generation, progress: Progress, path: string) {
  if (generation.files_done.includes(path) || path in progress.charged) return "done";
  if (progress.current === path) return "writing";
  return "waiting";
}

export function PlanCard({ generation, running, progress, disabled, onStart, onCancel }: PlanCardProps) {
  const resumable = generation.status === "partial" || generation.status === "failed";
  const estimate =
    generation.estimated_krw !== null
      ? ` · 약 ${formatKrw(generation.estimated_krw)}${
          generation.max_call_krw !== null ? ` (호출마다 최대 ${formatKrw(generation.max_call_krw)})` : ""
        }`
      : "";
  return (
    <section className={styles.plan} aria-label="만들 계획" data-testid="plan-card">
      <p className={styles.title}>{generation.kind === "create" ? "만들 계획" : "바꿀 계획"}</p>
      {generation.summary && <p className={styles.text}>{generation.summary}</p>}
      <ol className={styles.steps}>
        {generation.plan.map((step) => {
          const state = stepState(generation, progress, step.path);
          return (
            <li key={step.path} className={styles.step} data-state={state}>
              <span className={styles.stepIcon} aria-hidden="true">
                {state === "done" ? (
                  <Check size={14} />
                ) : state === "writing" ? (
                  <Loader2 size={14} className={styles.spin} />
                ) : (
                  <Circle size={10} />
                )}
              </span>
              <span className={styles.stepBody}>
                <code className={styles.path}>{step.path}</code>
                {state === "writing" && <span className={styles.status}> 작성 중…</span>}
                {state === "done" && progress.charged[step.path] !== undefined && (
                  <span className={styles.status}> {formatKrw(progress.charged[step.path])}</span>
                )}
                <span className={styles.purpose}>{step.purpose}</span>
              </span>
            </li>
          );
        })}
        {(running || progress.check !== "idle") && (
          <li className={styles.step} data-state={progress.check === "done" ? "done" : progress.check === "running" ? "writing" : "waiting"}>
            <span className={styles.stepIcon} aria-hidden="true">
              {progress.check === "done" ? (
                <Check size={14} />
              ) : progress.check === "running" ? (
                <Loader2 size={14} className={styles.spin} />
              ) : (
                <Circle size={10} />
              )}
            </span>
            <span className={styles.stepBody}>
              <span className={styles.path}>점검</span>
              {progress.check === "running" && <span className={styles.status}> 점검 중…</span>}
              <span className={styles.purpose}>
                {progress.check === "done"
                  ? progress.checkSummary
                  : "끊긴 연결, 없는 id, 눈에 띄는 오류를 찾아 한 번 고쳐요."}
              </span>
            </span>
          </li>
        )}
      </ol>
      <p className={styles.live} role="status" aria-live="polite">
        {running && progress.current ? `${progress.current} 작성 중…` : running && progress.check === "running" ? "점검 중…" : ""}
      </p>
      {generation.error && !running && (
        <p className={styles.error} role="alert">
          <TriangleAlert size={13} aria-hidden="true" /> {generation.error}
          {generation.files_done.length > 0 && " 다 쓴 파일은 저장돼 있어요."}
        </p>
      )}
      {!running && (
        <div className={styles.actions}>
          <button className="btn btn-primary btn-sm" type="button" onClick={onStart} disabled={disabled}>
            {resumable ? "이어서 만들기" : "시작"}
            {estimate}
          </button>
          <button className={styles.link} type="button" onClick={onCancel} disabled={disabled}>
            {resumable ? "처음부터 다시" : "다시 계획"}
          </button>
        </div>
      )}
      {generation.charged_krw > 0 && (
        <p className={styles.note}>지금까지 {formatKrw(generation.charged_krw)} 썼어요. 실패한 호출은 청구되지 않아요.</p>
      )}
    </section>
  );
}
