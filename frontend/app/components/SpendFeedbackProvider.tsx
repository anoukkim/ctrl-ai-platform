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
 *
 * v2 (owner-polish 10, 2026-10-16 — "모션그래픽 띠링"): 알림이 톡 튀어
 * 오르고(스프링) 동전이 반짝이며, 금액 "-12원"이 크게 보입니다. 사이드바의
 * 잔액이 화면에 보이면 "-12원"이 알림에서 잔액으로 날아가 닿는 순간 잔액이
 * 빛나고, 안 보이면(접힌 사이드바, 휴대폰, 스크롤) 알림 자체가 금액과 남은
 * 지원금을 들고 있으니 어디서나 보입니다. 짧은 "띠링" 소리는 Profile › 알림의
 * 스위치로, 기본은 꺼짐(이 기기에만). 움직임 줄이기면 전부 빼고 알림만.
 */

import { Coins } from "lucide-react";
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

import { playChime, useSoundPref, writeSoundPref } from "@/lib/chime";
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

/** 별가루가 알림에서 잔액까지 흐르는 시간 (motion-modern (4)). */
const FLY_MS = 900;
/** 별 몇 개가 흐르고, 닿은 자리에서 몇 개가 반짝이는지. */
export const STAR_COUNT = 9;
export const TWINKLE_COUNT = 4;

/** 별마다 조금씩 다른 길과 크기 — 한 줄로 날지 않도록. 결정적(순서로만). */
function starSpread(index: number) {
  const angle = (index * 137.5 * Math.PI) / 180; // golden angle: evenly scattered
  const radius = 10 + (index % 3) * 9;
  return {
    dx: Math.cos(angle) * radius,
    dy: Math.sin(angle) * radius,
    size: 5 + (index % 3) * 2,
    delay: index * 0.045,
    gold: index % 3 !== 1,
  };
}

interface Flight {
  id: number;
  amountKrw: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * 잔액 숫자(`data-wallet-balance`)가 화면 안에 보이면 거기까지의 비행을
 * 계획합니다. 보이지 않으면 null — 알림이 금액을 들고 있습니다.
 */
function planFlight(amountKrw: number, id: number): Flight | null {
  if (typeof document === "undefined") return null;
  const target = document.querySelector<HTMLElement>("[data-wallet-balance]");
  if (target === null) return null;
  const rect = target.getBoundingClientRect();
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth;
  if (!visible) return null;
  // 알림 자리(오른쪽 아래; 좁은 화면에서는 위)에서 출발합니다.
  const narrow = window.innerWidth <= 720;
  const from = narrow
    ? { x: window.innerWidth / 2, y: 4.25 * 16 + 20 }
    : { x: window.innerWidth - 1.25 * 16 - 120, y: window.innerHeight - 9.5 * 16 };
  return { id, amountKrw, from, to: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
}

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
  /** 띠링 소리 (owner-polish 10) — 이 기기의 설정, 기본 꺼짐. */
  sound: boolean;
  setSound: (value: boolean) => void;
}

const SpendContext = createContext<SpendApi>({
  reportCharge: () => {},
  lastSpend: null,
  enabled: true,
  setEnabled: async () => {},
  sound: false,
  setSound: () => {},
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
  // v2: 띠링 소리(이 기기의 설정), 잔액으로 날아가는 "-N원".
  const sound = useSoundPref();
  const [fly, setFly] = useState<Flight | null>(null);
  const flyTimer = useRef<number | null>(null);

  const nextId = useRef(1);
  const toastRef = useRef<ToastState | null>(null);
  const windowStart = useRef(0);
  const toastTimer = useRef<number | null>(null);
  const claimTimer = useRef<number | null>(null);
  const milestoneTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      for (const timer of [toastTimer, claimTimer, milestoneTimer, flyTimer]) {
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

      if (!reduced) {
        setLastSpend({ id: nextId.current++, amountKrw: amount });
        // "-N원"이 잔액으로 날아갑니다 — 잔액이 화면에 보일 때만. 안 보이면
        // 알림이 금액을 들고 있으니 그걸로 충분합니다.
        const flight = planFlight(amount, nextId.current++);
        if (flight !== null) {
          setFly(flight);
          if (flyTimer.current !== null) window.clearTimeout(flyTimer.current);
          flyTimer.current = window.setTimeout(() => setFly(null), FLY_MS + 100);
        }
        if (sound) playChime();
      }

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
    [enabled, reduced, showMilestone, sound],
  );

  const setSound = useCallback((value: boolean) => {
    writeSoundPref(value);
    // 켜는 순간 한 번 들려 줍니다 — 어떤 소리인지 알게.
    if (value) playChime();
  }, []);

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
    () => ({
      reportCharge,
      lastSpend: enabled && !reduced ? lastSpend : null,
      enabled,
      setEnabled,
      sound,
      setSound,
    }),
    [reportCharge, lastSpend, enabled, reduced, setEnabled, sound, setSound],
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
              data-count={toast.count}
              initial={reduced ? false : { opacity: 0, y: 16, scale: 0.72 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 22, mass: 0.7 }}
              onClick={() => router.push("/usage")}
              title="Usage에서 자세히 보기"
            >
              {/* 동전 하나가 톡 튀며 반짝이고, 금액이 크게 — 띠링의 눈 쪽. */}
              <span className={`${styles.coin} ${reduced ? "" : styles.coinPop}`} aria-hidden="true" key={`c-${toast.id}-${toast.count}`}>
                <Coins size={18} />
                <span className={styles.spark} />
                <span className={`${styles.spark} ${styles.spark2}`} />
                <span className={`${styles.spark} ${styles.spark3}`} />
              </span>
              <span className={styles.toastBody}>
                <span className={styles.amount} key={`a-${toast.id}-${toast.count}`} data-testid="spend-amount">
                  -{formatKrw(toast.totalKrw)}
                </span>
                <span className={styles.toastMain}>{toastMainText(toast)}</span>
                {toast.labels.length > 0 && (
                  <span className={styles.toastLabel}>{toast.labels.join(" · ")}</span>
                )}
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {fly !== null && (
          // 별가루 (motion-modern (4)): 작은 별들이 금액에서 잔액으로 흘러가고,
          // 닿은 자리에서 몇 개가 반짝인 뒤 숫자가 내려갑니다. 글자는 없습니다 —
          // 금액은 알림이 들고 있어요.
          <span key={`f-${fly.id}`} className={styles.stardust} data-testid="spend-fly" data-stars={STAR_COUNT} aria-hidden="true">
            {Array.from({ length: STAR_COUNT }, (_, index) => {
              const spread = starSpread(index);
              return (
                <motion.span
                  key={index}
                  className={`${styles.star} ${spread.gold ? styles.starGold : ""}`}
                  style={{ width: spread.size, height: spread.size }}
                  initial={{ left: fly.from.x + spread.dx, top: fly.from.y + spread.dy, opacity: 0, scale: 0.4, rotate: 0 }}
                  animate={{
                    left: [fly.from.x + spread.dx, fly.from.x + spread.dx * 2.2, fly.to.x + spread.dx * 0.4],
                    top: [fly.from.y + spread.dy, fly.from.y - 28 + spread.dy, fly.to.y + spread.dy * 0.4],
                    opacity: [0, 1, 0.9, 0],
                    scale: [0.4, 1.3, 1, 0.5],
                    rotate: 180,
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: FLY_MS / 1000, delay: spread.delay, ease: [0.25, 0.6, 0.3, 1] }}
                />
              );
            })}
            {Array.from({ length: TWINKLE_COUNT }, (_, index) => {
              const spread = starSpread(index + 5);
              return (
                <motion.span
                  key={`t-${index}`}
                  className={`${styles.star} ${styles.twinkle}`}
                  style={{ width: 4 + (index % 2) * 2, height: 4 + (index % 2) * 2, left: fly.to.x + spread.dx * 1.6, top: fly.to.y + spread.dy * 1.2 }}
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: [0, 1, 0, 1, 0], scale: [0.3, 1.4, 0.6, 1.2, 0.2] }}
                  transition={{ duration: 0.8, delay: FLY_MS / 1000 - 0.2 + index * 0.08, ease: "easeInOut" }}
                />
              );
            })}
          </span>
        )}
      </AnimatePresence>
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
