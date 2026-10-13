"use client";

/**
 * 짧은 알림 — "저장했어요", "삭제했어요", "내려받기를 시작했어요"
 * (ui-friendly-motion).
 *
 * 화면 아래 가운데에 잠깐 떴다가 사라집니다. **누르는 것을 막지 않습니다**:
 * 알림에는 단추가 없으므로 클릭은 알림 위로도 그대로 지나갑니다(휴대폰에서
 * 아래쪽 단추가 3.5초 동안 가려지지 않도록). 화면 읽기 프로그램에는 감싸는
 * 영역의 `aria-live`로 한 번 읽힙니다.
 *
 * 움직임은 `MotionConfig reducedMotion="user"`(MotionRoot)를 따릅니다 —
 * 움직임 줄이기를 켠 사람에게는 그냥 나타나고 사라집니다.
 */

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import styles from "./toast.module.css";

export type ToastTone = "ok" | "error" | "info";

interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastApi {
  show: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

/** 알림을 띄웁니다. Provider 밖(테스트에서 화면 하나만 그릴 때)에서는 아무 일도 하지 않습니다. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const ICON = { ok: CheckCircle2, error: CircleAlert, info: Info } as const;
const SHOWN_MS = 3500;

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const show = useCallback((text: string, tone: ToastTone = "ok") => {
    const id = next.current++;
    // 한 번에 셋까지만. 오래된 것부터 밀려납니다.
    setToasts((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, SHOWN_MS);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = ICON[toast.tone];
            return (
              <motion.div
                key={toast.id}
                className={`${styles.toast} ${styles[toast.tone]}`}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{toast.text}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
