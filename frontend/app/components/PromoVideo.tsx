"use client";

/**
 * CTRL+AI 소개 영상 (promo-videos).
 *
 * 한 영상이 두 파일로 있습니다: 데스크탑용 가로(16:9)와 휴대폰용
 * 세로(9:16). 어느 쪽을 틀지는 **사이드바가 펼쳐지는 너비**(60rem,
 * AppShell.module.css)로 정합니다 — 휴대폰에서 가로 영상은 손톱만 하고,
 * 데스크탑에서 세로 영상은 양옆이 비어 보입니다.
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
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import styles from "./promo-video.module.css";

export interface PromoSources {
  desktop: string;
  mobile: string;
  posterDesktop: string;
  posterMobile: string;
}

/** 사이드바가 펼쳐지는 너비와 같은 값(AppShell.module.css). */
export const DESKTOP_QUERY = "(min-width: 60rem)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function isDesktop(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/** 지금 화면이 데스크탑 너비인지. 서버에서는 데스크탑으로 그리고 브라우저가 바로잡습니다. */
export function useDesktopWidth(): boolean {
  return useSyncExternalStore(subscribe, isDesktop, () => true);
}

export default function PromoVideo({
  sources,
  title,
  className = "",
}: {
  sources: PromoSources;
  title: string;
  className?: string;
}) {
  const desktop = useDesktopWidth();
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const src = desktop ? sources.desktop : sources.mobile;
  const poster = desktop ? sources.posterDesktop : sources.posterMobile;

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
    <figure className={`${styles.figure} ${desktop ? styles.wide : styles.tall} ${className}`}>
      <video
        // 너비가 바뀌면 다른 파일이므로 요소를 새로 만듭니다 — src만 바꾸면
        // 브라우저가 옛 파일을 계속 틉니다.
        key={src}
        ref={video}
        className={styles.video}
        src={src}
        poster={poster}
        controls
        playsInline
        muted={muted}
        preload="metadata"
        aria-label={title}
        data-orientation={desktop ? "desktop" : "mobile"}
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
