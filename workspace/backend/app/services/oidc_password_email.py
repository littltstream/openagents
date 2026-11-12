"""Send a short-lived Keycloak password-action email for one verified subject."""
import logging
from urllib.parse import quote

import requests

from app.config import config

logger = logging.getLogger(__name__)
PASSWORD_LINK_SECONDS = 900


class PasswordEmailUnavailable(RuntimeError):
    pass


class PasswordEmailDenied(RuntimeError):
    pass


def send_password_reset_email(subject: str) -> None:
    if (not config.OIDC_PASSWORD_EMAIL_ENABLED or not config.OIDC_ADMIN_REALM_URL
            or not config.OIDC_MAILER_CLIENT_SECRET or not config.OIDC_PASSWORD_RESET_REDIRECT_URI):
        raise PasswordEmailUnavailable('Password reset email is not configured on this server')
    base, separator, realm = config.OIDC_ADMIN_REALM_URL.rpartition('/realms/')
    if not separator or not realm or '/' in realm:
        raise PasswordEmailUnavailable('Password reset email configuration is invalid')
    user_url = base + '/admin/realms/' + quote(realm, safe='') + '/users/' + quote(subject, safe='')
    try:
        with requests.Session() as session:
            session.trust_env = False
            token = session.post(config.OIDC_ADMIN_REALM_URL + '/protocol/openid-connect/token', data={
                'grant_type': 'client_credentials', 'client_id': config.OIDC_MAILER_CLIENT_ID,
                'client_secret': config.OIDC_MAILER_CLIENT_SECRET,
            }, timeout=15)
            token.raise_for_status()
            access_token = token.json().get('access_token')
            if not access_token:
                raise PasswordEmailUnavailable('The password email service could not authenticate')
            session.headers['Authorization'] = 'Bearer ' + access_token
            user = session.get(user_url, timeout=15)
            user.raise_for_status()
            profile = user.json()
            if not profile.get('enabled') or profile.get('emailVerified') is not True or not profile.get('email'):
                raise PasswordEmailDenied('Verify your current email address before requesting a password reset')
            sent = session.put(user_url + '/execute-actions-email', json=['UPDATE_PASSWORD'], params={
                'client_id': config.OIDC_CLIENT_ID, 'lifespan': PASSWORD_LINK_SECONDS,
                'redirect_uri': config.OIDC_PASSWORD_RESET_REDIRECT_URI,
            }, timeout=20)
            sent.raise_for_status()
            if sent.status_code != 204:
                raise PasswordEmailUnavailable('The password reset email was not accepted')
    except requests.RequestException as error:
        # Provider errors may contain private credentials or action links.
        logger.warning('Password email request failed (%s)', type(error).__name__)
        raise PasswordEmailUnavailable('Password reset email could not be sent. Please try again later.') from None
