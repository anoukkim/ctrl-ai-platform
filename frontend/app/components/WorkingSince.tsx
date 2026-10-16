"use client";

/**
 * "N초" — 무언가 돌아가는 동안 흐르는 초 (owner-polish 14).
 *
 * Builder의 "index.html 작성 중… 12초"와 Chat의 "생각하는 중… 4초"가 같은
 * 것을 씁니다. 1초마다 한 번 다시 그리고, 움직임 줄이기와는 상관없이
 * 보입니다 — 숫자가 바뀌는 것은 움직임이 아니라 정보예요. 시작 시각이
 * 바뀌면(다음 파일) 0부터 다시 셉니다.
 */

import { useEffect, useState } from "react";

export function elapsedSeconds(since: number, now: number): number {
  return Math.max(0, Math.floor((now - since) / 1000));
}

export default function WorkingSince({ since, className }: { since: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // 시작 시각이 바뀌면 다음 틱까지 now < since일 수 있어 0초로 보입니다 —
    // 그게 맞는 값이라 바로 다시 그리지 않습니다.
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  return (
    <span className={className} data-testid="working-since">
      {elapsedSeconds(since, now)}초
    </span>
  );
}
