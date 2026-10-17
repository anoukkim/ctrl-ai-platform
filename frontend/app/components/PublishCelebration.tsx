"use client";

/**
 * 게시 완료 (publish-done-popup, 오너가 고른 A — 2026-10-17).
 *
 * 오너: "게시완료 하면 … 흰글씨랑 컨페티 되거든 뭔가 복잡하단 말이지 차라리 그
 * toasting 처럼 팝업되는 그런걸". 화면 전체를 덮던 빛줄기·섬광·글자 대신,
 * 사용 알림처럼 오른쪽 아래(휴대폰에서는 위)에 작은 카드 하나: 체크가 톡
 * 튀어나오며 **그 둘레에만** 색종이 몇 조각, "게시했어요", 앱 이름 ·
 * CtrlAIApps, 그리고 열어 보기 / 링크 복사. 단추가 있어서 6초 동안 남고
 * (마우스가 올라가 있거나 단추에 포커스가 있으면 기다려요), ✕로 닫을 수
 * 있어요. 입력칸을 가리지 않고 포커스를 가져가지도 않아요. 화면 읽기
 * 프로그램에는 "게시했어요"를 한 번만 알려요. 움직임 줄이기면 색종이 없이
 * 카드만.
 */

import { Check, Copy, ExternalLink, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./celebration.module.css";

export const CELEBRATION_MS = 6000;
const CONFETTI = 6;
const COLOURS = ["#ffd98a", "#c9b6ff", "#ffffff", "#fff1c2", "#7fd6a8"];

/** 체크 둘레로 튀는 한 조각 — 순서로만 정해요. */
function piece(index: number) {
  const angle = ((index * 360) / CONFETTI + 15) * (Math.PI / 180);
  const distance = 24 + (index % 2) * 8;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    colour: COLOURS[index % COLOURS.length],
    rotate: 120 + index * 40,
  };
}

interface Props {
  /** 게시한 앱의 이름. */
  name: string;
  /** 앱의 공개 주소 — 없으면 단추 둘이 빠져요. */
  url: string | null;
  onDone: () => void;
}

export default function PublishCelebration({ name, url, onDone }: Props) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(true);
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    const frame = window.setTimeout(() => setAnnounce(true), 50);
    return () => window.clearTimeout(frame);
  }, []);
  const held = useRef(false);
  const timer = useRef<number | null>(null);

  const arm = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!held.current) setShown(false);
    }, CELEBRATION_MS);
  }, []);
  useEffect(() => {
    arm();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [arm]);

  // 손이 카드 위에 있으면 기다렸다가, 떠나면 다시 6초.
  const hold = () => {
    held.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
  };
  const release = () => {
    held.current = false;
    arm();
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* 복사를 못 해도 열어 보기는 그대로예요 */
    }
  };

  return (
    <>
      {/* 한 번만, 조용히 — 빈 칸이 먼저 있고 글이 나중에 들어와야 읽혀요. */}
      <p className="sr-only" role="status">
        {announce ? "게시했어요" : ""}
      </p>
      <AnimatePresence onExitComplete={onDone}>
        {shown && (
          <motion.div
            className={styles.card}
            data-testid="publish-celebration"
            role="group"
            aria-label="게시 완료"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 420, damping: 30 }}
            onPointerEnter={hold}
            onPointerLeave={release}
            onFocus={hold}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) release();
            }}
          >
            <div className={styles.row}>
              <span className={styles.check} aria-hidden="true">
                <motion.span
                  className={styles.checkMark}
                  initial={reduced ? false : { scale: 0.3 }}
                  animate={{ scale: 1 }}
                  transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 14, delay: 0.08 }}
                >
                  <Check size={16} strokeWidth={3} />
                </motion.span>
                {!reduced &&
                  Array.from({ length: CONFETTI }, (_, index) => {
                    const p = piece(index);
                    return (
                      <motion.i
                        key={index}
                        className={styles.confetti}
                        style={{ background: p.colour }}
                        initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
                        animate={{ x: p.x, y: p.y, opacity: [0, 1, 0], rotate: p.rotate }}
                        transition={{ duration: 0.9, delay: 0.12, ease: "easeOut" }}
                      />
                    );
                  })}
              </span>
              <span className={styles.words}>
                <span className={styles.title}>게시했어요</span>
                <span className={styles.sub}>{name} · CtrlAIApps</span>
              </span>
              <button type="button" className={styles.close} aria-label="닫기" onClick={() => setShown(false)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            {url && (
              <div className={styles.actions}>
                <a className={`${styles.action} ${styles.primary}`} href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} aria-hidden="true" /> 열어 보기
                </a>
                <button type="button" className={styles.action} onClick={() => void copy()}>
                  {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  {copied ? " 복사했어요" : " 링크 복사"}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
