"""Database models.

Importing every model here registers it on `Base.metadata`, which is what
Alembic's autogenerate and the test fixtures read. A model that is not
imported here is invisible to both.
"""

from app.models.app_discussion import AppComment, AppCommentReport, AppReaction
from app.models.app_platform import (
    AppConsent,
    AppDataCollection,
    AppDataItem,
    AppDataWrite,
    AppLoginCode,
    AppSession,
)
from app.models.accounting import AdjustmentKind, CreditPurchase, WalletAdjustment
from app.models.audit import AUDIT_ACTION_LABEL, AuditAction, AuditLog
from app.models.connected_account import ConnectedAccount, OAuthState, PendingGoogleSignup
from app.models.chat import (
    AttachmentKind,
    ChatAction,
    ChatAttachment,
    ChatMessage,
    ChatMessageStatus,
    ChatRole,
    ChatRun,
    Conversation,
)
from app.models.feedback import (
    FEEDBACK_MAX_LENGTH,
    FEEDBACK_PER_HOUR,
    Feedback,
    FeedbackImage,
)
from app.models.builder import (
    AppFavorite,
    AppReport,
    BuilderEvalReport,
    BuilderGeneration,
    BuilderReference,
    BuilderAsset,
    BuilderProject,
    BuilderProjectFile,
    BuilderProjectStatus,
    BuilderProjectStep,
    BuilderProjectVersion,
)
from app.models.tube import TubeComment, TubeReaction, TubeReport, TubeVideo
from app.models.provider import (
    PROVIDER_ERROR_LABEL,
    ProviderErrorKind,
    ProviderStatus,
)
from app.models.invite import InviteCode, InviteStatus
from app.models.feature_switch import FeatureSwitch
from app.models.pricing import ChatLimits, ChatModel, ChatModelVisibility, ExchangeRate, FxStatus
from app.models.quarter import (
    ApplicationStatus,
    Quarter,
    QuarterAllocation,
    QuarterApplication,
    QuarterStatus,
)
from app.models.usage import FundingSource, UsageEvent, UsageFeature
from app.models.milestone import SpendMilestone
from app.models.notification import Notification
from app.models.membership import MembershipStatus, QuarterMembership
from app.models.session import UserSession
from app.models.signup_attempt import LoginAttempt, SignupAttempt
from app.models.user import AccountStatus, User, UserRole
from app.models.video import (
    VIDEO_VERSION_KIND_LABEL,
    VideoModel,
    VideoProject,
    VideoProjectStatus,
    VideoVersion,
    VideoVersionKind,
    VideoVersionStatus,
)
from app.models.wallet import PersonalBalance, PersonalTopUp, TopUpStatus
from app.models.withdrawal import (
    GRACE_PERIOD_DAYS,
    AccountWithdrawal,
    PublishedWorkChoice,
    RefundStatus,
)

__all__ = [
    "ChatRun",
    "AppComment",
    "AppCommentReport",
    "AppReaction",
    "AppConsent",
    "AppDataCollection",
    "AppDataItem",
    "AppDataWrite",
    "AppLoginCode",
    "AppSession",
    "SpendMilestone",
    "Notification",
    "AdjustmentKind",
    "CreditPurchase",
    "WalletAdjustment",
    "ChatAction",
    "ChatMessage",
    "ChatAttachment",
    "AttachmentKind",
    "ChatMessageStatus",
    "ChatRole",
    "ChatModel",
    "ChatModelVisibility",
    "Conversation",
    "InviteCode",
    "InviteStatus",
    "ChatLimits",
    "FeatureSwitch",
    "ExchangeRate",
    "FxStatus",
    "AccountWithdrawal",
    "GRACE_PERIOD_DAYS",
    "PublishedWorkChoice",
    "RefundStatus",
    "ApplicationStatus",
    "AppReport",
    "TubeComment",
    "TubeReaction",
    "TubeReport",
    "TubeVideo",
    "BuilderProject",
    "BuilderProjectFile",
    "BuilderProjectStatus",
    "BuilderProjectStep",
    "BuilderProjectVersion",
    "BuilderGeneration",
    "BuilderReference",
    "BuilderAsset",
    "BuilderEvalReport",
    "FEEDBACK_MAX_LENGTH",
    "FEEDBACK_PER_HOUR",
    "Feedback",
    "FeedbackImage",
    "FundingSource",
    "MembershipStatus",
    "PersonalBalance",
    "PersonalTopUp",
    "PROVIDER_ERROR_LABEL",
    "ProviderErrorKind",
    "ProviderStatus",
    "Quarter",
    "QuarterAllocation",
    "QuarterApplication",
    "QuarterMembership",
    "QuarterStatus",
    "TopUpStatus",
    "UsageEvent",
    "UsageFeature",
    "AUDIT_ACTION_LABEL",
    "AccountStatus",
    "AuditAction",
    "AuditLog",
    "ConnectedAccount",
    "OAuthState",
    "PendingGoogleSignup",
    "SignupAttempt",
    "LoginAttempt",
    "User",
    "UserRole",
    "UserSession",
    "VideoModel",
    "VideoProject",
    "VideoProjectStatus",
    "VIDEO_VERSION_KIND_LABEL",
    "VideoVersion",
    "VideoVersionKind",
    "VideoVersionStatus",
]
