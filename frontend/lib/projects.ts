/**
 * Ctrl AI 프로젝트 API 클라이언트.
 *
 * 화면은 주소를 알 필요가 없도록, 네트워크 호출은 여기에 모읍니다.
 * 응답 모양은 백엔드의 app/schemas/builder.py, app/schemas/video.py와
 * 짝을 이룹니다.
 *
 * 소유권은 백엔드가 정합니다. 여기서 사용자 id를 보내지 않습니다.
 */

import { describeError, request } from "./http";

export { describeError };

/* ------------------------------------------------------------------ */
/* Project Builder                                                     */
/* ------------------------------------------------------------------ */

export type BuilderProjectStatus =
  | "draft"
  | "building"
  | "ready"
  | "published"
  | "archived";

export interface BuilderProject {
  id: number;
  name: string;
  description: string;
  status: BuilderProjectStatus;
  github_repo: string | null;
  created_at: string;
  updated_at: string;
}

export const BUILDER_STATUS_LABEL: Record<BuilderProjectStatus, string> = {
  draft: "Draft",
  building: "Building",
  ready: "Ready",
  published: "Published",
  archived: "Archived",
};

/** 상태 배지에 쓸 색. globals.css의 배지 클래스 이름입니다. */
export const BUILDER_STATUS_BADGE: Record<BuilderProjectStatus, string> = {
  draft: "badge-muted",
  building: "badge-warn",
  ready: "badge-accent",
  published: "badge-ok",
  archived: "badge-muted",
};

export function listBuilderProjects(): Promise<BuilderProject[]> {
  return request<BuilderProject[]>("/builder/projects");
}

export function getBuilderProject(id: number | string): Promise<BuilderProject> {
  return request<BuilderProject>(`/builder/projects/${id}`);
}

export function createBuilderProject(input: {
  name: string;
  description?: string;
}): Promise<BuilderProject> {
  return request<BuilderProject>("/builder/projects", {
    method: "POST",
    body: JSON.stringify({ name: input.name, description: input.description ?? "" }),
  });
}

export function updateBuilderProject(
  id: number | string,
  changes: Partial<Pick<BuilderProject, "name" | "description" | "status">>,
): Promise<BuilderProject> {
  return request<BuilderProject>(`/builder/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/* ------------------------------------------------------------------ */
/* Video Generator                                                     */
/* ------------------------------------------------------------------ */

export type VideoProjectStatus =
  | "draft"
  | "generating"
  | "ready"
  | "published"
  | "archived";

export type VideoVersionStatus = "queued" | "generating" | "ready" | "failed";

export const VIDEO_STATUS_LABEL: Record<VideoProjectStatus, string> = {
  draft: "Draft",
  generating: "Generating",
  ready: "Ready",
  published: "Published",
  archived: "Archived",
};

export const VIDEO_STATUS_BADGE: Record<VideoProjectStatus, string> = {
  draft: "badge-muted",
  generating: "badge-warn",
  ready: "badge-accent",
  published: "badge-ok",
  archived: "badge-muted",
};

/**
 * 회원이 고를 수 있는 모델.
 *
 * 목록은 백엔드가 정합니다. `enabled`와 `member_visible`이 모두 켜진
 * 모델만 내려오므로, 프런트엔드에 모델 이름을 적어 두지 않습니다.
 */
export interface VideoModel {
  id: number;
  provider: string;
  model_id: string;
  display_name: string;
  description: string;
  sort_order: number;
  /** 모델마다 지원하는 설정이 달라 자유 형식입니다. */
  capabilities: {
    durations?: number[];
    aspect_ratios?: string[];
    sound?: boolean;
    generation_types?: string[];
  };
}

export interface VideoVersion {
  id: number;
  label: string;
  provider: string;
  model_id: string;
  provider_job_id: string | null;
  asset_url: string | null;
  prompt_snapshot: string;
  status: VideoVersionStatus;
  created_at: string;
}

export interface VideoProject {
  id: number;
  name: string;
  prompt: string;
  selected_model_id: number | null;
  status: VideoProjectStatus;
  final_version_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface VideoProjectDetail extends VideoProject {
  versions: VideoVersion[];
  selected_model: VideoModel | null;
}

/** "Auto"는 Ctrl AI의 선택지이지 Higgsfield 모델 id가 아닙니다. */
export const AUTO_MODEL = "auto" as const;

export function listVideoModels(): Promise<VideoModel[]> {
  return request<VideoModel[]>("/video/models");
}

export function listVideoProjects(): Promise<VideoProject[]> {
  return request<VideoProject[]>("/video/projects");
}

export function getVideoProject(id: number | string): Promise<VideoProjectDetail> {
  return request<VideoProjectDetail>(`/video/projects/${id}`);
}

export function createVideoProject(input: {
  name: string;
  prompt?: string;
  selected_model_id?: number | null;
}): Promise<VideoProject> {
  return request<VideoProject>("/video/projects", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      prompt: input.prompt ?? "",
      selected_model_id: input.selected_model_id ?? null,
    }),
  });
}

export function updateVideoProject(
  id: number | string,
  changes: Partial<
    Pick<VideoProject, "name" | "prompt" | "selected_model_id" | "status" | "final_version_id">
  >,
): Promise<VideoProjectDetail> {
  return request<VideoProjectDetail>(`/video/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/** 생성 시도를 기록합니다. 아직 실제 영상은 만들어지지 않습니다. */
export function createVideoVersion(id: number | string): Promise<VideoVersion> {
  return request<VideoVersion>(`/video/projects/${id}/versions`, { method: "POST" });
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface AdminVideoModel extends VideoModel {
  enabled: boolean;
  member_visible: boolean;
  created_at: string;
  updated_at: string;
}

export function listAdminVideoModels(): Promise<AdminVideoModel[]> {
  return request<AdminVideoModel[]>("/admin/video-models");
}

export function updateAdminVideoModel(
  id: number,
  changes: Partial<Pick<AdminVideoModel, "enabled" | "member_visible" | "sort_order">>,
): Promise<AdminVideoModel> {
  return request<AdminVideoModel>(`/admin/video-models/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/* ------------------------------------------------------------------ */
/* 공통                                                                 */
/* ------------------------------------------------------------------ */

/** "3분 전", "어제", "2026.09.27" 같은 표기. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  if (hours < 48) return "어제";

  return new Date(iso).toISOString().slice(0, 10).replaceAll("-", ".") + " 수정";
}
