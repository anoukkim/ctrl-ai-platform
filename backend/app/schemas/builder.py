"""Project Builder API schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.builder import BuilderProjectStatus
from app.schemas.chat import DepthOption


class BuilderProjectBase(BaseModel):
    # No length rule here on purpose. `app/services/work.clean_name` is the
    # single authority on what a name may be, because it is the only place
    # that can answer in Korean — a pydantic failure arrives as a list under
    # `detail`, and the frontend only renders a string.
    name: str
    description: str = Field(default="", max_length=2000)


class BuilderProjectCreate(BuilderProjectBase):
    """What the client sends to start a project.

    The owner is never taken from the request body — it comes from the
    authenticated member, so one member cannot create a project in
    another's name.
    """


class BuilderProjectFromChat(BuilderProjectBase):
    """Builder로 보내기 (chat-plus-artifacts): a chat reply's HTML block
    becomes a new project's `index.html`. No Claude call, no charge."""

    html: str = Field(min_length=1)


class BuilderProjectFromTemplate(BaseModel):
    """A new project from one of the start screen's templates
    (app-platform P4). No Claude call, no charge."""

    template: str
    #: The project's name; the template's own when left out.
    name: str = ""


class BuilderTemplateRead(BaseModel):
    key: str
    name: str
    description: str
    uses: list[str]


class BuilderProjectUpdate(BaseModel):
    """Every field optional: this is a PATCH."""

    name: str | None = None
    description: str | None = Field(default=None, max_length=2000)
    status: BuilderProjectStatus | None = None
    #: quality-tuning Q1: the panel's model and 생각 깊이, remembered per
    #: project. A level name only — the server decides every number.
    chat_model_id: int | None = None
    depth: Literal["low", "medium", "high", "max"] | None = None


class BuilderProjectRead(BuilderProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: BuilderProjectStatus
    github_repo: str | None
    #: builder-static-runtime: the app's folder on the apps origin, and when
    #: its files were last written there. The address is
    #: `<apps_base_url>/<app_slug>/` (`/api/site` gives the base); while
    #: `app_runtime_at` is empty, nothing is served yet.
    app_slug: str | None = None
    app_runtime_at: datetime | None = None
    #: ctrlaiapps-publish: the working copy's preview folder, and what is
    #: published — "게시됨 v3 · 작업 중 v5".
    draft_slug: str | None = None
    published_version_number: int | None = None
    published_at: datetime | None = None
    publish_note: str = ""
    #: quality-tuning Q1: the panel's remembered model and 생각 깊이.
    chat_model_id: int | None = None
    depth: str | None = None
    created_at: datetime
    updated_at: datetime


class BuilderFileRead(BaseModel):
    """One file of a project, as the workspace shows it (read-only for now)."""

    model_config = ConfigDict(from_attributes=True)

    path: str
    content: str
    updated_at: datetime


class StarterRequest(BaseModel):
    """What the member wants. Empty means the project's description."""

    idea: str = Field(default="", max_length=2000)


class StarterRead(BaseModel):
    files: list[BuilderFileRead]
    #: Two Korean sentences from Claude: what it made, and what to ask next.
    summary: str
    charged_krw: int


class StarterEstimateRead(BaseModel):
    """Shown next to 예시 앱 만들기 before anything is spent."""

    estimated_krw: int
    #: What the wallet must hold: the whole output budget, priced.
    worst_case_krw: int
    model_label: str
    #: quality-tuning Q1: the depth it runs at (None: the model has none)
    #: and that depth's per-call cap.
    depth: str | None = None
    max_krw: int = 0


class BuilderModelOption(BaseModel):
    """One model in the Builder panel's picker (quality-tuning Q1)."""

    id: int
    model_id: str
    label: str
    description: str
    admin_only: bool
    is_default: bool
    #: "1회 약 N원" at 보통 for this project. None without a rate.
    estimated_krw: int | None
    levels: list[DepthOption] = []
    #: The cap a model without depths runs under.
    flat_max_krw: int = 0
    depth_note: str = ""


# ------------------------------------------------ builder-static-runtime


class GenerateRequest(BaseModel):
    """만들기 / 고치기: what the member wants, in their words."""

    request: str = Field(min_length=1, max_length=2000)
    #: 스타일 (ctrlaiapps-publish F2): a chosen look — "깔끔한", "귀여운",
    #: "레트로", "다크", "신문", "게임" — or the member's own words. Empty =
    #: 아이디어에 맞게.
    style: str = Field(default="", max_length=100)


class EditEstimateRead(BaseModel):
    """Shown next to 만들기 before anything is spent."""

    estimated_krw: int
    #: What the wallet must hold: the whole output budget, priced.
    worst_case_krw: int
    model_label: str
    max_output_tokens: int
    #: quality-tuning Q1: what this project runs at, and the picker's list.
    chat_model_id: int | None = None
    depth: str | None = None
    max_krw: int = 0
    models: list[BuilderModelOption] = []


class VersionRead(BaseModel):
    number: int
    note: str
    created_at: datetime
    file_count: int
    total_bytes: int
    #: 버전 저장 (ctrlaiapps-publish).
    label: str = ""
    pinned: bool = False
    #: The version CtrlAIApps serves.
    published: bool = False
    #: 만들기 / 고치기 that made it (quality-tuning Q3, the Claude panel's
    #: history): the member's request, Claude's summary, how many files it
    #: wrote, and what it cost in all. Empty / None for versions made
    #: otherwise (되돌리기, 예시 앱, the generation row gone).
    request: str = ""
    summary: str = ""
    changed_count: int | None = None
    charged_krw: int | None = None


class VersionFileRead(BaseModel):
    """One file as it was in a saved version (이 버전 보기, quality-tuning Q3)."""

    path: str
    content: str


class VersionLabel(BaseModel):
    """버전 저장: a name, a pin, or both. Omitted fields stay as they are."""

    label: str | None = Field(default=None, max_length=80)
    pinned: bool | None = None


class PublishRequest(BaseModel):
    """게시 / 업데이트 게시. The name goes through `clean_name` like a rename."""

    name: str | None = None
    description: str = Field(min_length=1, max_length=2000)
    #: 업데이트 메모 — one optional line on the listing.
    note: str = Field(default="", max_length=200)


class GenerateRead(BaseModel):
    files: list[BuilderFileRead]
    #: Paths Claude created or changed, in the order it wrote them.
    changed: list[str]
    summary: str
    charged_krw: int
    version: VersionRead
    project: BuilderProjectRead


class RestoreRead(BaseModel):
    files: list[BuilderFileRead]
    version: VersionRead
    project: BuilderProjectRead


class HandoffFile(BaseModel):
    """One entry of the ZIP (project-export-handoff)."""

    path: str
    bytes: int
    #: True for README / CLAUDE / HANDOFF_PROMPT / HISTORY written by CTRL+AI.
    generated: bool
    #: The text itself — only on the admin preview.
    content: str | None = None


class HandoffRead(BaseModel):
    """What 프로젝트 내려받기 / 내 Claude로 이어서 만들기 will hand over."""

    which: str
    version_number: int
    filename: str
    draft_version_number: int
    published_version_number: int | None
    files: list[HandoffFile]
    #: The claude.ai prompt, with "내가 추가하고 싶은 것: ___" (or the request filled in).
    prompt: str
    #: The blank the panel fills live as the member types.
    extra_marker: str
    extra_label: str
    max_extra: int
    claude_code_first_line: str


# ------------------------------------------------ quality-tuning Q2


class PlanRequest(BaseModel):
    """만들기 / 고치기, stage 1. `who`, `features` and `mood` are the guided
    start form's answers (all optional — 건너뛰기 leaves them empty)."""

    request: str = Field(min_length=1, max_length=2000)
    style: str = Field(default="", max_length=100)
    who: str = Field(default="", max_length=200)
    features: str = Field(default="", max_length=600)
    mood: str = Field(default="", max_length=200)


class PlanStep(BaseModel):
    path: str
    #: One Korean sentence: what the file is for.
    purpose: str


class GenerationRead(BaseModel):
    """One staged generation: its plan, how far it got, what it cost."""

    id: int
    kind: str
    request: str
    style: str
    summary: str
    plan: list[PlanStep]
    files_done: list[str]
    #: planned · running · partial · failed · done · cancelled
    status: str
    check_summary: str
    check_fixed: list[str]
    charged_krw: int
    #: The last failure, in Korean. Empty when none.
    error: str
    version_number: int | None = None
    created_at: datetime
    #: "약 N원" for the rest of the run and "최대 M원" per call — shown by
    #: 시작 and 이어서 만들기. None when the run is over.
    estimated_krw: int | None = None
    max_call_krw: int | None = None


class GenerationRun(BaseModel):
    """시작 / 이어서 만들기 — no fields; a JSON body like every write."""

