/**
 * CtrlAITube 영상 재생 화면 — `/ctrlaitube/<slug>`.
 *
 * 영상은 백엔드의 `tube_videos`에서 옵니다(지금은 CTRL+AI 소개 영상
 * `ctrlai-intro` 하나). 화면 자체는 `TubeVideoView`가 그립니다 — 같은
 * 두 칸 배치에 진짜 영상과 저장되는 반응·댓글. 예시 영상의 화면은
 * fix-promo-video-placement(2026-10-16)에서 예시 데이터와 함께 지웠습니다.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TubeVideoView from "./TubeVideoView";

interface VideoDetailProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "CtrlAITube — CTRL+AI",
};

export default async function VideoDetailPage({ params }: VideoDetailProps) {
  const { id } = await params;
  // 주소의 모양만 여기서 거릅니다. 없는 영상은 화면이 "찾을 수 없어요"로 답합니다.
  if (!/^[a-z0-9-]{1,40}$/.test(id)) notFound();
  return <TubeVideoView slug={id} />;
}
