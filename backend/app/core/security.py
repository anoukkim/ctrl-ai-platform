"""Password hashing and session tokens.

Two rules this module exists to enforce:

1. A plaintext password is never stored, logged, or returned. Only the
   Argon2 hash reaches the database.
2. A session token is random, not derived from the user. Nothing about
   the member can be read out of a stolen cookie, and revoking a session
   is a row delete.

Argon2id is the current password-hashing recommendation; `argon2-cffi`
ships sensible parameters, so they are deliberately not tuned here.
"""

import secrets

from argon2 import PasswordHasher
from argon2.exceptions import (
    HashingError,
    InvalidHashError,
    VerificationError,
    VerifyMismatchError,
)

_hasher = PasswordHasher()

# Stored instead of a hash when an account cannot be logged into with a
# password — rows that existed before Phase 1a, for instance. It is not a
# valid Argon2 hash, so `verify_password` always rejects it. Django uses
# the same "!" convention.
UNUSABLE_PASSWORD_HASH = "!"

# Short enough to be typed, long enough not to be guessed. Checked on
# registration; the frontend states it in Korean before the request.
MIN_PASSWORD_LENGTH = 8


def hash_password(raw_password: str) -> str:
    """Return the Argon2 hash of a password."""
    return _hasher.hash(raw_password)


def verify_password(raw_password: str, stored_hash: str) -> bool:
    """Check a password against a stored hash.

    Returns False rather than raising for every failure mode — a wrong
    password, a malformed hash, or the unusable-password sentinel — so a
    caller cannot accidentally distinguish "no such account" from "wrong
    password" by catching different exceptions.
    """
    if not stored_hash or stored_hash == UNUSABLE_PASSWORD_HASH:
        return False
    try:
        return _hasher.verify(stored_hash, raw_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError, HashingError):
        return False


def new_session_token() -> str:
    """A fresh, unguessable session token."""
    return secrets.token_urlsafe(32)
