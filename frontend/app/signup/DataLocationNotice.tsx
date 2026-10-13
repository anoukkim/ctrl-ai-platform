"use client";

/**
 * 회원가입 화면의 "정보가 어디에 저장되는지" 안내.
 *
 * 문구는 서버의 .env(`DATA_LOCATION_NOTICE`)에서 옵니다. 데이터베이스를
 * 다른 지역으로 옮기면 코드를 고치지 않고 그 한 줄만 바꿉니다.
 */

import { useSite } from "@/app/components/SiteProvider";

import styles from "@/app/login/auth.module.css";

export default function DataLocationNotice() {
  const { data_location_notice } = useSite();
  if (!data_location_notice) return null;
  return (
    <p className={styles.notice} data-testid="data-location">
      {data_location_notice}
    </p>
  );
}
