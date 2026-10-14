"use client";

/**
 * "썼어요" 알림 (feat-spend-feedback, 주인 추가 B, 2026-10-14).
 *
 * 동아리 지원 지갑에서 돈이 빠질 때마다 회원이 그 순간을 봅니다 — 친근하고
 * 조금 게임 같지만, 귀찮지 않게.
 *
 * - **금액은 백엔드가 돌려준 `charged_krw`뿐입니다.** 작업 화면(채팅,
 *   빌더, 영상)이 응답을 받은 뒤 `reportCharge`를 부릅니다. 0원이면(실패,
 *   무료) 아무것도 하지 않습니다.
 * - 사이드바: 잔액이 새 값까지 세어 내려가고(AnimatedNumber), 옆에
 *   "-12원"이 떠올랐다 사라지며, 잔액이 잠깐 빛납니다(`lastSpend`).
 * - 알림(오른쪽 아래, 휴대폰에서는 위): "12원을 사용했어요! 남은 지원금
 *   79,988원". 3초 안에 온 차감은 한 알림으로 합칩니다("3번 · 합계 36원").
 *   3초 뒤 사라지고, 누르면 Usage로 갑니다.
 * - 이정표: 첫 사용, 25/50/75%, 잔액 10,000원 이하, 잔액 0 — 분기마다 한
 *   번(백엔드가 기록). 남은 금액도 백엔드의 지갑에서 옵니다.
 * - Profile › 알림의 "사용 알림 표시"를 끄면 알림·떠오르는 금액·이정표가
 *   모두 나오지 않습니다(잔액 숫자는 언제나 맞게 바뀝니다). 움직임 줄이기를
 *   켠 사람에게는 세어 내려가기와 떠오르는 금액 없이 알림만 갑니다.
 * - 입력을 막지 않고, 초점을 가져가지 않으며, 화면 낭독기에는 알림마다
 *   한 줄을 정중하게(polite) 읽힙니다.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { formatKrw } from "@/lib/quarters";
import {
  MERGE_WINDOW_MS,
  MILESTONE_MS,
  MILESTONE_TITLE,
  TOAST_MS,
  claimMilestone,
  isWarning,
  setPreferences,
  type MilestoneClaim,
  type MilestoneKind,
} from "@/lib/spend";

import { useCurrentUser } from "./CurrentUserProvider";
import styles from "./spend-feedback.module.css";

export interface ChargeReport {
  /** 백엔드가 그 작업에 대해 돌려준 금액. */
  chargedKrw: number | null | undefined;
  /** 백엔드가 함께 알려 준 남은 지원금(알면). */
  remainingKrw?: number | null;
  /** 무엇에 썼는지 — "채팅 · Sonnet", "빌더 · 앱 만들기", "영상 생성". */
  label?: string;
}

interface SpendApi {
  reportCharge: (report: ChargeReport) => void;
  /** 사이드바의 "-N원"과 빛남. 차감마다 id가 바뀝니다. 끄거나 움직임 줄이기면 null. */
  lastSpend: { id: number; amountKrw: number } | null;
  /** Profile › 알림 › 사용 알림 표시. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
}

const SpendContext = createContext<SpendApi>({
  reportCharge: () => {},
  lastSpend: null,
  enabled: true,
  setEnabled: async () => {},
});

/** Provider 밖(화면 하나만 그리는 테스트)에서는 아무 일도 하지 않습니다. */
export function useSpendFeedback(): SpendApi {
  return useContext(SpendContext);
}

interface ToastState {
  id: number;
  count: number;
  totalKrw: number;
  labels: string[];
  remainingKrw: number | null;
}

interface MilestoneState {
  id: number;
  kind: MilestoneKind;
  claim: MilestoneClaim;
}

export default function SpendFeedbackProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { state: userState, refresh: refreshUser } = useCurrentUser();
  const userEnabled =
    userState.phase === "authenticated" ? (userState.user.spend_notifications ?? true) : true;
  const [override, setOverride] = useState<boolean | null>(null);
  const enabled = override ?? userEnabled;

  const [toast, setToast] = useState<ToastState | null>(null);
  const [milestone, setMilestone] = useState<MilestoneState | null>(null);
  const [lastSpend, setLastSpend] = useState<{ id: number; amountKrw: number } | null>(null);

  const nextId = useRef(1);
  const toastRef = useRef<ToastState | null>(null);
  const windowStart = useRef(0);
  const toastTimer = useRef<number | null>(null);
  const claimTimer = useRef<number | null>(null);
  const milestoneTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      for (const timer of [toastTimer, claimTimer, milestoneTimer]) {
        if (timer.current !== null) window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const showMilestone = useCallback((claim: MilestoneClaim) => {
    if (claim.milestone === null) return;
    setMilestone({ id: nextId.current++, kind: claim.milestone, claim });
    if (milestoneTimer.current !== null) window.clearTimeout(milestoneTimer.current);
    milestoneTimer.current = window.setTimeout(() => setMilestone(null), MILESTONE_MS);
  }, []);

  const reportCharge = useCallback(
    (report: ChargeReport) => {
      const amount = report.chargedKrw ?? 0;
      // 차감이 없으면(실패했거나 무료) 아무것도 보이지 않습니다.
      if (!(amount > 0) || !enabled) return;

      if (!reduced) setLastSpend({ id: nextId.current++, amountKrw: amount });

      const now = Date.now();
      const current = toastRef.current;
      const merging = current !== null && now - windowStart.current <= MERGE_WINDOW_MS;
      if (!merging) windowStart.current = now;
      const next: ToastState = merging
        ? {
            ...current,
            count: current.count + 1,
            totalKrw: current.totalKrw + amount,
            labels: report.label && !current.labels.includes(report.label)
              ? [...current.labels, report.label]
              : current.labels,
            remainingKrw: report.remainingKrw ?? current.remainingKrw,
          }
        : {
            id: nextId.current++,
            count: 1,
            totalKrw: amount,
            labels: report.label ? [report.label] : [],
            remainingKrw: report.remainingKrw ?? null,
          };
      toastRef.current = next;
      setToast(next);
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => {
        toastRef.current = null;
        setToast(null);
      }, TOAST_MS);

      // 이정표는 차감이 잦아든 뒤 한 번 묻습니다. 남은 금액도 백엔드의
      // 지갑에서 받아 알림을 바로잡습니다.
      if (claimTimer.current !== null) window.clearTimeout(claimTimer.current);
      claimTimer.current = window.setTimeout(() => {
        claimMilestone()
          .then((claim) => {
            if (claim === null) return;
            if (toastRef.current !== null) {
              const fixed = { ...toastRef.current, remainingKrw: claim.remaining_krw };
              toastRef.current = fixed;
              setToast(fixed);
            }
            showMilestone(claim);
          })
          .catch(() => {
            /* 알림은 장식입니다 — 실패해도 조용히 넘깁니다. */
          });
      }, 400);
    },
    [enabled, reduced, showMilestone],
  );

  const setEnabled = useCallback(
    async (value: boolean) => {
      await setPreferences({ spend_notifications: value });
      setOverride(value);
      if (!value) {
        toastRef.current = null;
        setToast(null);
        setMilestone(null);
        setLastSpend(null);
      }
      void refreshUser();
    },
    [refreshUser],
  );

  const api = useMemo(
    () => ({ reportCharge, lastSpend: enabled && !reduced ? lastSpend : null, enabled, setEnabled }),
    [reportCharge, lastSpend, enabled, reduced, setEnabled],
  );

  const toastLine = toast === null ? "" : toastText(toast);

  return (
    <SpendContext.Provider value={api}>
      {children}
      <div className={styles.region}>
        {/* 화면 낭독기에는 알림마다 한 줄만. */}
        <p className="sr-only" aria-live="polite" data-testid="spend-live">
          {toastLine}
        </p>
        <AnimatePresence initial={false}>
          {milestone !== null && (
            <motion.div
              key={`m-${milestone.id}`}
              className={`${styles.milestone} ${isWarning(milestone.kind) ? styles.warning : ""}`}
              data-testid="spend-milestone"
              data-kind={milestone.kind}
              initial={reduced ? false : { opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <MilestoneCard
                milestone={milestone}
                onClose={() => setMilestone(null)}
              />
            </motion.div>
          )}
          {toast !== null && (
            <motion.button
              key={`t-${toast.id}`}
              type="button"
              tabIndex={-1}
              className={styles.toast}
              data-testid="spend-toast"
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={() => router.push("/usage")}
              title="Usage에서 자세히 보기"
            >
              <span className={styles.toastMain}>{toastMainText(toast)}</span>
              {toast.labels.length > 0 && (
                <span className={styles.toastLabel}>{toast.labels.join(" · ")}</span>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </SpendContext.Provider>
  );
}

/** 알림 첫 줄. */
export function toastMainText(toast: Pick<ToastState, "count" | "totalKrw" | "remainingKrw">): string {
  const spent =
    toast.count > 1
      ? `${toast.count}번 · 합계 ${formatKrw(toast.totalKrw)}을 사용했어요!`
      : `${formatKrw(toast.totalKrw)}을 사용했어요!`;
  return toast.remainingKrw === null
    ? spent
    : `${spent} 남은 지원금 ${formatKrw(toast.remainingKrw)}`;
}

function toastText(toast: ToastState): string {
  const label = toast.labels.length > 0 ? ` (${toast.labels.join(", ")})` : "";
  return `${toastMainText(toast)}${label}`;
}

function MilestoneCard({ milestone, onClose }: { milestone: MilestoneState; onClose: () => void }) {
  const { kind, claim } = milestone;
  const percent = claim.percent_used;
  const warning = isWarning(kind);
  return (
    <div className={styles.milestoneBody}>
      {kind.startsWith("used_") && <ProgressRing percent={percent} />}
      <div className={styles.milestoneText}>
        <p className={styles.milestoneTitle}>{MILESTONE_TITLE[kind]}</p>
        <p className={styles.milestoneSub}>
          {kind === "empty"
            ? "새로 만들려고 하면 나오는 안내 문구가 기준이에요. Usage에서 쓴 내역을 볼 수 있어요."
            : `남은 지원금 ${formatKrw(claim.remaining_krw)}`}
        </p>
        {warning && (
          <Link className={styles.milestoneLink} href="/usage" onClick={onClose}>
            Usage에서 보기
          </Link>
        )}
      </div>
      <button type="button" className={styles.close} aria-label="닫기" tabIndex={-1} onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

/** 쓴 비율의 동그라미. */
function ProgressRing({ percent }: { percent: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  return (
    <svg className={styles.ring} width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r={radius} className={styles.ringTrack} />
      <circle
        cx="24"
        cy="24"
        r={radius}
        className={styles.ringFill}
        strokeDasharray={`${filled} ${circumference}`}
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="28" textAnchor="middle" className={styles.ringText}>
        {percent}%
      </text>
    </svg>
  );
}
