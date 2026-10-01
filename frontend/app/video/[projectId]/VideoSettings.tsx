"use client";

/**
 * Video Generator의 생성 설정 — 길이, 비율, 소리.
 *
 * 예전에는 모델이 지원하는 값을 똑같이 생긴 알약 한 줄로 늘어놓았습니다.
 * 읽기 전용 꼬리표처럼 보였고, 무엇이 골라져 있는지 알 수 없었습니다.
 * 이제는 셋을 각자 이름 붙은 조작부로 나눕니다.
 *
 * 고를 수 없는 값은 지우지 않고 흐리게 둔 채 이유를 붙입니다. 사라져
 * 버리면 "원래 없는 기능"인지 "이 모델만 안 되는 것"인지 알 수 없습니다.
 */

import { Check, Volume2, VolumeX } from "lucide-react";

import styles from "./workspace.module.css";

export type Aspect = "9:16" | "16:9" | "1:1";

/** 화면에 쓰는 비율 이름. 숫자만으로는 세로인지 가로인지 바로 안 읽힙니다. */
export const ASPECT_LABEL: Record<Aspect, string> = {
  "9:16": "9:16 세로",
  "16:9": "16:9 가로",
  "1:1": "1:1 정사각",
};

/** 미리보기 틀의 가로세로 비. CSS aspect-ratio 값으로 그대로 씁니다. */
export const ASPECT_RATIO_CSS: Record<Aspect, string> = {
  "9:16": "9 / 16",
  "16:9": "16 / 9",
  "1:1": "1 / 1",
};

export const ALL_ASPECTS: Aspect[] = ["9:16", "16:9", "1:1"];
export const ALL_DURATIONS = [5, 10, 15];

/** 비율을 작은 네모로 그려 줍니다. 글자보다 모양이 먼저 읽힙니다. */
function AspectGlyph({ aspect }: { aspect: Aspect }) {
  const box = { "9:16": { w: 9, h: 15 }, "16:9": { w: 16, h: 9 }, "1:1": { w: 12, h: 12 } }[aspect];
  return (
    <svg
      className={styles.aspectGlyph}
      width="18"
      height="16"
      viewBox="0 0 18 16"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x={(18 - box.w) / 2}
        y={(16 - box.h) / 2}
        width={box.w}
        height={box.h}
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

interface Props {
  duration: number;
  aspect: Aspect;
  sound: boolean;
  /** 고른 모델이 지원하는 값. 비어 있으면 모델이 알려 주지 않은 것입니다. */
  supportedDurations: number[];
  supportedAspects: string[];
  supportsSound: boolean;
  onDuration: (value: number) => void;
  onAspect: (value: Aspect) => void;
  onSound: (value: boolean) => void;
  /**
   * 이번 분기에 참여하지 않아 전부 잠겼을 때의 이유.
   *
   * 값이 있으면 모든 조작부를 잠그고 이 문장을 안내로 씁니다. 모델이
   * 지원하지 않아서 잠긴 것과는 이유가 다르므로, 그 경우의 안내는
   * 그대로 두고 이쪽이 우선합니다.
   */
  lockedReason?: string;
}

export default function VideoSettings({
  duration,
  aspect,
  sound,
  supportedDurations,
  supportedAspects,
  supportsSound,
  onDuration,
  onAspect,
  onSound,
  lockedReason,
}: Props) {
  const locked = Boolean(lockedReason);
  // 모델이 목록을 주지 않았다면 전부 고를 수 있게 둡니다. 비어 있다고
  // 아무것도 못 고르게 하면 화면이 멈춘 것처럼 보입니다.
  const durations = supportedDurations.length > 0 ? supportedDurations : ALL_DURATIONS;
  const aspects = supportedAspects.length > 0 ? supportedAspects : ALL_ASPECTS;

  return (
    <>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel} id="video-duration-label">
          길이
        </span>
        <div className={styles.segmented} role="group" aria-labelledby="video-duration-label">
          {ALL_DURATIONS.map((value) => {
            const allowed = durations.includes(value);
            const active = value === duration;
            return (
              <button
                className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
                key={value}
                type="button"
                onClick={() => onDuration(value)}
                disabled={locked || !allowed}
                aria-pressed={active}
                title={
                  lockedReason ??
                  (allowed ? undefined : "이 모델은 이 길이를 지원하지 않습니다")
                }
              >
                {active && <Check className={styles.segmentCheck} size={13} aria-hidden="true" />}
                {value}초
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.settingRow}>
        <span className={styles.settingLabel} id="video-aspect-label">
          비율
        </span>
        <div className={styles.segmented} role="group" aria-labelledby="video-aspect-label">
          {ALL_ASPECTS.map((value) => {
            const allowed = aspects.includes(value);
            const active = value === aspect;
            return (
              <button
                className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
                key={value}
                type="button"
                onClick={() => onAspect(value)}
                disabled={locked || !allowed}
                aria-pressed={active}
                title={
                  lockedReason ??
                  (allowed ? undefined : "이 모델은 이 비율을 지원하지 않습니다")
                }
              >
                {active && <Check className={styles.segmentCheck} size={13} aria-hidden="true" />}
                <AspectGlyph aspect={value} />
                {ASPECT_LABEL[value]}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>소리</span>
        {supportsSound ? (
          <button
            className={`${styles.soundToggle} ${sound ? styles.soundToggleOn : ""}`}
            type="button"
            onClick={() => onSound(!sound)}
            disabled={locked}
            title={lockedReason}
            aria-pressed={sound}
          >
            {sound ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
            {sound ? "소리 켬" : "소리 끔"}
          </button>
        ) : (
          <p className={styles.settingHint}>이 모델은 소리를 지원하지 않습니다.</p>
        )}
      </div>
    </>
  );
}
