"""Rules that apply to a piece of member work whichever product it is in.

Right now that is one rule — what a project may be called — and it lives
here rather than on the two schemas because Builder and Video must not be
able to disagree about it. A member renaming a video and renaming a
project should get the same limit and the same sentence back.
"""

#: How long a name may be, after trimming. Short on purpose: these names
#: appear in a sidebar, a switcher menu and a card, and a name that only
#: fits in one of them is not a name the member can use.
NAME_MAX_LENGTH = 60


class InvalidNameError(ValueError):
    """A name a member cannot have. Carries the Korean sentence to show them.

    A `ValueError` subclass rather than an `HTTPException`: the services
    layer states the rule, and the route decides what HTTP status says it.
    That is also what keeps the message a plain string — FastAPI's own
    validation errors arrive as a list, which the frontend cannot show.
    """


def clean_name(raw: str) -> str:
    """Trim a project or video name and check it, or raise `InvalidNameError`.

    Trimming before the length check is the whole point: "  " is an empty
    name, not a two-character one, and a name saved with trailing spaces
    looks misaligned everywhere it is listed.

    Duplicates are allowed. Two projects called 가계부 are a mild
    annoyance the member can fix; refusing the save is worse, and there is
    no technical reason for uniqueness — nothing is addressed by name.
    """
    name = raw.strip()

    if not name:
        raise InvalidNameError("이름을 입력해 주세요.")
    if len(name) > NAME_MAX_LENGTH:
        raise InvalidNameError(f"이름은 {NAME_MAX_LENGTH}자까지 쓸 수 있습니다.")

    return name
