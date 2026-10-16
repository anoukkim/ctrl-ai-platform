/**
 * CtrlAITube — 영상, 반응, 댓글 (promo-videos).
 *
 * 첫 실제 행은 CTRL+AI의 소개 영상(공식)입니다. CTRL+AI가 직접 서빙하는
 * 파일(`kind: "hosted"`)이라 이 안에서 바로 재생되고, 반응과 댓글은
 * CTRL+AI의 PostgreSQL에 저장됩니다. 회원들의 YouTube 영상(`kind:
 * "youtube"`)은 Phase 8에서 같은 표에 들어옵니다.
 */

import type { MembershipStatus } from "./quarters";
import { request } from "./http";

export type TubeReaction = "like" | "useful" | "interesting";

export interface TubeAuthor {
  username: string;
  display_name: string;
  membership: MembershipStatus;
}

export interface TubeComment {
  id: number;
  author: TubeAuthor | null;
  body: string;
  created_at: string;
  updated_at: string;
  /** 내 댓글 — 고치거나 지울 수 있어요. */
  mine: boolean;
  replies: TubeComment[];
}

export interface TubeVideo {
  id: number;
  /** 주소: /ctrlaitube/<slug>. */
  slug: string;
  kind: "hosted" | "youtube";
  title: string;
  description: string;
  /** CTRL+AI의 영상 — 목록 맨 앞, 공식 꼬리표. */
  official: boolean;
  creator: TubeAuthor | null;
  hosted_desktop_src: string;
  hosted_mobile_src: string;
  poster_desktop_src: string;
  poster_mobile_src: string;
  youtube_video_id: string | null;
  duration_seconds: number;
  published_at: string;
  reactions: Record<TubeReaction, number>;
  my_reactions: TubeReaction[];
  comment_count: number;
}

export interface TubeVideoDetail extends TubeVideo {
  comments: TubeComment[];
}

export function listTubeVideos(): Promise<TubeVideo[]> {
  return request<TubeVideo[]>("/tube/videos");
}

export function getTubeVideo(slug: string): Promise<TubeVideoDetail> {
  return request<TubeVideoDetail>(`/tube/videos/${encodeURIComponent(slug)}`);
}

export function toggleTubeReaction(
  slug: string,
  kind: TubeReaction,
): Promise<{ kind: TubeReaction; on: boolean; reactions: Record<TubeReaction, number> }> {
  return request(`/tube/videos/${encodeURIComponent(slug)}/reactions`, {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}

export function addTubeComment(slug: string, body: string, parentId: number | null = null): Promise<TubeComment> {
  return request<TubeComment>(`/tube/videos/${encodeURIComponent(slug)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, parent_id: parentId }),
  });
}

export function editTubeComment(commentId: number, body: string): Promise<TubeComment> {
  return request<TubeComment>(`/tube/comments/${commentId}`, { method: "PATCH", body: JSON.stringify({ body }) });
}

export function deleteTubeComment(commentId: number): Promise<void> {
  return request<void>(`/tube/comments/${commentId}`, { method: "DELETE" });
}

export function reportTubeComment(commentId: number, reason: string): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/tube/comments/${commentId}/report`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export { formatDuration } from "./duration";

// ------------------------------------------------------------------ Admin › Content

export interface AdminTubeReport {
  id: number;
  /** null — 댓글이 완전히 지워진 뒤. */
  comment_id: number | null;
  video_slug: string;
  video_title: string;
  reason: string;
  excerpt: string;
  reporter_username: string;
  author_username: string;
  created_at: string;
  /** 댓글이 아직 보여요 — 숨기거나 지울 수 있어요. */
  comment_live: boolean;
}

export function listTubeReports(): Promise<AdminTubeReport[]> {
  return request<AdminTubeReport[]>("/admin/tube/reports");
}

export function adminTubeComment(
  commentId: number,
  action: "hide" | "delete",
  reason: string,
): Promise<{ detail: string; reports_closed: number }> {
  return request(`/admin/tube/comments/${commentId}/${action}`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function resolveTubeReport(reportId: number, note: string): Promise<{ detail: string }> {
  return request<{ detail: string }>(`/admin/tube/reports/${reportId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}
