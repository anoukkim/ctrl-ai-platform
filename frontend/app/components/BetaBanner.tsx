"use client";

/**
 * 베타 배너 — APP_ENV=beta일 때 모든 화면 맨 위에 붙는 한 줄.
 *
 * 로그인 화면에도 붙습니다. 처음 들어온 사람에게 가장 먼저 알려야 하는
 * 것이 "아직 시험 운영 중"이라는 사실이기 때문입니다. 로그인한 회원에게는
 * 의견 보내기 단추를 함께 둡니다 — 배너를 읽는 순간이 불편을 말하고 싶은
 * 순간이기도 합니다.
 *
 * 높이는 `--banner-h`(globals.css)입니다. 화면 높이를 꽉 채우는 Chat과
 * 작업 공간이 그 값만큼 줄어들어, 배너가 입력창을 밀어내지 않습니다.
 */

import FeedbackButton from "./FeedbackButton";

import { useCurrentUser } from "./CurrentUserProvider";
import { useSite } from "./SiteProvider";

import styles from "./beta-banner.module.css";

export default function BetaBanner() {
  const { is_beta } = useSite();
  const { state } = useCurrentUser();
  if (!is_beta) return null;

  return (
    <div className={styles.banner} role="region" aria-label="베타 안내">
      <span className={styles.tag}>베타</span>
      <span className={styles.text}>
        CTRL+AI는 지금 초대받은 회원과 함께 시험 운영 중입니다.
      </span>
      {state.phase === "authenticated" && (
        <FeedbackButton variant="link" className={styles.feedback} />
      )}
    </div>
  );
}
