"""app-ai-access — how an app's AI is opened to other members.

The owner's decision (2026-10-16): when a maker publishes an app that uses
AI, they choose **데모만** or **전체 기능** (changeable later, from the 게시
dialog or the Builder's 게시 menu); visitors can switch themselves to 데모
at any time (the shell's switch); the 관리자 turns AI off with the existing
기능 상자 멈추기. 데모 means **no AI call and 0원**: the server refuses the
call with code "demo", and the app shows its demo answer — the Builder's
Claude writes a demo path for every AI feature (P4), and the SDK docs name
the code.

Where it is enforced: `/_ctrlai/v1/ai/ask` and `/stream` (the only paid
calls) — in mode "app" only. The maker's own 미리보기 is never limited:
they pay themselves, and they need to try the real thing. The visitor's
own 데모 switch lives in the shell (our code, not the app's), which then
never sends the call.

How "this app uses AI" is known: the files are searched for `ctrlai.ai.`
when a version is written (`builder_versions.snapshot`), stored on the
version (`uses_ai`), so the dialog, the listing and the shell read a flag.
The default for a newly published AI app is 데모만 — the safest: nothing
is spent from anyone's wallet until the maker opens it on purpose.
"""

from __future__ import annotations

import re

#: The two settings, as stored on `builder_projects.ai_access`.
DEMO = "demo"
FULL = "full"
AI_ACCESS = (DEMO, FULL)

#: Korean, for the maker's dialog and the admin's screen.
LABEL = {DEMO: "데모만", FULL: "전체 기능"}

#: What a refused visitor call says — the SDK error's message; its code is "demo".
DEMO_ONLY = "이 앱의 AI는 데모로만 열려 있어요. 데모 답변을 보여 드려요."
DEMO_CODE = "demo"

#: `ctrlai.ai.ask(`, `sdk.ai.ask(` through an alias of `window.ctrlai`, a
#: destructured `ai.ask(`, `ctrlai["ai"].ask(`, or a reference taken
#: (`const ask = ctrlai.ai.ask`) — in a file that names `ctrlai` at all
#: (so `openai.ai.ask` in a file without it does not count). A call built
#: by hand is still missed; the flag is advisory (the dialog's question,
#: the listing's note, the shell's bar) — the enforcement is `ai_access`
#: alone, on the server, whatever the files say, and the maker's switch
#: and the shell's bar never depend on the flag alone.
_USES_AI = re.compile(r"""(?:\bai\b|ai["']\])\s*\.\s*(ask|stream|estimate)\b""")
_NAMES_SDK = re.compile(r"\bctrlai\b")

#: Only text an app runs or shows — never the SDK's own comments in a
#: README that merely mentions the call.
_CODE_SUFFIXES = (".html", ".htm", ".js", ".mjs", ".ts", ".jsx", ".tsx", ".vue", ".svelte")


def uses_ai(files: dict[str, str] | list) -> bool:
    """Whether any page or script of the app calls `ctrlai.ai`."""
    pairs = files.items() if isinstance(files, dict) else ((p, c) for p, c in files)
    return any(
        str(path).lower().endswith(_CODE_SUFFIXES)
        and _NAMES_SDK.search(str(content)) is not None
        and _USES_AI.search(str(content)) is not None
        for path, content in pairs
    )


def checked(value: str | None) -> str | None:
    """A setting from a request: "demo", "full" or None (keep)."""
    if value is None:
        return None
    if value not in AI_ACCESS:
        raise ValueError("AI 공개 범위는 '데모만'(demo) 또는 '전체 기능'(full)이어야 해요.")
    return value
