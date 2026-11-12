"""Verify Keycloak access tokens; only the configured issuer is trusted."""
import logging
from functools import lru_cache

import jwt
from sqlalchemy import select

from app.config import config
from app.database import SessionLocal
from app.models import User, UserIdentity

logger = logging.getLogger(__name__)


@lru_cache(maxsize=4)
def _jwks_client(url: str):
    return jwt.PyJWKClient(url, cache_jwk_set=True, lifespan=300, timeout=5)


def verify_oidc_claims(token: str):
    if config.AUTH_MODE != "oidc" or not config.OIDC_ISSUER_URL or not config.OIDC_CLIENT_ID:
        return None
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            return None
        url = config.OIDC_JWKS_URL or config.OIDC_ISSUER_URL + "/protocol/openid-connect/certs"
        key = _jwks_client(url).get_signing_key_from_jwt(token)
        decoded = jwt.decode(
            token, key.key, algorithms=["RS256"], audience=config.OIDC_CLIENT_ID,
            issuer=config.OIDC_ISSUER_URL,
            options={"require": ["exp", "iat", "iss", "sub", "aud"]},
            leeway=15,
        )
    except (jwt.PyJWTError, ValueError, TypeError) as error:
        missing = error.claim if isinstance(error, jwt.MissingRequiredClaimError) else ""
        logger.warning("OIDC access token rejected (%s %s)", type(error).__name__, missing)
        return None
    # Accept an access token for THIS public client, never an ID token or a
    # token acquired by some other client in the same realm.
    email = decoded.get("email")
    subject = decoded.get("sub")
    if (decoded.get("typ") != "Bearer" or decoded.get("azp") != config.OIDC_CLIENT_ID
            or decoded.get("email_verified") is not True
            or not isinstance(subject, str) or not subject.strip()
            or not isinstance(email, str) or "@" not in email):
        return None
    claims = {
        "provider": "oidc", "oidc_issuer": config.OIDC_ISSUER_URL,
        "oidc_sub": subject, "email": email.strip().lower(),
        "email_verified": True, "display_name": decoded.get("name"),
    }
    # Legacy authorization paths resolve an email without calling access.py.
    # They must use the same canonical account as the issuer+sub binding even
    # after an administrator changes the address at the identity provider.
    with SessionLocal() as db:
        bound_email = db.execute(
            select(User.email).join(UserIdentity, UserIdentity.user_id == User.id).where(
                UserIdentity.issuer == claims["oidc_issuer"], UserIdentity.subject == subject,
            )
        ).scalar_one_or_none()
        if not bound_email:
            other_subject = db.execute(
                select(UserIdentity.subject).join(User, User.id == UserIdentity.user_id).where(
                    UserIdentity.issuer == claims["oidc_issuer"], User.email == claims["email"],
                )
            ).scalar_one_or_none()
            if other_subject is not None:
                return None
    if bound_email:
        claims["email"] = bound_email
    return claims
