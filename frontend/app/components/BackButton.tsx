"use client";

/**
 * "← 돌아가기" — 안내·약관처럼 다른 화면의 "자세히"로 들어오는 글에 붙어요.
 * 이 사이트 안에서 왔으면 그 화면으로(브라우저 뒤로), 링크로 바로 열었으면 홈으로 가요.
 */

import { useRouter } from "next/navigation";

import { movedInApp } from "@/lib/in-app-nav";

export default function BackButton({ className, fallback = "/" }: { className?: string; fallback?: string }) {
  const router = useRouter();
  const goBack = () => {
    let fromHere = movedInApp();
    try {
      fromHere ||= Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin;
    } catch {
      /* no referrer to read */
    }
    if (fromHere && window.history.length > 1) router.back();
    else router.push(fallback);
  };
  return (
    <button type="button" className={className} onClick={goBack}>
      <span aria-hidden="true">←</span> 돌아가기
    </button>
  );
}
