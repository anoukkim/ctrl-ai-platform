"""Signing in with Google (google-login): the provider behind GOOGLE_LOGIN_PROVIDER.

Two implementations, chosen by configuration (CLAUDE.md section 20):

* **mock** (the default) — no Google at all. The "consent screen" is a small
  page on our own backend where a developer types the identity Google would
  have returned. **It answers only in development**: on a deployed server a
  mock that lets anyone claim any Google account would be a sign-in bypass.
* **google** — the OAuth 2.0 authorization-code flow with PKCE against
  Google, for the scopes `openid email profile` only.

What both return is the same `GoogleIdentity`: Google's stable account id
(`sub`), the email, whether Google verified it, and a display name.
Nothing here ever reaches the browser except the URL to send it to.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings

#: Sign-in asks for these and nothing more — no YouTube scope here.
SIGN_IN_SCOPES = ("openid", "email", "profile")

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = {"https://accounts.google.com", "accounts.google.com"}

#: Where the mock's stand-in consent page lives (development only).
MOCK_CONSENT_PATH = "/api/auth/google/mock-consent"


class GoogleLoginError(Exception):
    """The exchange failed. The message is for the log, not the member."""


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str


def new_verifier() -> str:
    """A PKCE code verifier: 64 random URL-safe characters."""
    return secrets.token_urlsafe(48)


def challenge(verifier: str) -> str:
    """The S256 code challenge for a verifier (RFC 7636)."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class GoogleLoginProvider(Protocol):
    def authorization_url(self, state: str, code_challenge: str) -> str: ...

    def exchange(self, code: str, code_verifier: str) -> GoogleIdentity: ...


# ---------------------------------------------------------------- mock


class MockGoogleLogin:
    """Google without Google, for development and tests.

    The code the mock "consent page" hands back carries the identity the
    developer typed *and* the PKCE challenge it was issued for; `exchange`
    refuses a verifier that does not match, so the PKCE plumbing is
    exercised exactly as with the real provider.
    """

    def authorization_url(self, state: str, code_challenge: str) -> str:
        query = urllib.parse.urlencode({"state": state, "code_challenge": code_challenge})
        return f"{MOCK_CONSENT_PATH}?{query}"

    @staticmethod
    def make_code(identity: GoogleIdentity, code_challenge: str) -> str:
        payload = {
            "sub": identity.sub,
            "email": identity.email,
            "email_verified": identity.email_verified,
            "name": identity.name,
            "challenge": code_challenge,
        }
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        return "mock." + base64.urlsafe_b64encode(raw).decode("ascii")

    def exchange(self, code: str, code_verifier: str) -> GoogleIdentity:
        if not code.startswith("mock."):
            raise GoogleLoginError("not a mock code")
        try:
            payload = json.loads(base64.urlsafe_b64decode(code[5:].encode("ascii")))
        except (ValueError, json.JSONDecodeError) as error:
            raise GoogleLoginError("unreadable mock code") from error
        if payload.get("challenge") != challenge(code_verifier):
            raise GoogleLoginError("PKCE verifier does not match")
        sub = str(payload.get("sub") or "").strip()
        email = str(payload.get("email") or "").strip()
        if not sub or not email:
            raise GoogleLoginError("mock identity needs sub and email")
        return GoogleIdentity(
            sub=sub,
            email=email,
            email_verified=bool(payload.get("email_verified")),
            name=str(payload.get("name") or "").strip(),
        )


# ---------------------------------------------------------------- Google


def _decode_jwt_payload(token: str) -> dict:
    try:
        part = token.split(".")[1]
        padded = part + "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (IndexError, ValueError, json.JSONDecodeError) as error:
        raise GoogleLoginError("unreadable id_token") from error


class RealGoogleLogin:
    """The authorization-code flow with PKCE, as a confidential client.

    The ID token comes straight from Google's token endpoint over TLS, in
    exchange for the client secret, so — as OpenID Connect Core 3.1.3.7
    allows — its issuer is established by that TLS connection rather than
    by checking the token's signature. `iss`, `aud` and `exp` are still
    checked. Not exercised against Google in the test suite (no network,
    no client): `transport` lets the tests hand in Google's response.
    """

    def __init__(self, settings: Settings, transport=None) -> None:
        self.client_id = settings.google_client_id.strip()
        self.client_secret = settings.google_client_secret.strip()
        self.redirect_uri = settings.google_redirect_uri.strip()
        self._transport = transport or self._post

    def authorization_url(self, state: str, code_challenge: str) -> str:
        query = urllib.parse.urlencode(
            {
                "client_id": self.client_id,
                "redirect_uri": self.redirect_uri,
                "response_type": "code",
                "scope": " ".join(SIGN_IN_SCOPES),
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "prompt": "select_account",
            }
        )
        return f"{AUTHORIZE_URL}?{query}"

    @staticmethod
    def _post(url: str, form: dict[str, str]) -> dict:
        data = urllib.parse.urlencode(form).encode("ascii")
        request = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            # Google's error body names the problem; it never contains the
            # client secret, but it is still only logged by the caller.
            raise GoogleLoginError(f"token endpoint answered {error.code}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise GoogleLoginError("token endpoint unreachable") from error

    def exchange(self, code: str, code_verifier: str) -> GoogleIdentity:
        answer = self._transport(
            TOKEN_URL,
            {
                "code": code,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "redirect_uri": self.redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
        )
        id_token = answer.get("id_token")
        if not id_token:
            raise GoogleLoginError("no id_token in the token response")
        claims = _decode_jwt_payload(id_token)
        if claims.get("iss") not in ISSUERS:
            raise GoogleLoginError("unexpected issuer")
        audience = claims.get("aud")
        audiences = audience if isinstance(audience, list) else [audience]
        if self.client_id not in audiences:
            raise GoogleLoginError("id_token is for another client")
        import time

        if int(claims.get("exp") or 0) < time.time():
            raise GoogleLoginError("id_token expired")
        sub = str(claims.get("sub") or "")
        email = str(claims.get("email") or "")
        if not sub or not email:
            raise GoogleLoginError("id_token without sub or email")
        verified = claims.get("email_verified")
        return GoogleIdentity(
            sub=sub,
            email=email,
            email_verified=verified is True or verified == "true",
            name=str(claims.get("name") or ""),
        )


def google_login_available(settings: Settings) -> bool:
    """Whether "Google로 계속하기" is offered here.

    Real Google: always. The mock: in development only — anywhere else it
    would let a visitor claim any Google account.
    """
    mode = settings.google_login_provider.strip().lower()
    if mode == "google":
        return True
    return mode == "mock" and settings.is_development


def get_google_login(settings: Settings) -> GoogleLoginProvider | None:
    """The provider, or None where Google sign-in is not offered."""
    if not google_login_available(settings):
        return None
    if settings.google_login_provider.strip().lower() == "google":
        return RealGoogleLogin(settings)
    return MockGoogleLogin()
