"""Database models.

Importing every model here registers it on `Base.metadata`, which is what
Alembic's autogenerate and the test fixtures read. A model that is not
imported here is invisible to both.
"""

from app.models.builder import BuilderProject, BuilderProjectStatus
from app.models.quarter import (
    ApplicationStatus,
    BudgetCategory,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    QuarterStatus,
)
from app.models.usage import FundingSource, UsageEvent
from app.models.session import UserSession
from app.models.user import AccountStatus, User, UserRole
from app.models.video import (
    VideoModel,
    VideoProject,
    VideoProjectStatus,
    VideoVersion,
    VideoVersionStatus,
)
from app.models.wallet import PersonalBalance, PersonalTopUp, TopUpStatus

__all__ = [
    "ApplicationStatus",
    "BudgetCategory",
    "BuilderProject",
    "BuilderProjectStatus",
    "FundingSource",
    "PersonalBalance",
    "PersonalTopUp",
    "Quarter",
    "QuarterAllocation",
    "QuarterApplication",
    "QuarterStatus",
    "TopUpStatus",
    "UsageEvent",
    "AccountStatus",
    "User",
    "UserRole",
    "UserSession",
    "VideoModel",
    "VideoProject",
    "VideoProjectStatus",
    "VideoVersion",
    "VideoVersionStatus",
]
