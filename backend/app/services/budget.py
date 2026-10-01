"""Quarterly budget arithmetic.

One place owns the percentage-to-KRW rule, so the frontend, the API and
the tests can never disagree about what 70/30 means.

Money is the source of truth. Nothing here converts KRW into tokens or
generations: provider prices change, and an approved allocation must not
move when they do.
"""

from dataclasses import dataclass

#: Percentages must add up to exactly this.
TOTAL_PERCENTAGE = 100


class InvalidSplitError(ValueError):
    """Raised when a Build/Video split does not add up to 100."""


@dataclass(frozen=True)
class BudgetSplit:
    """A validated split, with the KRW amounts already worked out."""

    build_percentage: int
    video_percentage: int
    total_budget_krw: int
    build_budget_krw: int
    video_budget_krw: int


def split_budget(
    build_percentage: int,
    video_percentage: int,
    total_budget_krw: int,
) -> BudgetSplit:
    """Turn a percentage split into KRW amounts.

    Rejects anything that does not add up to 100, and any negative part.

        >>> split_budget(70, 30, 100_000).build_budget_krw
        70000

    The Build side is rounded down and Video takes the remainder, so the
    two always sum to exactly the total — no won is created or lost by
    rounding, which would otherwise show up as an off-by-one in the UI.
    """
    if build_percentage < 0 or video_percentage < 0:
        raise InvalidSplitError("퍼센트는 0보다 작을 수 없습니다.")

    if build_percentage + video_percentage != TOTAL_PERCENTAGE:
        raise InvalidSplitError(
            f"Build와 Video의 합은 {TOTAL_PERCENTAGE}%여야 합니다. "
            f"지금은 {build_percentage + video_percentage}%입니다."
        )

    if total_budget_krw < 0:
        raise InvalidSplitError("지원 한도는 0보다 작을 수 없습니다.")

    build_budget_krw = total_budget_krw * build_percentage // TOTAL_PERCENTAGE
    video_budget_krw = total_budget_krw - build_budget_krw

    return BudgetSplit(
        build_percentage=build_percentage,
        video_percentage=video_percentage,
        total_budget_krw=total_budget_krw,
        build_budget_krw=build_budget_krw,
        video_budget_krw=video_budget_krw,
    )
