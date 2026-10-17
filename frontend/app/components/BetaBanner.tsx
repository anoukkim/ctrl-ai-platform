"use client";

/**
 * 베타 배너 — APP_ENV=beta일 때 모든 화면 맨 위에 붙는 한 줄.
 *
 * 로그인 화면에도 붙습니다. 처음 들어온 사람에게 가장 먼저 알려야 하는
 * 것이 "아직 시험 운영 중"이라는 사실이기 때문입니다. 로그인한 회원에게는
 * 의견 보내기 단추를 함께 둡니다 — 배너를 읽는 순간이 불편을 말하고 싶은
 * 순간이기도 합니다.
 *
 * 문구와 보이기, 의견 보내기 링크는 관리자가 Admin › System › 공지 띠에서
 * 정합니다(admin-consolidation v3 (4)) — 저장한 적이 없으면 베타에서만 이
 * 문장으로 보입니다. "베타" 꼬리표는 베타일 때만 붙습니다.
 *
 * 높이는 `--banner-h`(globals.css)입니다. 화면 높이를 꽉 채우는 Chat과
 * 작업 공간이 그 값만큼 줄어들어, 배너가 입력창을 밀어내지 않습니다.
 */

import FeedbackButton from "./FeedbackButton";

import { useCurrentUser } from "./CurrentUserProvider";
import { siteBanner } from "@/lib/site";

import { useSite } from "./SiteProvider";

import styles from "./beta-banner.module.css";

export default function BetaBanner() {
  const site = useSite();
  const { state } = useCurrentUser();
  const banner = siteBanner(site);
  if (!banner.shown) return null;

  return (
    <div className={styles.banner} role="region" aria-label={site.is_beta ? "베타 안내" : "공지"}>
      {site.is_beta && <span className={styles.tag}>베타</span>}
      <span className={styles.text}>{banner.text}</span>
      {banner.feedback_link && state.phase === "authenticated" && (
        <FeedbackButton variant="link" className={styles.feedback} />
      )}
    </div>
  );
}
