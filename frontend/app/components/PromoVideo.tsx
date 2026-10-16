"use client";

/**
 * CTRL+AI 소개 영상 (promo-videos, fix-promo-video-placement).
 *
 * 영상은 두 편이고 **자리가 다릅니다** — 기기가 아니라: 16:9 가로 편은
 * 처음 온 회원을 위한 안내 창(튜토리얼)에, 9:16 세로 편은 CtrlAITube에
 * 들어갑니다. 어느 기기에서 열든 같은 편이 나옵니다 (오너, 2026-10-16;
 * 처음에는 화면 너비로 가로/세로를 골랐는데, 그것이 아니었습니다).
 *
 * 저절로 재생하지 않습니다. 포스터(첫 장면)가 보이고, 회원이 재생을
 * 누릅니다. 소리는 꺼진 채로 시작하고 "소리 켜기"로 켭니다 — 안내 창이
 * 처음 뜨는 순간 음악이 울리면 놀랍니다. 움직임을 줄인 설정에서도
 * 포스터만 보이므로 따로 할 일이 없습니다. 브라우저의 기본 재생 단추
 * (controls)는 키보드와 화면 읽기 프로그램이 이미 알고 있습니다.
 *
 * 파일은 `/promo/<name>-v1.mp4`처럼 **이름에 판을 적습니다**. 새로 인코딩한
 * 파일은 새 이름이고, 그래서 1년짜리 캐시(next.config.ts)에 옛 파일이
 * 남아 있어도 상관없습니다.
 */

import { Maximize2, Volume2, VolumeX } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import styles from "./promo-video.module.css";

export interface PromoClip {
  src: string;
  poster: string;
  /** "wide" 16:9 (안내 창) · "tall" 9:16 (CtrlAITube). */
  orientation: "wide" | "tall";
}

export default function PromoVideo({
  clip,
  title,
  className = "",
}: {
  clip: PromoClip;
  title: string;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const toggleSound = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      if (video.current) video.current.muted = next;
      return next;
    });
  }, []);

  const enlarge = useCallback(() => {
    const el = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!el) return;
    if (typeof el.requestFullscreen === "function") void el.requestFullscreen().catch(() => {});
    else if (typeof el.webkitEnterFullscreen === "function") el.webkitEnterFullscreen(); // iPhone Safari
  }, []);

  return (
    <figure className={`${styles.figure} ${clip.orientation === "wide" ? styles.wide : styles.tall} ${className}`}>
      <video
        // 다른 파일이 오면 요소를 새로 만듭니다 — src만 바꾸면 브라우저가
        // 옛 파일을 계속 틉니다.
        key={clip.src}
        ref={video}
        className={styles.video}
        src={clip.src}
        poster={clip.poster}
        controls
        playsInline
        muted={muted}
        preload="metadata"
        aria-label={title}
        data-orientation={clip.orientation}
      />
      <figcaption className={styles.caption}>
        <span className={styles.captionText}>{title} · 1분</span>
        <span className={styles.buttons}>
          <button className="btn btn-sm" type="button" onClick={toggleSound} aria-pressed={!muted}>
            {muted ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
            {muted ? "소리 켜기" : "소리 끄기"}
          </button>
          <button className="btn btn-sm" type="button" onClick={enlarge}>
            <Maximize2 size={14} aria-hidden="true" />
            크게 보기
          </button>
        </span>
      </figcaption>
    </figure>
  );
}
