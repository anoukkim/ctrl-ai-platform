"use client";

/**
 * 이번 분기에 참여하지 않는 회원에게 보여 주는 안내 한 줄.
 *
 * Chat, Project Builder, Video Generator 세 화면이 같은 문장을 써야 하므로
 * 한곳에 둡니다. 화면마다 따로 쓰면 문구가 조금씩 어긋나고, 회원은 같은
 * 상황을 세 가지 설명으로 듣게 됩니다.
 *
 * 중요: 이것은 안내일 뿐 차단 장치가 아닙니다. 실제로 막는 것은 백엔드의
 * `require_active_member`입니다. 버튼을 가리는 것만으로는 아무것도
 * 막히지 않습니다 — 요청은 브라우저 밖에서도 보낼 수 있습니다.
 *
 * 참여 중이거나 아직 확인 전이면 아무것도 그리지 않습니다. 확인 전에
 * 안내를 보여 주면 멀쩡히 참여 중인 회원에게 잠깐 깜빡입니다.
 */

import { Lock } from "lucide-react";
import Link from "next/link";

import { NOT_PARTICIPATING_HINT } from "@/lib/quarters";

import { useMayCreate } from "./MyQuarterProvider";
import styles from "./NotParticipatingBanner.module.css";

interface Props {
  /** 작업 영역(Builder·Video)의 가로폭 전체를 쓰는 자리인지. */
  inWorkspace?: boolean;
}

export default function NotParticipatingBanner({ inWorkspace = false }: Props) {
  const mayCreate = useMayCreate();
  if (mayCreate) return null;

  return (
    <div
      className={`${styles.banner} ${inWorkspace ? styles.inWorkspace : ""}`}
      role="status"
    >
      <Lock className={styles.icon} size={14} strokeWidth={2} aria-hidden />
      <p className={styles.body}>
        <span>{NOT_PARTICIPATING_HINT}</span>
        <Link className={styles.link} href="/profile">
          Profile에서 참여 신청하기
        </Link>
      </p>
    </div>
  );
}
