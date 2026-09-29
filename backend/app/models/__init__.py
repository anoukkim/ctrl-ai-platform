"""Database models.

Importing the models here ensures they are registered on
`Base.metadata` whenever `app.models` is imported.
"""

from app.models.user import User, UserRole

__all__ = ["User", "UserRole"]
