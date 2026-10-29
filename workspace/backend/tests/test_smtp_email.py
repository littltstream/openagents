"""SMTP sender identity, TLS, and truthful delivery status."""
import json
import smtplib
from unittest.mock import MagicMock

import pytest

from app.config import config
from app.services import email


@pytest.fixture
def smtp(tmp_path, monkeypatch):
    settings = {
        'host': 'smtp.example.test', 'port': '465', 'from': 'sender@example.test',
        'fromDisplayName': 'ChipPilot', 'user': 'sender@example.test',
        'password': 'test-only-smtp-authorization', 'auth': 'true', 'ssl': 'true', 'starttls': 'false',
    }
    path = tmp_path / 'smtp.json'
    path.write_text(json.dumps(settings), encoding='utf-8')
    path.chmod(0o600)
    monkeypatch.setattr(config, 'SMTP_CONFIG_FILE', str(path))
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.send_message.return_value = {}
    factory = MagicMock(return_value=connection)
    monkeypatch.setattr(email.smtplib, 'SMTP_SSL', factory)
    monkeypatch.setattr(email.httpx, 'post', lambda *a, **kw: pytest.fail('Configured SMTP must not switch to Resend'))
    return path, settings, connection, factory


def test_smtp_sends_invitation_with_configured_sender_and_self_hosted_link(smtp):
    _, _, connection, factory = smtp
    assert email.email_configured()
    assert email.send_invite_email('invitee@example.test', '芯片测试', 'member',
                                   'https://workspace.example.test/invite/test-only', 'Owner') is True
    factory.assert_called_once()
    assert factory.call_args.args == ('smtp.example.test', 465)
    connection.login.assert_called_once_with('sender@example.test', 'test-only-smtp-authorization')
    message = connection.send_message.call_args.args[0]
    assert str(message['From']) == 'ChipPilot <sender@example.test>'
    assert str(message['To']) == 'invitee@example.test'
    assert 'https://workspace.example.test/invite/test-only' in message.get_content()
    assert connection.send_message.call_args.kwargs['to_addrs'] == ['invitee@example.test']


def test_smtp_auth_failure_does_not_fall_back_or_leak_credentials(smtp, caplog):
    _, _, connection, _ = smtp
    connection.login.side_effect = smtplib.SMTPAuthenticationError(535, b'test-only-smtp-authorization')
    assert email.send_email('invitee@example.test', 'Invite', 'Private invitation URL') is False
    assert 'test-only-smtp-authorization' not in caplog.text
    assert 'Private invitation URL' not in caplog.text


def test_smtp_recipient_refusal_is_not_success(smtp):
    _, _, connection, _ = smtp
    connection.send_message.return_value = {'invitee@example.test': (550, b'refused')}
    assert email.send_email('invitee@example.test', 'Invite', 'Body') is False


def test_smtp_requires_tls_before_connecting(smtp):
    path, settings, _, factory = smtp
    settings['ssl'] = 'false'
    path.write_text(json.dumps(settings), encoding='utf-8')
    assert email.send_email('invitee@example.test', 'Invite', 'Body') is False
    factory.assert_not_called()


def test_starttls_precedes_authentication(smtp, monkeypatch):
    path, settings, connection, factory = smtp
    settings.update(ssl='false', starttls='true', port='587')
    path.write_text(json.dumps(settings), encoding='utf-8')
    monkeypatch.setattr(email.smtplib, 'SMTP', factory)
    assert email.send_email('invitee@example.test', 'Invite', 'Body') is True
    methods = [call[0] for call in connection.method_calls]
    assert methods.index('starttls') < methods.index('login') < methods.index('send_message')
