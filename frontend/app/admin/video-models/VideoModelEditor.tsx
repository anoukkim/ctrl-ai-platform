"use client";

/**
 * 영상 모델 하나의 카탈로그 항목을 고치는 칸.
 *
 * 회원의 영상 만들기는 전부 이 값을 따릅니다 — 고를 수 있는 길이·비율·
 * 화질, 소리, 수정·이어서 만들기 지원, 기본값, 화질별 초당 가격. 검사는
 * 백엔드(`VideoCapabilities`)가 하고, 거절하면 그 이유를 한 문장으로
 * 돌려줍니다. 여기서는 입력을 모양에 맞춰 보낼 뿐 규칙을 따로 두지
 * 않습니다 — 규칙이 두 곳에 있으면 한쪽만 고쳐집니다.
 *
 * 저장하면 가격의 "예시" 표시가 사라집니다. 관리자가 저장했다는 것은 그
 * 가격을 확인했다는 뜻이기 때문입니다.
 */

import { useState } from "react";

import { ALL_ASPECTS, ASPECT_LABEL } from "@/lib/aspect";
import {
  describeError,
  updateAdminVideoModel,
  type AdminVideoModel,
  type VideoCapabilities,
} from "@/lib/projects";

import styles from "../admin.module.css";

/** "5, 10, 15" → [5, 10, 15]. 숫자가 아닌 조각은 그대로 NaN으로 보내
 *  백엔드가 거절하게 둡니다. */
function parseNumbers(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((part) => Number(part));
}

function parseWords(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

interface Props {
  model: AdminVideoModel;
  onSaved: (model: AdminVideoModel) => void;
  onCancel: () => void;
}

export default function VideoModelEditor({ model, onSaved, onCancel }: Props) {
  const caps = model.capabilities;
  const [durations, setDurations] = useState(caps.durations.join(", "));
  const [aspects, setAspects] = useState<string[]>(caps.aspect_ratios);
  const [resolutions, setResolutions] = useState(caps.resolutions.join(", "));
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(caps.price_per_second_krw).map(([key, value]) => [key, String(value)]),
    ),
  );
  const [sound, setSound] = useState(caps.sound);
  const [supportsEdit, setSupportsEdit] = useState(caps.supports_edit);
  const [supportsExtend, setSupportsExtend] = useState(caps.supports_extend);
  const [defaults, setDefaults] = useState(caps.defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const durationList = parseNumbers(durations);
  const resolutionList = parseWords(resolutions);

  const save = async () => {
    setSaving(true);
    setError(null);
    const next: VideoCapabilities = {
      durations: durationList,
      aspect_ratios: ALL_ASPECTS.filter((aspect) => aspects.includes(aspect)),
      resolutions: resolutionList,
      sound,
      supports_edit: supportsEdit,
      supports_extend: supportsExtend,
      price_per_second_krw: Object.fromEntries(
        resolutionList.map((resolution) => [resolution, Number(prices[resolution] ?? "")]),
      ),
      defaults: { ...defaults, sound: sound && defaults.sound },
      prices_are_examples: false,
    };
    try {
      onSaved(await updateAdminVideoModel(model.id, { capabilities: next }));
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modelEditor}>
      <div className={styles.modelEditorGrid}>
        <label className={styles.modelEditorField}>
          <span>길이(초, 쉼표로 구분)</span>
          <input
            className="field"
            value={durations}
            onChange={(event) => setDurations(event.target.value)}
            aria-label="길이"
          />
        </label>

        <fieldset className={styles.modelEditorField}>
          <legend>비율</legend>
          <span className={styles.modelEditorChecks}>
            {ALL_ASPECTS.map((aspect) => (
              <label key={aspect}>
                <input
                  type="checkbox"
                  checked={aspects.includes(aspect)}
                  onChange={(event) =>
                    setAspects((current) =>
                      event.target.checked
                        ? [...current, aspect]
                        : current.filter((value) => value !== aspect),
                    )
                  }
                />{" "}
                {ASPECT_LABEL[aspect]}
              </label>
            ))}
          </span>
        </fieldset>

        <label className={styles.modelEditorField}>
          <span>화질(쉼표로 구분, 예: 720p, 1080p)</span>
          <input
            className="field"
            value={resolutions}
            onChange={(event) => setResolutions(event.target.value)}
            aria-label="화질"
          />
        </label>

        <fieldset className={styles.modelEditorField}>
          <legend>초당 가격(원)</legend>
          <span className={styles.modelEditorChecks}>
            {resolutionList.map((resolution) => (
              <label key={resolution}>
                {resolution}{" "}
                <input
                  className={`field ${styles.priceInput}`}
                  inputMode="numeric"
                  value={prices[resolution] ?? ""}
                  onChange={(event) =>
                    setPrices((current) => ({ ...current, [resolution]: event.target.value }))
                  }
                  aria-label={`${resolution} 초당 가격`}
                />
              </label>
            ))}
          </span>
        </fieldset>

        <fieldset className={styles.modelEditorField}>
          <legend>지원</legend>
          <span className={styles.modelEditorChecks}>
            <label>
              <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />{" "}
              소리
            </label>
            <label>
              <input
                type="checkbox"
                checked={supportsEdit}
                onChange={(e) => setSupportsEdit(e.target.checked)}
              />{" "}
              영상 수정
            </label>
            <label>
              <input
                type="checkbox"
                checked={supportsExtend}
                onChange={(e) => setSupportsExtend(e.target.checked)}
              />{" "}
              이어서 만들기
            </label>
          </span>
        </fieldset>

        <fieldset className={styles.modelEditorField}>
          <legend>기본값</legend>
          <span className={styles.modelEditorChecks}>
            <select
              className="field"
              value={defaults.duration_seconds}
              onChange={(e) => setDefaults({ ...defaults, duration_seconds: Number(e.target.value) })}
              aria-label="기본 길이"
            >
              {durationList.map((value) => (
                <option key={value} value={value}>
                  {value}초
                </option>
              ))}
            </select>
            <select
              className="field"
              value={defaults.aspect_ratio}
              onChange={(e) => setDefaults({ ...defaults, aspect_ratio: e.target.value })}
              aria-label="기본 비율"
            >
              {aspects.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              className="field"
              value={defaults.resolution}
              onChange={(e) => setDefaults({ ...defaults, resolution: e.target.value })}
              aria-label="기본 화질"
            >
              {resolutionList.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {sound && (
              <label>
                <input
                  type="checkbox"
                  checked={defaults.sound}
                  onChange={(e) => setDefaults({ ...defaults, sound: e.target.checked })}
                />{" "}
                소리 켬
              </label>
            )}
          </span>
        </fieldset>
      </div>

      {error && (
        <p className={styles.modelEditorError} role="alert">
          {error}
        </p>
      )}

      <div className={styles.modelEditorActions}>
        <button className="btn btn-sm btn-primary" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </button>
        <button className="btn btn-sm" type="button" onClick={onCancel} disabled={saving}>
          취소
        </button>
        <span className="small dim">
          가격을 바꾸면 다음 생성부터 적용되고, 감사 기록에 남습니다.
        </span>
      </div>
    </div>
  );
}
