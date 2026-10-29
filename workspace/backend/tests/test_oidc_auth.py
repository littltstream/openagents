"""Real RS256/JWKS verification and workspace ACL/identity integration."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from app import access, firebase_auth, oidc_auth
from app.config import config
from app.models import User, UserIdentity
from tests.conftest import TestingSessionLocal


@pytest.fixture
def password_mail(monkeypatch):
    from app.routers import auth
    auth._password_email_cooldowns.clear()
    calls = []
    monkeypatch.setattr(auth.oidc_password_email, 'send_password_reset_email', calls.append)
    yield calls
    auth._password_email_cooldowns.clear()


def test_password_email_targets_only_verified_subject_and_limits_repeats(oidc, client, password_mail):
    headers = {'Authorization': 'Bearer ' + oidc()}
    response = client.post('/v1/auth/password-reset-email', json={}, headers=headers)
    assert response.status_code == 200
    assert response.json()['data'] == {'emailSent': True, 'expiresIn': 900}
    assert password_mail == ['person-1']
    assert client.post('/v1/auth/password-reset-email', json={}, headers=headers).status_code == 429
    assert password_mail == ['person-1']


def test_password_email_rejects_missing_identity_and_unverified_email(oidc, client, password_mail):
    assert client.post('/v1/auth/password-reset-email', json={}).status_code == 401
    headers = {'Authorization': 'Bearer ' + oidc(email_verified=False)}
    assert client.post('/v1/auth/password-reset-email', json={}, headers=headers).status_code == 401
    assert password_mail == []


def test_password_email_rejects_caller_supplied_recipient(oidc, client, password_mail):
    response = client.post('/v1/auth/password-reset-email', json={'email': 'another@example.test'},
                           headers={'Authorization': 'Bearer ' + oidc()})
    assert response.status_code == 422
    assert password_mail == []


def test_password_email_failure_is_not_reported_as_sent(oidc, client, password_mail, monkeypatch):
    from app.routers import auth
    def failed(subject):
        raise auth.oidc_password_email.PasswordEmailUnavailable('Mail service unavailable')
    monkeypatch.setattr(auth.oidc_password_email, 'send_password_reset_email', failed)
    headers = {'Authorization': 'Bearer ' + oidc()}
    response = client.post('/v1/auth/password-reset-email', json={}, headers=headers)
    assert response.status_code == 503
    assert response.json().get('data') is None
    monkeypatch.setattr(auth.oidc_password_email, 'send_password_reset_email', password_mail.append)
    assert client.post('/v1/auth/password-reset-email', json={}, headers=headers).status_code == 200


def test_password_email_is_unavailable_in_other_auth_modes(oidc, client, password_mail, monkeypatch):
    monkeypatch.setattr(config, 'AUTH_MODE', 'workspace_token')
    assert client.post('/v1/auth/password-reset-email', json={}).status_code == 404
    assert password_mail == []


@pytest.fixture
def oidc(monkeypatch):
    monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1")
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid="workspace-test", use="sig", alg="RS256")

    class Keys(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"keys": [jwk]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Keys)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(config, "AUTH_MODE", "oidc")
    monkeypatch.setattr(config, "OIDC_ISSUER_URL", "https://auth.example.test/realms/openagents")
    monkeypatch.setattr(config, "OIDC_CLIENT_ID", "openagents-workspace")
    monkeypatch.setattr(config, "OIDC_JWKS_URL", f"http://127.0.0.1:{server.server_port}/keys")
    monkeypatch.setattr(oidc_auth, "SessionLocal", TestingSessionLocal)
    oidc_auth._jwks_client.cache_clear()

    def token(**overrides):
        now = int(time.time())
        claims = {
            "iss": config.OIDC_ISSUER_URL, "sub": "person-1",
            "aud": config.OIDC_CLIENT_ID, "azp": config.OIDC_CLIENT_ID,
            "iat": now, "exp": now + 300, "typ": "Bearer",
            "email": "owner@example.test", "email_verified": True, "name": "Owner",
        }
        claims.update(overrides)
        return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "workspace-test"})

    yield token
    server.shutdown()
    server.server_close()
    thread.join()
    oidc_auth._jwks_client.cache_clear()


def test_verifies_signature_and_stable_identity(oidc):
    claims = firebase_auth.verify_identity_claims(oidc())
    assert claims["oidc_sub"] == "person-1"
    assert claims["oidc_issuer"] == config.OIDC_ISSUER_URL
    assert firebase_auth.verify_identity_token(oidc()) == "owner@example.test"


@pytest.mark.parametrize("overrides", [
    {"iss": "https://untrusted.example.test"}, {"aud": "another-client"},
    {"azp": "another-client"}, {"exp": 1}, {"iat": 9999999999},
    {"email_verified": False}, {"email_verified": "true"}, {"email": ""},
    {"sub": ""}, {"typ": "ID"},
])
def test_rejects_invalid_claims(oidc, overrides):
    assert firebase_auth.verify_identity_claims(oidc(**overrides)) is None


def test_rejects_wrong_signing_key_and_algorithm(oidc):
    good = oidc()
    claims = jwt.decode(good, options={"verify_signature": False})
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    bad = jwt.encode(claims, other, algorithm="RS256", headers={"kid": "workspace-test"})
    assert firebase_auth.verify_identity_claims(bad) is None
    assert firebase_auth.verify_identity_claims(jwt.encode(claims, "test-only", algorithm="HS256")) is None


def test_oidc_does_not_accept_other_identity_providers(oidc, monkeypatch):
    firebase = lambda *_: pytest.fail("OIDC must not fall through to Firebase")
    monkeypatch.setattr(firebase_auth, "verify_firebase_token", firebase)
    monkeypatch.setattr(firebase_auth, "verify_apple_token", firebase)
    assert firebase_auth.verify_identity_token("invalid") is None
    assert firebase_auth.verify_identity_claims("invalid") is None


def test_identity_is_opt_in(oidc, monkeypatch):
    monkeypatch.setattr(config, "AUTH_MODE", "workspace_token")
    assert oidc_auth.verify_oidc_claims(oidc()) is None


def test_user_can_create_workspace_pair_device_and_not_access_another(oidc, client):
    owner = {"Authorization": "Bearer " + oidc()}
    response = client.post("/v1/workspaces", json={"name": "Owned workspace"}, headers=owner)
    assert response.status_code == 200
    workspace = response.json()["data"]
    pairing = client.post(f"/v1/workspaces/{workspace['workspaceId']}/pairing-codes", headers=owner)
    assert pairing.status_code == 200
    assert pairing.json()["code"] == 0
    assert pairing.json()["data"]["code"]
    outsider = {"Authorization": "Bearer " + oidc(sub="person-2", email="outsider@example.test")}
    denied = client.post(f"/v1/workspaces/{workspace['workspaceId']}/pairing-codes", headers=outsider)
    assert denied.status_code == 403
    # Machine connectivity remains independent of human login.
    joined = client.post("/v1/join", json={
        "agent_name": "local-expert", "network": workspace["workspaceId"], "token": workspace["token"],
    })
    assert joined.status_code == 200
    assert joined.json()["code"] == 0


def test_subject_binding_preserves_account_and_rejects_takeover(oidc, db):
    claims = firebase_auth.verify_identity_claims(oidc())
    user = access.get_or_create_user(db, claims)
    db.commit()
    user_id = user.id
    # An IdP email change cannot move the subject onto another account or ACL.
    changed = firebase_auth.verify_identity_claims(oidc(email="changed@example.test"))
    assert changed["email"] == "owner@example.test"
    assert access.get_or_create_user(db, changed).id == user_id
    assert firebase_auth.verify_identity_token(oidc(email="changed@example.test")) == user.email
    assert firebase_auth.verify_identity_claims(oidc(sub="person-2")) is None
    assert firebase_auth.verify_identity_token(oidc(sub="person-2")) is None
    assert access.get_or_create_user(db, {**claims, "oidc_sub": "person-2"}) is None
    assert len(db.execute(select(UserIdentity)).scalars().all()) == 1
    assert len(db.execute(select(User)).scalars().all()) == 1


def test_verified_login_claims_existing_invited_user(oidc, db):
    invited = User(email="owner@example.test")
    db.add(invited)
    db.commit()
    user = access.get_or_create_user(db, firebase_auth.verify_identity_claims(oidc()))
    assert user.id == invited.id
    assert user.email_verified_at is not None
    db.commit()
    assert db.get(UserIdentity, (config.OIDC_ISSUER_URL, "person-1")).user_id == user.id
