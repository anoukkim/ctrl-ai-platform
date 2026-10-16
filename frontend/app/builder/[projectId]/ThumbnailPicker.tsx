"use client";

/**
 * 게시 썸네일 고르기 (owner-polish-3 (a2)).
 *
 * 오너의 말: "게시할때는 사용자가 고르고, 게시하면 빌더 안에서도 게시랑 같은
 * 썸네일". 창이 열리면 미리보기 프레임에서 자동 후보 셋을 찍습니다 — 첫 화면,
 * 조금 내려간 화면, 폰 너비 — 그리고 「지금 화면으로」는 미리보기를 지금 보이는
 * 그대로 한 장 더 찍어 고릅니다. 아무것도 고르지 않으면 첫 화면. AI는 쓰지
 * 않고, 비용도 없어요. 찍는 일은 전부 만든 사람의 브라우저에서 일어납니다.
 */

import { useEffect, useRef, useState } from "react";

import styles from "./workspace.module.css";

export type CandidateKind = "first" | "scrolled" | "phone" | "now";

/** 미리보기 프레임에서 한 장 — 종류에 따라 크기·자리가 다릅니다. */
export type ThumbnailCapture = (kind: CandidateKind) => Promise<Blob>;

export const CANDIDATE_LABEL: Record<CandidateKind, string> = {
  first: "첫 화면",
  scrolled: "조금 내려간 화면",
  phone: "폰 너비",
  now: "지금 화면",
};

const AUTOMATIC: CandidateKind[] = ["first", "scrolled", "phone"];

interface Candidate {
  kind: CandidateKind;
  blob: Blob | null;
  url: string | null;
  failed: boolean;
}

interface Props {
  capture: ThumbnailCapture;
  /** 고른 것 — 없으면 첫 화면이 오는 대로 골라집니다. */
  value: Blob | null;
  onChange: (blob: Blob | null, kind: CandidateKind | null) => void;
  disabled?: boolean;
}

export default function ThumbnailPicker({ capture, value, onChange, disabled = false }: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>(
    AUTOMATIC.map((kind) => ({ kind, blob: null, url: null, failed: false })),
  );
  const [picked, setPicked] = useState<CandidateKind | null>(null);
  const [takingNow, setTakingNow] = useState(false);
  const urls = useRef<string[]>([]);
  const chosenOnce = useRef(false);

  const objectUrl = (blob: Blob): string | null => {
    try {
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      return url;
    } catch {
      return null;
    }
  };

  // 자동 후보 셋을 차례로 — 한 번에 셋을 부탁하면 앱이 세 번 그려야 합니다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const kind of AUTOMATIC) {
        let blob: Blob | null = null;
        try {
          blob = await capture(kind);
        } catch {
          blob = null;
        }
        if (cancelled) return;
        setCandidates((current) =>
          current.map((item) => (item.kind === kind ? { kind, blob, url: blob ? objectUrl(blob) : null, failed: blob === null } : item)),
        );
        if (blob && kind === "first" && !chosenOnce.current) {
          // 아무것도 고르지 않으면 첫 화면.
          chosenOnce.current = true;
          setPicked("first");
          onChange(blob, "first");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // The capture function is stable for a dialog's life; running this once is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      for (const url of urls.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* nothing to free */
        }
      }
    },
    [],
  );

  const pick = (candidate: Candidate) => {
    if (!candidate.blob) return;
    chosenOnce.current = true;
    setPicked(candidate.kind);
    onChange(candidate.blob, candidate.kind);
  };

  const takeNow = async () => {
    setTakingNow(true);
    try {
      const blob = await capture("now");
      const next: Candidate = { kind: "now", blob, url: objectUrl(blob), failed: false };
      setCandidates((current) => [...current.filter((item) => item.kind !== "now"), next]);
      chosenOnce.current = true;
      setPicked("now");
      onChange(blob, "now");
    } catch {
      setCandidates((current) => [...current.filter((item) => item.kind !== "now"), { kind: "now", blob: null, url: null, failed: true }]);
    } finally {
      setTakingNow(false);
    }
  };

  const none = candidates.every((item) => item.failed);

  return (
    <fieldset className={styles.pickerFieldset} data-testid="thumbnail-picker">
      <legend className={styles.pickerLegend}>CtrlAIApps 카드의 그림</legend>
      <div className={styles.pickerGrid} role="radiogroup" aria-label="썸네일 후보">
        {candidates.map((candidate) => (
          <label
            key={candidate.kind}
            className={`${styles.pickerCard} ${picked === candidate.kind ? styles.pickerCardPicked : ""} ${candidate.failed ? styles.pickerCardFailed : ""}`}
          >
            <input
              type="radio"
              name="thumbnail-candidate"
              value={candidate.kind}
              checked={picked === candidate.kind}
              disabled={disabled || !candidate.blob}
              onChange={() => pick(candidate)}
            />
            <span className={styles.pickerArt} aria-hidden="true">
              {candidate.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a Blob from this browser, moments old
                <img src={candidate.url} alt="" />
              ) : (
                <span className={styles.pickerWait}>{candidate.failed ? "못 찍었어요" : "찍는 중…"}</span>
              )}
            </span>
            <span className={styles.pickerLabel}>{CANDIDATE_LABEL[candidate.kind]}</span>
          </label>
        ))}
      </div>
      <div className={styles.pickerActions}>
        <button className="btn btn-sm" type="button" onClick={() => void takeNow()} disabled={disabled || takingNow}>
          {takingNow ? "찍는 중…" : "지금 화면으로"}
        </button>
        <span className="small dim">
          {none
            ? "미리보기에서 그림을 찍지 못했어요 — 게시하면 공개 주소에서 자동으로 한 장 찍어요."
            : value
              ? "고른 그림이 CtrlAIApps와 Builder 카드에 쓰여요. 게시 메뉴에서 언제든 바꿀 수 있어요."
              : "아무것도 고르지 않으면 첫 화면이 쓰여요."}
        </span>
      </div>
    </fieldset>
  );
}
