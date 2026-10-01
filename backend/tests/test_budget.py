"""The quarterly budget split.

These are the exact cases from the product spec. The percentage-to-KRW
rule lives in one place so the API, the UI and these tests cannot drift.
"""

import pytest

from app.services.budget import InvalidSplitError, split_budget

LIMIT = 100_000


@pytest.mark.parametrize(
    ("build", "video", "expected_build", "expected_video"),
    [
        (100, 0, 100_000, 0),
        (70, 30, 70_000, 30_000),
        (50, 50, 50_000, 50_000),
        (20, 80, 20_000, 80_000),
        (0, 100, 0, 100_000),
    ],
)
def test_split_matches_the_specified_amounts(
    build: int, video: int, expected_build: int, expected_video: int
) -> None:
    result = split_budget(build, video, LIMIT)

    assert result.build_budget_krw == expected_build
    assert result.video_budget_krw == expected_video


@pytest.mark.parametrize(("build", "video"), [(70, 20), (60, 60), (0, 0), (100, 1), (50, 49)])
def test_a_split_that_is_not_100_percent_is_rejected(build: int, video: int) -> None:
    with pytest.raises(InvalidSplitError):
        split_budget(build, video, LIMIT)


def test_negative_percentages_are_rejected() -> None:
    with pytest.raises(InvalidSplitError):
        split_budget(-10, 110, LIMIT)


def test_the_two_budgets_always_sum_to_the_total() -> None:
    """Rounding must not create or lose a won.

    33/67 of 100,000 does not divide evenly, so this is where an
    off-by-one would show up.
    """
    for build in range(0, 101):
        result = split_budget(build, 100 - build, LIMIT)
        assert result.build_budget_krw + result.video_budget_krw == LIMIT


def test_the_limit_is_not_hard_coded() -> None:
    """A different quarter may carry a different limit."""
    result = split_budget(70, 30, 50_000)

    assert result.build_budget_krw == 35_000
    assert result.video_budget_krw == 15_000
