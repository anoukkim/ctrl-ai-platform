"""Database models.

Importing every model here registers it on `Base.metadata`, which is what
Alembic's autogenerate and the test fixtures read. A model that is not
imported here is invisible to both.
"""

from app.models.builder import BuilderProject, BuilderProjectStatus
from app.models.season import (
    CreditAllocation,
    MembershipStatus,
    Season,
    SeasonMembership,
    SeasonStatus,
)
from app.models.user import User, UserRole
from app.models.video import (
    VideoModel,
    VideoProject,
    VideoProjectStatus,
    VideoVersion,
    VideoVersionStatus,
)

__all__ = [
    "BuilderProject",
    "BuilderProjectStatus",
    "CreditAllocation",
    "MembershipStatus",
    "Season",
    "SeasonMembership",
    "SeasonStatus",
    "User",
    "UserRole",
    "VideoModel",
    "VideoProject",
    "VideoProjectStatus",
    "VideoVersion",
    "VideoVersionStatus",
]
