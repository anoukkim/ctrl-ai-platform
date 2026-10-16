"use client";

/**
 * 앱의 작은 그림 — CtrlAIApps 카드와 상세 머리 줄, Project Builder 카드가
 * 같은 것을 씁니다 (ui-improvements).
 *
 * 찍어 둔 썸네일(`imageUrl`)이 있으면 그 그림을, 없으면 — 또는 그림을 못
 * 불러오면 — 주소(`seed`)에서 늘 같은 색을 뽑은 표지에 이름을 얹습니다.
 * 썸네일은 만든 사람의 브라우저에서 찍어 서버가 다시 인코딩한 WebP입니다
 * (lib/thumbnail-capture.ts).
 */

import { Code2 } from "lucide-react";
import { useState } from "react";

import { appThumbnailUrl, coverTint, type AppListing } from "@/lib/apps";

import styles from "./ctrlaistore.module.css";

interface Props {
  name: string;
  /** 색을 정하는 씨앗 — 앱 주소나 프로젝트 번호. 같은 값이면 늘 같은 색. */
  seed: string;
  /** 찍어 둔 썸네일. 없으면 표지. */
  imageUrl?: string | null;
  /** `card`는 16:10 전체 너비, `small`은 머리 줄의 작은 칸. */
  size?: "card" | "small";
  /**
   * 표지에 얹는 것: 이름(기본), 또는 아이콘만 — Builder 카드는 바로 아래에
   * 이름이 있으니 표지에 또 적지 않습니다.
   */
  label?: "name" | "icon";
}

export default function Thumbnail({ name, seed, imageUrl = null, size = "card", label = "name" }: Props) {
  const [broken, setBroken] = useState(false);
  const small = size === "small";
  if (imageUrl && !broken) {
    return (
      <div className={`${styles.artwork} ${styles.artworkPhoto} ${small ? styles.artworkSmall : ""}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- 백엔드가 주는 WebP, 크기는 CSS가 정합니다 */}
        <img className={styles.artworkImage} src={imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
      </div>
    );
  }
  return (
    <div
      className={`${styles.artwork} ${small ? styles.artworkSmall : ""}`}
      style={{ background: coverTint(seed) }}
      aria-hidden="true"
    >
      {label === "icon" ? (
        <Code2 className={styles.artworkText} size={28} aria-hidden="true" />
      ) : (
        <span className={styles.artworkText}>{small ? name.slice(0, 1) : name}</span>
      )}
    </div>
  );
}

/** 게시된 앱의 그림: 썸네일이 있으면 그것, 없으면 표지. */
export function AppThumbnail({ app, size }: { app: AppListing; size?: "card" | "small" }) {
  return <Thumbnail name={app.name} seed={app.slug} imageUrl={appThumbnailUrl(app)} size={size} />;
}
