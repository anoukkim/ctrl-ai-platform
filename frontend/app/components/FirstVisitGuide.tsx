"use client";

/**
 * 처음 온 회원을 위한 짧은 안내 — 다섯 장(ui-friendly-motion, promo-videos).
 *
 * Chat, Project Builder, Video Generator, 지원금, 그리고 마지막에 1분짜리
 * 소개 영상(`PromoVideo` — **어느 기기에서나 16:9 가로 편**; 세로 편은
 * CtrlAITube의 것입니다. 저절로 재생하지 않고 소리는 켜야 들립니다). 처음 로그인했을 때
 * 한 번 뜨고, 닫거나 끝까지 보면 이 브라우저에 기억해 다시 뜨지 않습니다
 * (`ctrlai.guide-done`). 사이드바 아래의 물음표 단추로 언제든 다시 엽니다.
 *
 * 화면 위를 덮는 창이지만 짧고, Esc나 "건너뛰기"로 바로 닫힙니다.
 */

import { AnimatePresence, motion } from "motion/react";
import { Clapperboard, Code2, MessageSquare, PlayCircle, Wallet, X, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getTubeVideo } from "@/lib/tube";

import PromoVideo, { type PromoClip } from "./PromoVideo";
import styles from "./guide.module.css";

/** 안내 창의 영상 — 16:9 가로 편, 기기와 상관없이. 서버
 *  (`GET /api/tube/videos/ctrlai-intro`의 `hosted_desktop_src`)가 정답이고,
 *  이 값은 그 응답이 오기 전이나 실패했을 때의 대비입니다. 새 인코딩은
 *  백엔드 `services/tube.py`의 OFFICIAL에 올리고 여기도 맞춥니다. */
export const GUIDE_CLIP: PromoClip = {
  src: "/promo/ctrlai-intro-desktop-v1.mp4",
  poster: "/promo/ctrlai-intro-desktop-v1.jpg",
  orientation: "wide",
};

export const GUIDE_STORAGE_KEY = "ctrlai.guide-done";

interface Step {
  Icon: LucideIcon;
  title: string;
  text: string;
  /** 이 장에는 소개 영상이 들어갑니다. */
  video?: boolean;
}

export const GUIDE_STEPS: Step[] = [
  {
    Icon: MessageSquare,
    title: "Chat — 무엇이든 물어보세요",
    text: "궁금한 것을 편하게 적으면 돼요. 앱이나 영상을 만들고 싶다고 말하면 알맞은 곳으로 안내해 드려요.",
  },
  {
    Icon: Code2,
    title: "Project Builder — 앱 만들기",
    text: "만들고 싶은 앱을 한국어로 설명하면 Claude가 바로 써 볼 수 있는 작은 예시 앱을 만들어 줘요.",
  },
  {
    Icon: Clapperboard,
    title: "Video Generator — 영상 만들기",
    text: "아이디어를 적으면 짧은 영상을 만들어요. 여러 번 만들어 보고 마음에 드는 것을 최종본으로 고르세요.",
  },
  {
    Icon: Wallet,
    title: "동아리 지원금",
    text: "메뉴 아래쪽 카드가 이번 분기 지원금이에요(휴대폰에서는 위의 '메뉴'를 눌러 보세요). 채팅도 영상도 여기서 쓰고, 버튼 옆에 예상 비용이 먼저 보여요.",
  },
  {
    Icon: PlayCircle,
    title: "CTRL+AI 한눈에 보기",
    text: "1분짜리 소개 영상이에요. 재생을 누르면 시작하고, 소리는 '소리 켜기'로 켜요. CtrlAITube에서 언제든 다시 볼 수 있어요.",
    video: true,
  },
];

interface GuideApi {
  open: () => void;
}

const GuideContext = createContext<GuideApi>({ open: () => {} });

export function useGuide(): GuideApi {
  return useContext(GuideContext);
}

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_STORAGE_KEY) === "1";
  } catch {
    // 저장소를 막아 둔 브라우저: 매번 띄우지 않도록 본 것으로 칩니다.
    return true;
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(GUIDE_STORAGE_KEY, "1");
  } catch {
    /* 기억하지 못해도 이번에는 닫힙니다 */
  }
}

/**
 * 안내 창과 그것을 여는 함수. 로그인한 화면(AppShell) 안에서만 씁니다 —
 * `autoOpen`이 참이면 처음 온 브라우저에서 한 번 저절로 뜹니다.
 */
export default function GuideProvider({
  autoOpen,
  children,
}: {
  autoOpen: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    if (autoOpen && !alreadySeen()) queueMicrotask(() => setOpen(true));
  }, [autoOpen]);

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    remember();
    setOpen(false);
  }, []);
  const api = useMemo(() => ({ open }), [open]);

  return (
    <GuideContext.Provider value={api}>
      {children}
      <AnimatePresence>{isOpen && <GuideDialog key="guide" onClose={close} />}</AnimatePresence>
    </GuideContext.Provider>
  );
}

/** 마지막 장의 영상 — 가로 편. 파일 주소는 CtrlAITube와 같은 곳(서버)에서 읽습니다. */
function GuideVideo() {
  const [clip, setClip] = useState<PromoClip>(GUIDE_CLIP);
  useEffect(() => {
    let alive = true;
    getTubeVideo("ctrlai-intro")
      .then((row) => {
        if (!alive || !row.hosted_desktop_src) return;
        setClip({ src: row.hosted_desktop_src, poster: row.poster_desktop_src, orientation: "wide" });
      })
      .catch(() => {
        /* 서버가 답하지 않으면 위의 값으로 */
      });
    return () => {
      alive = false;
    };
  }, []);
  return <PromoVideo clip={clip} title="CTRL+AI 소개 영상" className={styles.video} />;
}

function GuideDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const primary = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // 닫으면 연 단추(사이드바의 ?)로 초점을 돌려줍니다.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      // On a phone the opener sits in the menu, which closed when the guide
      // opened; then the top bar's menu button is the nearest place.
      const target =
        opener && opener.offsetParent !== null
          ? opener
          : document.querySelector<HTMLElement>("[aria-controls='primary-navigation']");
      target?.focus();
    };
  }, []);
  const last = step === GUIDE_STEPS.length - 1;
  const { Icon, title, text, video } = GUIDE_STEPS[step];

  useEffect(() => {
    primary.current?.focus();
  }, [step]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // Tab은 창 안에서만 돕니다(aria-modal).
      if (event.key !== "Tab" || box.current === null) return;
      const focusable = Array.from(
        box.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href]"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!box.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={box}
        className={`${styles.dialog} ${video ? styles.dialogWide : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <button className={styles.close} type="button" onClick={onClose} aria-label="안내 닫기">
          <X size={16} aria-hidden="true" />
        </button>

        <p className={styles.counter}>
          {step + 1} / {GUIDE_STEPS.length}
        </p>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            className={styles.step}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.16 }}
          >
            <Icon className={styles.icon} aria-hidden="true" />
            <h2 className={styles.title} id="guide-title">
              {title}
            </h2>
            <p className={styles.text}>{text}</p>
            {video && <GuideVideo />}
          </motion.div>
        </AnimatePresence>

        <div className={styles.dots} aria-hidden="true">
          {GUIDE_STEPS.map((_, index) => (
            <span key={index} className={`${styles.dot} ${index === step ? styles.dotOn : ""}`} />
          ))}
        </div>

        <div className={styles.actions}>
          {last ? (
            <span />
          ) : (
            <button className="btn btn-sm" type="button" onClick={onClose}>
              건너뛰기
            </button>
          )}
          <span className={styles.actionsRight}>
            {step > 0 && (
              <button className="btn btn-sm" type="button" onClick={() => setStep(step - 1)}>
                이전
              </button>
            )}
            <button
              ref={primary}
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => (last ? onClose() : setStep(step + 1))}
            >
              {last ? "시작하기" : "다음"}
            </button>
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
