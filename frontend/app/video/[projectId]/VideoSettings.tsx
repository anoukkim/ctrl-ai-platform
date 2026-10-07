"use client";

/**
 * Video Generator의 생성 설정 — 길이, 비율, 화질, 소리.
 *
 * 전부 고른 모델의 카탈로그를 따릅니다. 모델이 주지 않는 값은 흐리게
 * 두지 않고 **아예 보여 주지 않습니다** — 회원이 고를 수 있는 것만 눈에
 * 들어오게 하기 위해서입니다. 소리를 지원하지 않는 모델이면 소리 줄도
 * 없습니다. 무엇을 바꿨는지는 작업 공간이 한 줄로 알려 줍니다.
 */

import { Check, Volume2, VolumeX } from "lucide-react";

import { ASPECT_LABEL, type Aspect } from "@/lib/aspect";
import type { VideoCapabilities } from "@/lib/projects";
import type { VideoChoice } from "@/lib/video-settings";

import styles from "./workspace.module.css";

/**
 * 비율은 `lib/aspect.ts`에 있습니다 — CtrlAITube의 재생 화면도 같은 값을
 * 씁니다. 이 화면의 기존 import 경로를 그대로 두기 위해 다시 내보냅니다.
 */
export { ALL_ASPECTS, ASPECT_LABEL, ASPECT_RATIO_CSS, type Aspect } from "@/lib/aspect";

/** 비율을 작은 네모로 그려 줍니다. 글자보다 모양이 먼저 읽힙니다. */
function AspectGlyph({ aspect }: { aspect: string }) {
  const box =
    { "9:16": { w: 9, h: 15 }, "16:9": { w: 16, h: 9 }, "1:1": { w: 12, h: 12 } }[aspect] ??
    { w: 12, h: 12 };
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

interface SegmentedProps<T extends string | number> {
  id: string;
  label: string;
  values: T[];
  active: T;
  locked: boolean;
  lockedReason?: string;
  render: (value: T) => React.ReactNode;
  onPick: (value: T) => void;
}

/** 한 줄짜리 선택 단추 묶음. 길이·비율·화질이 같은 모양을 씁니다. */
export function Segmented<T extends string | number>({
  id,
  label,
  values,
  active,
  locked,
  lockedReason,
  render,
  onPick,
}: SegmentedProps<T>) {
  return (
    <div className={styles.settingRow}>
      <span className={styles.settingLabel} id={id}>
        {label}
      </span>
      <div className={styles.segmented} role="group" aria-labelledby={id}>
        {values.map((value) => {
          const isActive = value === active;
          return (
            <button
              className={`${styles.segment} ${isActive ? styles.segmentActive : ""}`}
              key={value}
              type="button"
              onClick={() => onPick(value)}
              disabled={locked}
              aria-pressed={isActive}
              title={lockedReason}
            >
              {isActive && <Check className={styles.segmentCheck} size={13} aria-hidden="true" />}
              {render(value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  caps: VideoCapabilities;
  choice: VideoChoice;
  onChange: (choice: VideoChoice) => void;
  /**
   * 이번 분기에 참여하지 않아 전부 잠겼을 때의 이유. 값이 있으면 모든
   * 조작부를 잠그고 이 문장을 안내로 씁니다.
   */
  lockedReason?: string;
}

export default function VideoSettings({ caps, choice, onChange, lockedReason }: Props) {
  const locked = Boolean(lockedReason);
  const pick = (changes: Partial<VideoChoice>) => onChange({ ...choice, ...changes });

  return (
    <>
      <Segmented
        id="video-duration-label"
        label="길이"
        values={caps.durations}
        active={choice.duration_seconds}
        locked={locked}
        lockedReason={lockedReason}
        render={(value) => `${value}초`}
        onPick={(value) => pick({ duration_seconds: value })}
      />

      <Segmented
        id="video-aspect-label"
        label="비율"
        values={caps.aspect_ratios}
        active={choice.aspect_ratio}
        locked={locked}
        lockedReason={lockedReason}
        render={(value) => (
          <>
            <AspectGlyph aspect={value} />
            {ASPECT_LABEL[value as Aspect] ?? value}
          </>
        )}
        onPick={(value) => pick({ aspect_ratio: value })}
      />

      <Segmented
        id="video-resolution-label"
        label="화질"
        values={caps.resolutions}
        active={choice.resolution}
        locked={locked}
        lockedReason={lockedReason}
        render={(value) => value}
        onPick={(value) => pick({ resolution: value })}
      />

      {caps.sound && (
        <div className={styles.settingRow}>
          <span className={styles.settingLabel}>소리</span>
          <button
            className={`${styles.soundToggle} ${choice.sound ? styles.soundToggleOn : ""}`}
            type="button"
            onClick={() => pick({ sound: !choice.sound })}
            disabled={locked}
            title={lockedReason}
            aria-pressed={choice.sound}
          >
            {choice.sound ? (
              <Volume2 size={15} aria-hidden="true" />
            ) : (
              <VolumeX size={15} aria-hidden="true" />
            )}
            {choice.sound ? "소리 켬" : "소리 끔"}
          </button>
        </div>
      )}
    </>
  );
}
