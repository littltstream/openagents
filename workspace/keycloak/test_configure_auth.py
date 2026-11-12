"""Invalid mail/transport settings must not enable public registration."""
import json
import os
from types import SimpleNamespace

import pytest

from configure_auth import configure, load_smtp, private_text


def settings_file(tmp_path, values):
    path = tmp_path / 'smtp.json'
    path.write_text(json.dumps(values), encoding='utf-8')
    path.chmod(0o600)
    return path


def smtp_settings():
    return {'host': 'smtp.example.test', 'port': '465', 'from': 'mail@example.test',
            'user': 'mail@example.test', 'password': 'test-only-authorization',
            'auth': 'true', 'ssl': 'true', 'starttls': 'false'}


@pytest.mark.parametrize('field', ['host', 'port', 'from', 'user', 'password'])
def test_missing_mail_credentials_cannot_enable_registration(tmp_path, field):
    smtp = smtp_settings()
    smtp[field] = ''
    with pytest.raises(ValueError, match='required'):
        load_smtp(settings_file(tmp_path, smtp))


@pytest.mark.parametrize('ssl_enabled,starttls', [('false', 'false'), ('true', 'true')])
def test_smtp_requires_one_tls_mode(tmp_path, ssl_enabled, starttls):
    smtp = {**smtp_settings(), 'ssl': ssl_enabled, 'starttls': starttls}
    with pytest.raises(ValueError, match='exactly one'):
        load_smtp(settings_file(tmp_path, smtp))


def test_accepts_authenticated_ssl_settings(tmp_path):
    smtp = smtp_settings()
    assert load_smtp(settings_file(tmp_path, smtp)) == smtp


def test_admin_credentials_cannot_be_sent_to_remote_plain_http(tmp_path):
    env = tmp_path / '.env.auth'
    env.write_text('WORKSPACE_WEB_ORIGIN=https://workspace.example.test\n', encoding='utf-8')
    env.chmod(0o600)
    args = SimpleNamespace(env_file=env, admin_url='http://remote.example.test',
                           enable_registration=False, smtp_file=None, ca_cert=None)
    with pytest.raises(ValueError, match='HTTPS or the server loopback'):
        configure(args)


@pytest.mark.skipif(os.name != 'posix', reason='POSIX permission bits apply on the deployment host')
def test_rejects_shared_secret_file(tmp_path):
    path = settings_file(tmp_path, smtp_settings())
    path.chmod(0o644)
    with pytest.raises(ValueError, match='chmod 600'):
        private_text(path)
