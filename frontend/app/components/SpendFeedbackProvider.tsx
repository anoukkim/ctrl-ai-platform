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

/** spend-toast-compact: how many stars twinkle at the wallet, and for how long. */
export const TWINKLE_COUNT = 4;
const TWINKLE_MS = 900;
/** Under this a charge is quiet: no pill, only the wallet (owner, A). */
export const QUIET_UNDER_KRW = 10;

/** 별마다 조금씩 다른 자리 — 결정적(순서로만). */
function starSpread(index: number) {
  const angle = (index * 137.5 * Math.PI) / 180; // golden angle: evenly scattered
  const radius = 10 + (index % 3) * 9;
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

interface Twinkle {
  id: number;
  at: { x: number; y: number };
}

/**
 * The sidebar balance (`data-wallet-balance`) when it is on screen: the
 * stars twinkle there (spend-toast-compact: "지갑 쪽에서만 반짝이게"). Not on
 * screen (folded sidebar, phone) → null: the pill alone says it.
 */
function walletPoint(id: number): Twinkle | null {
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
  return { id, at: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
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
  const [twinkle, setTwinkle] = useState<Twinkle | null>(null);
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
        // A few stars twinkle on the wallet — only when it is on screen.
        const point = walletPoint(nextId.current++);
        if (point !== null) {
          setTwinkle(point);
          if (flyTimer.current !== null) window.clearTimeout(flyTimer.current);
          flyTimer.current = window.setTimeout(() => setTwinkle(null), TWINKLE_MS + 300);
        }
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
      // Small charges stay quiet: no pill and no chime under 10원 (merged ones
      // count together) — the wallet's count-down and twinkle say it.
      const heard = next.totalKrw >= QUIET_UNDER_KRW;
      setToast(heard ? next : null);
      if (heard && sound && !reduced) playChime();
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
              setToast((shown) => (shown === null ? null : fixed));
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
              className={styles.pill}
              ref={placePill}
              data-testid="spend-toast"
              data-count={toast.count}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
              onClick={() => router.push("/usage")}
              // What it was for lives in the tooltip and the screen-reader line.
              title={`${toast.labels.length > 0 ? `${toast.labels.join(" · ")} — ` : ""}Usage에서 자세히 보기`}
            >
              <span className={styles.pillAmount} data-testid="spend-amount">
                {pillAmount(toast)}
              </span>
              {toast.remainingKrw !== null && (
                <span className={styles.pillRest}> · {formatKrw(toast.remainingKrw)} 남음</span>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {twinkle !== null && (
          // spend-toast-compact: the stars twinkle on the wallet only — no
          // flight from the toast. Under 움직임 줄이기 nothing is drawn here.
          <span
            key={`f-${twinkle.id}`}
            className={styles.stardust}
            data-testid="spend-twinkle"
            data-stars={TWINKLE_COUNT}
            aria-hidden="true"
          >
            {Array.from({ length: TWINKLE_COUNT }, (_, index) => {
              const spread = starSpread(index + 5);
              return (
                <motion.span
                  key={`t-${index}`}
                  className={`${styles.star} ${index % 2 ? styles.twinkle : styles.starGold}`}
                  style={{
                    width: 4 + (index % 2) * 2,
                    height: 4 + (index % 2) * 2,
                    margin: -(2 + (index % 2)),
                    left: twinkle.at.x + spread.dx * 1.6,
                    top: twinkle.at.y + spread.dy * 1.2,
                  }}
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: [0, 1, 0, 1, 0], scale: [0.3, 1.4, 0.6, 1.2, 0.2] }}
                  transition={{ duration: TWINKLE_MS / 1000, delay: index * 0.08, ease: "easeInOut" }}
                />
              );
            })}
          </span>
        )}
      </AnimatePresence>
    </SpendContext.Provider>
  );
}

/**
 * Where the pill appears (owner, 2026-10-17: "차감된거 지원금 위에 떠야하는거
 * 아님?"): just above the screen's 「남은 지원금」 line (`data-spend-anchor`,
 * WalletCheck), left-aligned with it — never over the reply's buttons. No
 * visible anchor (or a phone): the CSS default place. A callback ref sets the
 * position directly, so nothing re-renders.
 */
export function placePill(el: HTMLElement | null): void {
  if (!el || typeof window === "undefined" || window.innerWidth <= 720) return;
  const anchors = Array.from(document.querySelectorAll<HTMLElement>("[data-spend-anchor]"));
  const anchor = anchors.find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top > 0 && rect.bottom <= window.innerHeight;
  });
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.round(rect.left))}px`;
  el.style.right = "auto";
  el.style.margin = "0";
  el.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
}

/** The pill's amount: `−156원`, or `−36원 (3번)` when charges merged. */
export function pillAmount(toast: Pick<ToastState, "count" | "totalKrw">): string {
  return `−${formatKrw(toast.totalKrw)}${toast.count > 1 ? ` (${toast.count}번)` : ""}`;
}

/** The whole pill as one line (tests, and anyone reading it aloud). */
export function pillText(toast: Pick<ToastState, "count" | "totalKrw" | "remainingKrw">): string {
  return `${pillAmount(toast)}${toast.remainingKrw === null ? "" : ` · ${formatKrw(toast.remainingKrw)} 남음`}`;
}

/** The screen-reader sentence — unchanged by the pill. */
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
