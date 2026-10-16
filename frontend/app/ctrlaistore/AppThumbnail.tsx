/**
 * 앱의 작은 그림 — 카드 위쪽과 상세 머리 줄이 같은 것을 씁니다
 * (ui-improvements).
 *
 * 지금은 주소에서 늘 같은 색을 뽑은 부드러운 표지에 이름을 얹습니다.
 * 썸네일(owner-polish 4·5)이 들어오면 여기만 실제 그림으로 바뀌고, 그림이
 * 없는 앱은 이 표지로 남습니다 — 쓰는 쪽은 바뀌지 않습니다.
 */

import { coverTint, type AppListing } from "@/lib/apps";

import styles from "./ctrlaistore.module.css";

interface Props {
  app: Pick<AppListing, "slug" | "name">;
  /** `card`는 16:10 전체 너비, `small`은 머리 줄의 작은 칸. */
  size?: "card" | "small";
}

export default function AppThumbnail({ app, size = "card" }: Props) {
  return (
    <div
      className={`${styles.artwork} ${size === "small" ? styles.artworkSmall : ""}`}
      style={{ background: coverTint(app.slug) }}
      aria-hidden="true"
    >
      <span className={styles.artworkText}>{size === "small" ? app.name.slice(0, 1) : app.name}</span>
    </div>
  );
}
