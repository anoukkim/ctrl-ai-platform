/**
 * CTRL+AI 프로젝트 API 클라이언트.
 *
 * 화면은 주소를 알 필요가 없도록, 네트워크 호출은 여기에 모읍니다.
 * 응답 모양은 백엔드의 app/schemas/builder.py, app/schemas/video.py와
 * 짝을 이룹니다.
 *
 * 소유권은 백엔드가 정합니다. 여기서 사용자 id를 보내지 않습니다.
 */

import type { DepthLevel, PickerModel } from "./depth";
import { API_BASE_URL } from "./api";
import { describeError, request, uploadBytes } from "./http";

export { describeError };

/**
 * Builder로 보내기(chat-plus-artifacts): 채팅 답장의 HTML 블록을 index.html로
 * 가진 새 프로젝트. Claude를 부르지 않으니 무료입니다.
 */
export function createProjectFromChat(input: {
  name: string;
  description: string;
  html: string;
}): Promise<BuilderProject> {
  return request<BuilderProject>("/builder/projects/from-chat", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ------------------------------------------------------------------ */
/* Project Builder                                                     */
/* ------------------------------------------------------------------ */

export type BuilderProjectStatus = "draft" | "building" | "ready" | "published";

export interface BuilderProject {
  id: number;
  name: string;
  description: string;
  status: BuilderProjectStatus;
  github_repo: string | null;
  /** 앱 주소의 폴더 이름(apps.ctrlai.my/<app_slug>/) — builder-static-runtime. */
  app_slug?: string | null;
  /** 작업 중 파일을 미리보기 주소에 마지막으로 올린 때. */
  app_runtime_at?: string | null;
  /** 작업 중 버전의 미리보기 폴더(ctrlaiapps-publish). 공개되지 않습니다. */
  draft_slug?: string | null;
  /** "게시됨 v3" — 게시된 버전 번호. 게시 전이면 null. */
  published_version_number?: number | null;
  /** Claude 판의 모델과 생각 깊이(quality-tuning Q1), 프로젝트마다 기억합니다. */
  chat_model_id?: number | null;
  depth?: DepthLevel | null;
  published_at?: string | null;
  /** 업데이트 메모. */
  publish_note?: string;
  /** 고정한 때 (ui-improvements). null이면 고정하지 않음. */
  pinned_at?: string | null;
  /** 작업 중 썸네일을 마지막으로 찍은 때 (owner-polish 5), 게시된 버전의 썸네일을 찍은 때 (4). */
  draft_thumbnail_at?: string | null;
  published_thumbnail_at?: string | null;
  /** app-ai-access: 다른 회원에게 AI를 어떻게 열었는지, 게시된 버전이 AI를 쓰는지. */
  ai_access?: AiAccess;
  published_uses_ai?: boolean;
  created_at: string;
  updated_at: string;
}

/** app-ai-access — 데모만(방문자의 AI 호출을 서버가 거부, 0원) / 전체 기능(로그인한 방문자가 자기 지원금으로). */
export type AiAccess = "demo" | "full";

export const AI_ACCESS_LABEL: Record<AiAccess, string> = { demo: "데모만", full: "전체 기능" };

/** 만든 사람의 스위치 — 게시 뒤 언제든 바꿀 수 있어요. */
export function setAiAccess(id: number | string, aiAccess: AiAccess): Promise<BuilderProject> {
  return request<BuilderProject>(`/builder/projects/${id}/ai-access`, {
    method: "POST",
    body: JSON.stringify({ ai_access: aiAccess }),
  });
}

/* ---------- 상태: 회원에게는 둘뿐입니다 ----------
 *
 * 데이터베이스에는 draft / building(generating) / ready / published가
 * 있지만, 회원이 보는 배지는 **작성 중**과 **게시됨** 둘뿐입니다(ui-friendly-motion이
 * 개발자 말투의 Draft를 바꿨습니다)
 * (2026-10-07 결정). 만드는 중(building, generating)은 상태가 아니라
 * 지금 일어나는 일이라 배지 대신 "생성 중…" 표시를 붙입니다.
 * 보관(archived)은 없어졌습니다 — 지우기가 되살릴 수 있는 삭제입니다.
 *
 * 화면은 `projectBadge()` 하나를 씁니다. 아래 LABEL / BADGE 표는 예전
 * 이름 그대로 남겨 둔 것이고, 같은 규칙을 따릅니다. */

export type ProjectStatus = BuilderProjectStatus | VideoProjectStatus;

export const DRAFT_LABEL = "작성 중";
export const PUBLISHED_LABEL = "게시됨";
export const WORKING_LABEL = "생성 중…";

/** 배지 하나, 또는 만드는 중 표시. */
export type ProjectBadge =
  | { kind: "badge"; label: string; className: string }
  | { kind: "working"; label: string };

export function projectBadge(status: ProjectStatus): ProjectBadge {
  if (status === "building" || status === "generating") {
    return { kind: "working", label: WORKING_LABEL };
  }
  if (status === "published") {
    return { kind: "badge", label: PUBLISHED_LABEL, className: "badge-ok" };
  }
  return { kind: "badge", label: DRAFT_LABEL, className: "badge-muted" };
}

function labelOf(status: ProjectStatus): string {
  return projectBadge(status).label;
}

/** `badge ${…}`에 그대로 넣을 수 있는 클래스. 만드는 중은 .working. */
function badgeClassOf(status: ProjectStatus): string {
  const badge = projectBadge(status);
  return badge.kind === "badge" ? badge.className : "working";
}

export const BUILDER_STATUS_LABEL: Record<BuilderProjectStatus, string> = {
  draft: labelOf("draft"),
  building: labelOf("building"),
  ready: labelOf("ready"),
  published: labelOf("published"),
};

/** 상태 배지에 쓸 색. globals.css의 배지 클래스 이름입니다. */
export const BUILDER_STATUS_BADGE: Record<BuilderProjectStatus, string> = {
  draft: badgeClassOf("draft"),
  building: badgeClassOf("building"),
  ready: badgeClassOf("ready"),
  published: badgeClassOf("published"),
};

/** 목록의 세 거르기 — 전체 / 작성 중 / 게시됨. 백엔드의 `?status=`와 같은 값. */
export type LibraryFilter = "all" | "draft" | "published";

export const LIBRARY_FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "draft", label: DRAFT_LABEL },
  { value: "published", label: PUBLISHED_LABEL },
];

function filterQuery(filter: LibraryFilter): string {
  return filter === "all" ? "" : `?status=${filter}`;
}

export function listBuilderProjects(filter: LibraryFilter = "all"): Promise<BuilderProject[]> {
  return request<BuilderProject[]>(`/builder/projects${filterQuery(filter)}`);
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

/** 시작 화면의 템플릿 하나 (app-platform P4). 백엔드 `builder_templates.TEMPLATES`. */
export interface BuilderTemplate {
  key: string;
  name: string;
  description: string;
  /** 기능 상자에서 쓰는 것: "AI" · "로그인" · "공유 데이터" · "저장" · "신고". */
  uses: string[];
}

export function listBuilderTemplates(): Promise<BuilderTemplate[]> {
  return request<BuilderTemplate[]>("/builder/templates");
}

/**
 * 템플릿으로 새 프로젝트. 파일을 복사할 뿐 Claude를 부르지 않으니 무료이고,
 * 작업 공간이 바로 미리보기로 열립니다. 이름을 비우면 템플릿 이름이 됩니다.
 */
export function createBuilderProjectFromTemplate(input: {
  template: string;
  name?: string;
}): Promise<BuilderProject> {
  return request<BuilderProject>("/builder/projects/from-template", {
    method: "POST",
    body: JSON.stringify({ template: input.template, name: input.name ?? "" }),
  });
}

/* ------------------------------------------------------------------ */
/* 예시 앱 (chat-builder-starter)                                        */
/* ------------------------------------------------------------------ */

/** 프로젝트 파일 하나. 지금은 읽기만 합니다. */
export interface BuilderFile {
  path: string;
  content: string;
  updated_at: string;
}

export function listBuilderFiles(id: number | string): Promise<BuilderFile[]> {
  return request<BuilderFile[]>(`/builder/projects/${id}/files`);
}

export interface StarterEstimate {
  estimated_krw: number;
  /** 지원금에 이만큼은 남아 있어야 합니다 — 가장 길게 만들었을 때의 값. */
  worst_case_krw: number;
  model_label: string;
}

export function getStarterEstimate(): Promise<StarterEstimate> {
  return request<StarterEstimate>("/builder/starter-estimate");
}

export interface StarterResult {
  files: BuilderFile[];
  /** Claude가 쓴 두 문장: 무엇을 만들었는지, 다음에 무엇을 부탁하면 좋은지. */
  summary: string;
  charged_krw: number;
}

/**
 * Claude가 파일을 쓰는 요청의 대기 시간. 백엔드는 180초까지 기다리므로
 * 화면이 먼저 포기하지 않도록 조금 더 깁니다 — 먼저 끊으면 돈은 나가는데
 * 결과를 못 받습니다.
 */
export const GENERATION_TIMEOUT_MS = 200_000;

/** 빈 프로젝트에 Claude가 작은 예시 앱을 만듭니다. 지원금에서 차감됩니다. */
export function createStarterApp(id: number | string, idea = ""): Promise<StarterResult> {
  return request<StarterResult>(`/builder/projects/${id}/starter`, {
    method: "POST",
    body: JSON.stringify({ idea }),
    timeoutMs: GENERATION_TIMEOUT_MS,
  });
}

// ------------------------------------------------ 만들기 / 고치기, 버전, 앱 주소

export interface GenerateEstimate extends StarterEstimate {
  max_output_tokens: number;
  /** quality-tuning Q1: 이 프로젝트의 모델·깊이와 고르기 창의 목록. */
  chat_model_id?: number | null;
  depth?: DepthLevel | null;
  max_krw?: number;
  models?: BuilderModelOption[];
}

/** Builder 판 고르기 창의 모델 한 줄 — 서버가 이 프로젝트 기준으로 값을 매깁니다. */
export interface BuilderModelOption extends Omit<PickerModel, "estimate_krw"> {
  model_id: string;
  estimated_krw: number | null;
}

export function builderPickerModel(model: BuilderModelOption): PickerModel {
  return { ...model, estimate_krw: model.estimated_krw };
}

export function getGenerateEstimate(id: number | string): Promise<GenerateEstimate> {
  return request<GenerateEstimate>(`/builder/projects/${id}/generate-estimate`);
}

export interface BuilderVersion {
  number: number;
  /** 무엇이 만든 버전인지: "예시 앱", "고치기: …", "v3으로 되돌리기". */
  note: string;
  created_at: string;
  file_count: number;
  total_bytes: number;
  /** 버전 저장: 회원이 붙인 이름과 고정(30개를 넘어도 지워지지 않음). */
  label?: string;
  pinned?: boolean;
  /** CtrlAIApps에 게시된 버전. */
  published?: boolean;
  /**
   * 이 버전을 만든 만들기 / 고치기 (quality-tuning Q3 — Claude 판의 대화).
   * 되돌리기·예시 앱처럼 Claude가 만들지 않은 버전은 비어 있어요.
   */
  request?: string;
  summary?: string;
  changed_count?: number | null;
  charged_krw?: number | null;
}

/**
 * 안내 문서 (quality-tuning Q3) — 내 Claude가 읽을 글. 앱 파일과 따로 묶고,
 * 앱 주소(apps.ctrlai.my)에는 올라가지 않아요. 백엔드 builder_files.GUIDE_DOCS와 같은 목록.
 */
export const GUIDE_DOCS = ["README.md", "CLAUDE.md", "HANDOFF_PROMPT.md", "HISTORY.md", "SPEC.md"] as const;

/** 안내 문서마다 한 줄 설명. */
export const GUIDE_DOC_HINT: Record<(typeof GUIDE_DOCS)[number], string> = {
  "README.md": "앱 설명과 여는 법, 다음에 해 볼 만한 것",
  "CLAUDE.md": "Claude가 먼저 읽는 파일 구조와 규칙",
  "HANDOFF_PROMPT.md": "claude.ai에 그대로 붙여 넣을 부탁 글",
  "HISTORY.md": "버전마다 무엇을 요청했는지",
  "SPEC.md": "이 앱의 원래 기획",
};

/** 맨 위에 있는 안내 문서인지. 폴더 안의 같은 이름은 앱 파일이에요. */
export function isGuideDoc(path: string): boolean {
  return (GUIDE_DOCS as readonly string[]).includes(path);
}

export interface GenerateResult {
  files: BuilderFile[];
  /** Claude가 새로 만들거나 바꾼 파일. */
  changed: string[];
  summary: string;
  charged_krw: number;
  version: BuilderVersion;
  project: BuilderProject;
}

/** 만들기 화면의 스타일 고르기 (ctrlaiapps-publish F2). 빈 값 = 아이디어에 맞게. */
export const STYLE_CHOICES = ["깔끔한", "귀여운", "레트로", "다크", "신문", "게임"] as const;

/** 말로 만들기 / 고치기. 지원금에서 차감되고, 새 버전으로 저장됩니다. */
export function generateProject(
  id: number | string,
  requestText: string,
  style = "",
): Promise<GenerateResult> {
  return request<GenerateResult>(`/builder/projects/${id}/generate`, {
    method: "POST",
    body: JSON.stringify({ request: requestText, style }),
    timeoutMs: GENERATION_TIMEOUT_MS,
  });
}

export function listVersions(id: number | string): Promise<BuilderVersion[]> {
  return request<BuilderVersion[]>(`/builder/projects/${id}/versions`);
}

/** 이 버전 보기: 저장된 버전의 파일(읽기만, 무료). */
export function getVersionFiles(
  id: number | string,
  number: number,
): Promise<{ path: string; content: string }[]> {
  return request<{ path: string; content: string }[]>(`/builder/projects/${id}/versions/${number}/files`);
}

export interface RestoreResult {
  files: BuilderFile[];
  version: BuilderVersion;
  project: BuilderProject;
}

/** 그 버전으로 되돌립니다. 무료이고, 되돌린 것도 새 버전이 됩니다. */
export function restoreVersion(id: number | string, number: number): Promise<RestoreResult> {
  return request<RestoreResult>(`/builder/projects/${id}/versions/${number}/restore`, {
    method: "POST",
  });
}

/** 미리보기 갱신: 지금 파일을 앱 주소에 올립니다. */
export function refreshAppRuntime(id: number | string): Promise<BuilderProject> {
  return request<BuilderProject>(`/builder/projects/${id}/runtime`, { method: "POST" });
}

/** 작업 중 버전의 미리보기 주소. 앱 서버가 꺼져 있거나 아직 올린 적이 없으면 null. */
export function appUrl(project: BuilderProject, base: string | null | undefined): string | null {
  if (!base || !project.draft_slug || !project.app_runtime_at) return null;
  return `${base.replace(/\/+$/, "")}/${project.draft_slug}/`;
}

/** 게시된 버전의 주소(CtrlAIApps가 여는 곳). 게시 전이면 null. */
export function publicUrl(project: BuilderProject, base: string | null | undefined): string | null {
  if (!base || !project.app_slug || !project.published_version_number) return null;
  return `${base.replace(/\/+$/, "")}/${project.app_slug}/`;
}

export interface PublishInput {
  name?: string;
  description: string;
  note?: string;
  /** AI를 쓰는 앱의 답 — "다른 회원에게 AI 기능을 열까요?" 안 보내면 지금 설정 그대로(처음은 데모만). */
  ai_access?: AiAccess;
}

/** 게시 / 업데이트 게시: 지금 버전이 CtrlAIApps에 올라갑니다. 무료입니다. */
export function publishProject(id: number | string, input: PublishInput): Promise<BuilderProject> {
  return request<BuilderProject>(`/builder/projects/${id}/publish`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 게시 취소: CtrlAIApps와 앱 주소에서 내립니다. 버전은 모두 남습니다. */
export function unpublishProject(id: number | string): Promise<BuilderProject> {
  return request<BuilderProject>(`/builder/projects/${id}/unpublish`, { method: "POST" });
}

/** 버전 저장: 이름 붙이기, 고정하기. */
export function labelVersion(
  id: number | string,
  number: number,
  change: { label?: string; pinned?: boolean },
): Promise<BuilderVersion> {
  return request<BuilderVersion>(`/builder/projects/${id}/versions/${number}`, {
    method: "PATCH",
    body: JSON.stringify(change),
  });
}

/** 게시 창의 미리 채울 글 (publish-summary): Claude가 쓴 설명과 업데이트 메모. 둘 다 빈 글일 수 있어요. */
export interface PublishSummary {
  description: string;
  note: string;
  /** 같은 버전에 대해 전에 받은 것을 돌려줬는지. */
  cached: boolean;
  model: string;
  /** app-ai-access: 작업 중 파일이 ctrlai.ai를 부르는지 — 그럴 때만 게시 창이 공개 범위를 물어요. */
  uses_ai: boolean;
  ai_access: AiAccess;
}

/** 무료(동아리 부담) — 회원 지갑에서 나가지 않고, 실패하면 빈 글이 와요. POST: 서버가 결과를 버전에 남겨요. */
export function getPublishSummary(projectId: number | string): Promise<PublishSummary> {
  return request<PublishSummary>(`/builder/projects/${projectId}/publish-summary`, { method: "POST", body: "{}" });
}

/** 만든 앱이 할 수 있는 일, 솔직하게 (ctrlaiapps-publish F3). */
export const APP_LIMITS_NOTE =
  "만든 앱은 방문한 사람의 브라우저에서 돌아가요. 앱이 CTRL+AI 로그인·AI·공유 목록을 쓰면 보는 사람이 허용한 뒤에만 되고, AI는 쓰는 사람의 지원금에서 나가요. 자세한 건 /help/apps에 있어요.";

export function updateBuilderProject(
  id: number | string,
  changes: Partial<Pick<BuilderProject, "name" | "description" | "status" | "chat_model_id" | "depth">>,
): Promise<BuilderProject> {
  return request<BuilderProject>(`/builder/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/**
 * 맨 위에 고정 / 고정 해제 (ui-improvements). 작업을 고치는 것이 아니라 내
 * 목록을 보는 방식이라, CtrlAIApps의 ★처럼 이번 분기에 참여하지 않아도 되고
 * 마지막 수정 시각도 움직이지 않습니다.
 */
export function setBuilderPinned(id: number | string, on: boolean): Promise<BuilderProject> {
  return request<BuilderProject>(`/builder/projects/${id}/pin`, { method: "POST", body: JSON.stringify({ on }) });
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

/** 내려받을 버전: 작업 중(기본) 또는 CtrlAIApps에 게시된 버전. */
export type HandoffVersion = "draft" | "published";

/**
 * 프로젝트 내려받기(project-export-handoff): 고른 버전의 파일과 README ·
 * CLAUDE.md · HANDOFF_PROMPT · HISTORY를 담은 ZIP의 주소.
 *
 * `request`를 쓰지 않습니다. 내려오는 것이 JSON이 아니고, 브라우저가
 * 파일로 저장해 주기를 바라는 응답입니다. 그래서 이 주소로 그냥
 * 이동시키면 됩니다 — `Content-Disposition: attachment`가 붙어 있어
 * 화면은 그대로 있고 파일만 내려옵니다.
 *
 * 같은 출처이므로 세션 쿠키도 함께 갑니다. 참여하지 않는 분기에도
 * 열려 있는 길입니다 — 내가 만든 것을 꺼내 오는 일이니까요. `extra`는
 * 프롬프트의 "내가 추가하고 싶은 것: ___" 자리에 들어갑니다.
 */
export function builderProjectDownloadUrl(
  id: number | string,
  version: HandoffVersion = "draft",
  extra = "",
): string {
  const params = new URLSearchParams();
  if (version !== "draft") params.set("version", version);
  if (extra.trim()) params.set("extra", extra.trim());
  const query = params.toString();
  return `${API_BASE_URL}/api/builder/projects/${id}/download${query ? `?${query}` : ""}`;
}

export interface HandoffFile {
  path: string;
  bytes: number;
  /** CTRL+AI가 써 넣는 안내 파일(README · CLAUDE.md · HANDOFF_PROMPT · HISTORY). */
  generated: boolean;
  /** 내용 — 관리자 미리보기에서만 옵니다. */
  content: string | null;
}

export interface HandoffInfo {
  which: HandoffVersion;
  version_number: number;
  filename: string;
  draft_version_number: number;
  published_version_number: number | null;
  files: HandoffFile[];
  prompt: string;
  extra_marker: string;
  extra_label: string;
  max_extra: number;
  claude_code_first_line: string;
}

/** ZIP에 무엇이 들어가는지와 claude.ai에 붙여 넣을 프롬프트. */
export function getHandoff(id: number | string, version: HandoffVersion = "draft"): Promise<HandoffInfo> {
  return request<HandoffInfo>(`/builder/projects/${id}/handoff?version=${version}`);
}

/** 관리자: 예시 앱의 ZIP에 들어가는 파일을 내용까지 그대로. */
export function getAdminHandoffPreview(
  projectId: number,
  version: HandoffVersion = "published",
): Promise<HandoffInfo> {
  return request<HandoffInfo>(`/admin/apps/${projectId}/handoff?version=${version}`);
}

/**
 * "무엇을 더 하고 싶나요?"를 프롬프트의 빈칸에 넣습니다 — 입력하는
 * 대로 바로. 백엔드의 `project_handoff.fill_extra`와 같은 규칙입니다:
 * 비어 있으면 빈칸(___)을 그대로 두고, 빈칸이 없는 프롬프트에는 끝에
 * 한 줄을 더합니다.
 */
export function fillExtra(prompt: string, marker: string, label: string, extra: string): string {
  const text = extra.split(/\s+/).filter(Boolean).join(" ");
  if (!text) return prompt;
  const line = `${label} ${text}`;
  if (prompt.includes(marker)) return prompt.replace(marker, () => line);
  return `${prompt.replace(/\n+$/, "")}\n\n${line}\n`;
}

/* ------------------------------------------------------------------ */
/* Video Generator                                                     */
/* ------------------------------------------------------------------ */

export type VideoProjectStatus = "draft" | "generating" | "ready" | "published";

export type VideoVersionStatus = "queued" | "generating" | "ready" | "failed";

export const VIDEO_STATUS_LABEL: Record<VideoProjectStatus, string> = {
  draft: labelOf("draft"),
  generating: labelOf("generating"),
  ready: labelOf("ready"),
  published: labelOf("published"),
};

export const VIDEO_STATUS_BADGE: Record<VideoProjectStatus, string> = {
  draft: badgeClassOf("draft"),
  generating: badgeClassOf("generating"),
  ready: badgeClassOf("ready"),
  published: badgeClassOf("published"),
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
  /** 이 버전을 만든 요청이 지갑에서 뺀 금액 — 생성·수정·이어서 응답에만(feat-spend-feedback). */
  charged_krw?: number | null;
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
  /** 목록 카드의 그림: 최종본, 없으면 파일이 있는 마지막 버전. 없으면 null. */
  thumbnail_version_id?: number | null;
  thumbnail_aspect_ratio?: string | null;
  /** "image"(mock의 GIF)면 <img>, "video"(실제 MP4)면 <video>로 보여 줍니다. */
  thumbnail_kind?: "image" | "video" | null;
  /** 고정한 때 (ui-improvements). null이면 고정하지 않음. */
  pinned_at?: string | null;
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

export function listVideoProjects(filter: LibraryFilter = "all"): Promise<VideoProject[]> {
  return request<VideoProject[]>(`/video/projects${filterQuery(filter)}`);
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

/** 맨 위에 고정 / 고정 해제 — Builder의 `setBuilderPinned`와 같습니다. */
export function setVideoPinned(id: number | string, on: boolean): Promise<VideoProjectDetail> {
  return request<VideoProjectDetail>(`/video/projects/${id}/pin`, { method: "POST", body: JSON.stringify({ on }) });
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
export type ThumbnailSpace = "draft" | "published";

/**
 * 프로젝트 썸네일 주소 (ui-improvements): 작업 중 것이 있으면 그것, 없으면
 * 게시된 버전 것, 둘 다 없으면 null(카드는 표지를 그립니다). 찍은 때를
 * 뒤에 붙여 새 그림이 바로 보이게 합니다.
 */
export function builderThumbnailUrl(project: Pick<BuilderProject, "id" | "draft_thumbnail_at" | "published_thumbnail_at">): string | null {
  const space: ThumbnailSpace | null = project.draft_thumbnail_at
    ? "draft"
    : project.published_thumbnail_at
      ? "published"
      : null;
  if (!space) return null;
  const at = space === "draft" ? project.draft_thumbnail_at : project.published_thumbnail_at;
  return `${API_BASE_URL}/api/builder/projects/${project.id}/thumbnail?space=${space}&v=${encodeURIComponent(at ?? "")}`;
}

/**
 * 만든 사람의 브라우저에서 찍은 썸네일을 올립니다 — 바이트 그대로
 * (application/octet-stream; 의견 스크린샷과 같은 길). 서버가 종류와 크기를
 * 확인하고 다시 인코딩합니다.
 */
export function uploadThumbnail(id: number | string, space: ThumbnailSpace, image: Blob): Promise<BuilderProject> {
  return uploadBytes<BuilderProject>(`/builder/projects/${id}/thumbnail`, image, { space }, "썸네일을 저장하지 못했어요");
}

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

/** 영상을 만듭니다(Higgsfield, 지금은 mock). 이번 분기 지원금에서 차감됩니다.
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
  /** 지원금에서 빠진 금액(Claude 사용으로 기록됩니다). */
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

/**
 * 삭제된 작업물을 완전히 지웁니다 (ui-improvements B). 되살릴 수 없고,
 * 사유는 감사 로그에 남습니다. 사용량 기록과 지갑은 그대로입니다.
 */
export function purgeWork(kind: WorkKind, id: number, reason: string): Promise<void> {
  return request<void>(`/admin/work/${kind}/${id}/purge`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
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
