/**
 * CTRL+AI 프로젝트 API 클라이언트.
 *
 * 화면은 주소를 알 필요가 없도록, 네트워크 호출은 여기에 모읍니다.
 * 응답 모양은 백엔드의 app/schemas/builder.py, app/schemas/video.py와
 * 짝을 이룹니다.
 *
 * 소유권은 백엔드가 정합니다. 여기서 사용자 id를 보내지 않습니다.
 */

import { API_BASE_URL } from "./api";
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

/**
 * 프로젝트를 지웁니다.
 *
 * 백엔드에서는 행이 사라지지 않고 `deleted_at`만 찍힙니다. 회원 쪽에서는
 * 모든 경로에서 404가 되므로 결과는 같고, 관리자가 되살릴 수 있습니다.
 */
export function deleteBuilderProject(id: number | string): Promise<void> {
  return request<void>(`/builder/projects/${id}`, { method: "DELETE" });
}

/**
 * 프로젝트의 코드를 ZIP으로 받는 주소.
 *
 * `request`를 쓰지 않습니다. 내려오는 것이 JSON이 아니고, 브라우저가
 * 파일로 저장해 주기를 바라는 응답입니다. 그래서 이 주소로 그냥
 * 이동시키면 됩니다 — `Content-Disposition: attachment`가 붙어 있어
 * 화면은 그대로 있고 파일만 내려옵니다.
 *
 * 같은 출처이므로 세션 쿠키도 함께 갑니다. 참여하지 않는 분기에도
 * 열려 있는 길입니다 — 내가 만든 것을 꺼내 오는 일이니까요.
 */
export function builderProjectDownloadUrl(id: number | string): string {
  return `${API_BASE_URL}/api/builder/projects/${id}/download`;
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
  capabilities: VideoCapabilities;
}

/**
 * 한 모델의 카탈로그 항목 — 영상 만들기는 전부 이것을 따릅니다.
 *
 * 백엔드의 `VideoCapabilities`(app/schemas/video.py)와 같은 모양이고,
 * 거기서 검사를 마친 값만 내려옵니다. 가격은 화질마다 초당 원입니다.
 */
export interface VideoCapabilities {
  durations: number[];
  aspect_ratios: string[];
  resolutions: string[];
  sound: boolean;
  supports_edit: boolean;
  supports_extend: boolean;
  price_per_second_krw: Record<string, number>;
  defaults: {
    duration_seconds: number;
    aspect_ratio: string;
    resolution: string;
    sound: boolean;
  };
  /** 아직 아무 관리자도 확인하지 않은 예시 가격인지. */
  prices_are_examples: boolean;
}

/** 버전을 만든 방법: 생성 / 수정 / 이어서. */
export type VideoVersionKind = "generate" | "edit" | "extend";

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
  /**
   * 이 버전을 만들 때의 설정. 프롬프트와 같은 이유로 버전마다 따로
   * 남깁니다 — 회원이 설정을 바꿔도 버전은 자기를 만든 값을 그대로
   * 보여 줘야 합니다.
   *
   * `null`은 "이 칸이 생기기 전에 만들어진 버전이라 알 수 없음"입니다.
   * 지금 고른 값으로 메우면 안 됩니다. 그것이 10초로 만든 버전을
   * 0:15로 재생하던 이유였습니다.
   */
  duration_seconds: number | null;
  aspect_ratio: string | null;
  sound: boolean | null;
  /** 화질. 설정이 기록되기 전에 만든 버전은 null입니다. */
  resolution: string | null;
  /** Auto가 고른 모델인지. 화면에는 "Auto → Kling 3.0 Pro"로 나옵니다. */
  auto_selected: boolean | null;
  /** 어떻게 만들었는지, 그리고 수정·이어서라면 어느 버전에서 왔는지. */
  kind: VideoVersionKind;
  source_version_id: number | null;
  /** 수정할 때 적은 요청. 다른 방법으로 만든 버전은 null입니다. */
  instruction: string | null;
  /**
   * 내려받을 파일이 있는지.
   *
   * 보관 위치는 백엔드의 일이라 내려오지 않습니다. 화면에 필요한 것은
   * 단추를 눌러도 되는지 여부뿐입니다.
   */
  has_asset: boolean;
}

export interface VideoProject {
  id: number;
  name: string;
  prompt: string;
  selected_model_id: number | null;
  status: VideoProjectStatus;
  final_version_id: number | null;
  /** 최종본에 내려받을 파일이 있는지. 목록 카드의 "최종본 다운로드"가 씁니다. */
  final_version_has_asset: boolean;
  created_at: string;
  updated_at: string;
}

export interface VideoProjectDetail extends VideoProject {
  versions: VideoVersion[];
  selected_model: VideoModel | null;
}

/** "Auto"는 CTRL+AI의 선택지이지 Higgsfield 모델 id가 아닙니다. */
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

/**
 * 만들어진 영상 한 편을 받는 주소.
 *
 * Builder의 ZIP과 같은 방식입니다 — 링크로 두면 브라우저가 파일로
 * 저장하고, 참여하지 않는 분기에도 열려 있습니다.
 *
 * 내려오는 것은 CTRL+AI가 보관한 파일이지 제공자의 주소가 아닙니다.
 * 제공자 링크는 만료되거나 그쪽 자격 증명을 요구할 수 있고, 내가 만든
 * 것을 받는 일이 거기에 매여서는 안 됩니다.
 */
export function videoVersionDownloadUrl(
  projectId: number | string,
  versionId: number,
): string {
  return `${API_BASE_URL}/api/video/projects/${projectId}/versions/${versionId}/download`;
}

/** 영상 프로젝트를 지웁니다. Builder와 같은 soft delete입니다. */
export function deleteVideoProject(id: number | string): Promise<void> {
  return request<void>(`/video/projects/${id}`, { method: "DELETE" });
}

/** 영상을 만듭니다(Higgsfield, 지금은 mock). Video 지원금에서 차감됩니다.
 *
 *  프롬프트와 모델은 백엔드가 프로젝트에서 읽습니다. 길이·비율·화질·소리는
 *  프로젝트가 아니라 작업 공간의 조작부에 있으므로 여기서 보냅니다.
 *  보낸 값이 모델의 카탈로그에 있는지는 백엔드가 다시 확인합니다. */
export function createVideoVersion(
  id: number | string,
  settings?: {
    duration_seconds?: number;
    aspect_ratio?: string;
    resolution?: string;
    sound?: boolean;
  },
): Promise<VideoVersion> {
  return request<VideoVersion>(`/video/projects/${id}/versions`, {
    method: "POST",
    body: JSON.stringify(settings ?? {}),
  });
}

/** 이 영상 수정하기 — 고른 버전과 요청을 보내 새 버전을 만듭니다.
 *  길이·비율·화질은 원본을 따르므로 보내지 않습니다. */
export function editVideoVersion(
  projectId: number | string,
  versionId: number,
  instruction: string,
): Promise<VideoVersion> {
  return request<VideoVersion>(`/video/projects/${projectId}/versions/${versionId}/edit`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

/** 이어서 만들기 — 모델이 허용하는 길이만큼 덧붙인 새 버전을 만듭니다. */
export function extendVideoVersion(
  projectId: number | string,
  versionId: number,
  durationSeconds: number,
): Promise<VideoVersion> {
  return request<VideoVersion>(`/video/projects/${projectId}/versions/${versionId}/extend`, {
    method: "POST",
    body: JSON.stringify({ duration_seconds: durationSeconds }),
  });
}

export interface PromptHelp {
  reply: string;
  /** Claude가 고친 프롬프트. 고치지 않고 답만 했으면 null입니다. */
  revised_prompt: string | null;
  /** Build(Claude) 지원금에서 빠진 금액. */
  charged_krw: number;
}

/** 프롬프트 도움받기 — Claude가 글만 고쳐 줍니다. 영상은 만들지 않습니다. */
export function askPromptHelp(
  projectId: number | string,
  input: { prompt: string; request: string },
): Promise<PromptHelp> {
  return request<PromptHelp>(`/video/projects/${projectId}/prompt-help`, {
    method: "POST",
    body: JSON.stringify(input),
  });
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

/** 어느 제품의 작업물인지. 주소에 그대로 들어가는 두 낱말입니다. */
export type WorkKind = "builder" | "video";

export const WORK_KIND_LABEL: Record<WorkKind, string> = {
  builder: "프로젝트",
  video: "영상 프로젝트",
};

/**
 * 삭제된 프로젝트 또는 영상 한 줄.
 *
 * 회원 쪽에서는 없는 것으로 보이는 행입니다 — 모든 회원 경로가 404로
 * 답합니다. 이 목록만이 그것을 볼 수 있고, 되살릴 수 있는 곳입니다.
 *
 * 두 제품을 한 표에 섞어 내려 주는 이유: 되살리려는 관리자는 그것이
 * 어느 제품에서 왔는지보다 누구의 것이고 언제 사라졌는지를 봅니다.
 */
export interface DeletedItem {
  kind: WorkKind;
  id: number;
  name: string;
  owner_user_id: number;
  owner_username: string;
  owner_display_name: string;
  deleted_at: string;
  created_at: string;
  updated_at: string;
}

export function listDeletedItems(): Promise<DeletedItem[]> {
  return request<DeletedItem[]>("/admin/deleted-items");
}

export function restoreWork(kind: WorkKind, id: number): Promise<void> {
  return request<void>(`/admin/work/${kind}/${id}/restore`, { method: "POST" });
}

/** 남의 작업물을 지웁니다. 감사 로그에 남습니다. */
export function deleteWork(kind: WorkKind, id: number): Promise<void> {
  return request<void>(`/admin/work/${kind}/${id}`, { method: "DELETE" });
}

export function listAdminVideoModels(): Promise<AdminVideoModel[]> {
  return request<AdminVideoModel[]>("/admin/video-models");
}

export function updateAdminVideoModel(
  id: number,
  changes: Partial<
    Pick<AdminVideoModel, "enabled" | "member_visible" | "sort_order" | "capabilities">
  >,
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
