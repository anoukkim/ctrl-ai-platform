"use client";

/**
 * 이 영상 수정하기 / 이어서 만들기 — 왼쪽 칸이 이 패널로 바뀝니다.
 *
 * 둘 다 고른 버전을 원본으로 삼고, 그 버전을 만든 모델로 작업합니다.
 * 길이·비율·화질은 원본의 것이라 **고를 수 없게 숨깁니다**. 이어서
 * 만들기만 덧붙일 길이를 고르고, 그 길이는 모델의 카탈로그에 있는 것만
 * 나옵니다.
 *
 * 예상 비용은 백엔드가 차감하는 식과 같습니다:
 *   수정      — 원본 길이 × 원본 화질의 초당 가격
 *   이어서    — 덧붙일 길이 × 원본 화질의 초당 가격
 */

import { Lock } from "lucide-react";
import { useState } from "react";

import { ASPECT_LABEL, type Aspect } from "@/lib/aspect";
import type { VideoModel, VideoVersion } from "@/lib/projects";
import { costLabel, estimateCostKrw } from "@/lib/video-settings";

import { Segmented } from "./VideoSettings";
import styles from "./workspace.module.css";

export type VersionAction = "edit" | "extend";

interface Props {
  action: VersionAction;
  source: VideoVersion;
  model: VideoModel;
  busy: boolean;
  error: string | null;
  lockedReason?: string;
  onEdit: (instruction: string) => void;
  onExtend: (seconds: number) => void;
  onCancel: () => void;
}

export default function VersionActionPanel({
  action,
  source,
  model,
  busy,
  error,
  lockedReason,
  onEdit,
  onExtend,
  onCancel,
}: Props) {
  const caps = model.capabilities;
  const [instruction, setInstruction] = useState("");
  const [seconds, setSeconds] = useState(caps.durations[0]);

  const resolution = source.resolution ?? "";
  const sourceSeconds = source.duration_seconds ?? 0;
  const charged = action === "edit" ? sourceSeconds : seconds;
  const cost = estimateCostKrw(caps, resolution, charged);
  const locked = Boolean(lockedReason);
  const ready = action === "extend" || instruction.trim().length > 0;

  const title = `${source.label} ${action === "edit" ? "수정하기" : "이어서 만들기"}`;

  return (
    <section className={styles.actionPanel} aria-label={title}>
      <p className="section-title">{title}</p>

      <p className={styles.sourceSummary}>
        원본: {sourceSeconds}초 · {ASPECT_LABEL[source.aspect_ratio as Aspect] ?? source.aspect_ratio}{" "}
        · {resolution} · {model.display_name}
      </p>
      <p className={styles.settingHint}>
        {action === "edit"
          ? "길이·비율·화질은 원본을 그대로 따릅니다."
          : "비율·화질은 원본을 따르고, 덧붙일 길이만 고릅니다."}
      </p>

      {action === "edit" ? (
        <textarea
          className={`field ${styles.promptArea}`}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="무엇을 바꿀까요? 예: 비를 눈으로 바꿔줘"
          readOnly={locked}
          maxLength={1000}
          aria-label="수정 요청"
        />
      ) : (
        <>
          <Segmented
            id="video-extend-label"
            label="덧붙일 길이"
            values={caps.durations}
            active={seconds}
            locked={locked}
            lockedReason={lockedReason}
            render={(value) => `${value}초`}
            onPick={setSeconds}
          />
          <p className={styles.settingHint}>새 길이: {sourceSeconds + seconds}초</p>
        </>
      )}

      <div className={styles.actions}>
        <span className={styles.costRow}>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => (action === "edit" ? onEdit(instruction.trim()) : onExtend(seconds))}
            disabled={locked || busy || !ready}
            title={lockedReason}
          >
            {locked && <Lock size={13} aria-hidden="true" />}{" "}
            {busy ? "만드는 중…" : action === "edit" ? "수정하기" : "이어서 만들기"}
          </button>
          <span className={styles.cost} data-testid="action-cost">
            {costLabel(cost)}
          </span>
        </span>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>
          취소
        </button>
        {error && (
          <p className={styles.actionError} role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
