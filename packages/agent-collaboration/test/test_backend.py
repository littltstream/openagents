"""Run the JS collaboration client against real Workspace API handlers.

Uses the existing backend's in-memory SQLite test setup. No production database,
remote Workspace, credentials, or model provider is used.
"""

import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pytest


REPOSITORY = Path(__file__).resolve().parents[3]


@pytest.fixture
def backend_context(monkeypatch, backend_fixtures):
    loaded_main = sys.modules.get("app.main")
    previous_overrides = dict(loaded_main.app.dependency_overrides) if loaded_main is not None else {}
    # Reuse the production-type compatibility shims, StaticPool and database
    # dependency override already maintained by the backend test suite.
    fixtures = backend_fixtures
    from app.config import config
    from app import database

    monkeypatch.setattr(config, "ANALYTICS_ENABLED", False)
    # Background event jobs open their own sessions instead of going through
    # FastAPI dependencies. Keep those on the same isolated test database too.
    original_sessions = database.SessionLocal
    for module_name, module in list(sys.modules.items()):
        if module_name.startswith("app.") and getattr(module, "SessionLocal", None) is original_sessions:
            monkeypatch.setattr(module, "SessionLocal", fixtures["TestingSessionLocal"])
    engine = fixtures["engine"]
    metadata = fixtures["Base"].metadata
    metadata.create_all(bind=engine)
    api = fixtures["TestClient"](fixtures["app"])
    db = fixtures["TestingSessionLocal"]()
    try:
        yield fixtures, api, db
    finally:
        api.close()
        db.close()
        metadata.drop_all(bind=engine)
        fixtures["app"].dependency_overrides.clear()
        fixtures["app"].dependency_overrides.update(previous_overrides)
        engine.dispose()


@pytest.fixture(scope="module")
def backend_fixtures():
    # Modules imported during API requests retain their SessionLocal reference.
    # Reuse one isolated engine so later cases cannot bind those modules to a
    # disposed engine from a different runpy execution.
    with pytest.MonkeyPatch.context() as patch:
        patch.syspath_prepend(str(REPOSITORY / "workspace" / "backend"))
        yield runpy.run_path(str(REPOSITORY / "workspace/backend/tests/conftest.py"))


@pytest.mark.parametrize("origin_kind", ["channel", "human_dm"])
def test_real_backend_collaboration(backend_context, origin_kind):
    fixtures, api, db = backend_context
    from app.services.access_model import create_grant, get_or_create_builtin_groups
    server = None
    try:
        workspace = fixtures["workspace"].__wrapped__(api, db)
        joined = api.post("/v1/join", headers={"X-Workspace-Token": workspace["token"]}, json={
            "network": workspace["id"], "token": workspace["token"], "agent_name": "agent-beta", "agent_type": "codex",
            "description": "CSV chip test analysis",
        })
        assert joined.status_code == 200, joined.text
        assert joined.json()["data"]["description_initialized"] is True
        profiled = api.patch(f"/v1/workspaces/{workspace['id']}/members/agent-beta",
                             headers={"X-Workspace-Token": workspace["token"]},
                             json={"purpose": "Summarize chip tests"})
        assert profiled.status_code == 200, profiled.text
        everyone = get_or_create_builtin_groups(db, workspace["id"])["everyone"]
        create_grant(db, workspace["id"], resource_kind="agent", resource_id="agent-beta",
                     grantee_kind="group", grantee_id=everyone.id, rights=["act"], granted_by="test@example.com")
        db.commit()
        if origin_kind == "human_dm":
            import time
            from uuid import uuid4
            from app.models import EventRecord
            # Existing received messages are test inputs; the JS client must
            # use the real handlers to discover, delegate and return a DM.
            for peer, target in (("requester@example.test", "agent-alpha"), ("unrelated@example.test", "agent-beta")):
                db.add(EventRecord(id=str(uuid4()), network_id=workspace["id"],
                                   type="workspace.message.posted", source=f"human:{peer}",
                                   target=f"openagents:{target}", visibility="direct",
                                   payload={"content": "Please delegate this task", "message_type": "chat"},
                                   timestamp=int(time.time() * 1000)))
            db.commit()
            workspace["channel"]["name"] = "dm:human:requester@example.test"

        class ApiBridge(BaseHTTPRequestHandler):
            def dispatch(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                response = api.request(self.command, self.path, content=body, headers={
                    name: self.headers[name] for name in ("Content-Type", "X-Workspace-Token", "X-Agent-Name")
                    if name in self.headers
                })
                self.send_response(response.status_code)
                self.send_header("Content-Type", response.headers.get("content-type", "application/json"))
                self.send_header("Content-Length", str(len(response.content)))
                self.end_headers()
                self.wfile.write(response.content)

            do_GET = dispatch
            do_POST = dispatch
            do_PUT = dispatch

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), ApiBridge)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        result = subprocess.run([
            shutil.which("node"), str(Path(__file__).with_name("backend-flow.js")),
        ], env={**os.environ,
                "OA_WORKSPACE_ENDPOINT": f"http://127.0.0.1:{server.server_port}",
                "OA_WORKSPACE_ID": workspace["id"], "OA_WORKSPACE_TOKEN": workspace["token"],
                "OA_CHANNEL_NAME": workspace["channel"]["name"]},
            capture_output=True, text=True, encoding="utf-8", timeout=30)
        assert result.returncode == 0, result.stderr
        report = json.loads(result.stdout)
        assert report["private"] and report["origin_recovered"] and report["returned_to_user_channel"]
        if origin_kind == "human_dm":
            from sqlalchemy import select
            final = db.execute(select(EventRecord).where(EventRecord.id == report["final_event_id"])).scalar_one()
            assert final.visibility == "direct"
            assert final.target == "human:requester@example.test"
            from app.models import Channel
            from app.services.access_model import Principal, allowed, can_view_channel, resource_for_channel
            group = db.execute(select(Channel).where(Channel.workspace_id == workspace["id"], Channel.name == report["group"])).scalar_one()
            assert report["human_participants"] == ["requester@example.test"]
            assert can_view_channel(db, workspace["id"], Principal("human", email="requester@example.test", workspace_id=workspace["id"]), group)
            assert allowed(db, Principal("human", email="requester@example.test", workspace_id=workspace["id"]), resource_for_channel(group), "act", workspace["id"])
            assert not can_view_channel(db, workspace["id"], Principal("human", email="unrelated@example.test", workspace_id=workspace["id"]), group)
            assert not db.execute(select(Channel).where(Channel.workspace_id == workspace["id"], Channel.name.like("dm:%"))).scalars().all()
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


def test_workspace_description_initialization_and_overrides(backend_context):
    fixtures, api, db = backend_context
    first = fixtures["workspace"].__wrapped__(api, db)
    second = fixtures["workspace"].__wrapped__(api, db)

    def join(ws, description=None):
        body = {"network": ws["id"], "token": ws["token"], "agent_name": "agent-alpha"}
        if description is not None:
            body["description"] = description
        result = api.post("/v1/join", json=body)
        assert result.status_code == 200, result.text
        return result.json()["data"]

    def description(ws):
        result = api.get("/v1/discover", params={"network": ws["id"]}, headers={"X-Workspace-Token": ws["token"]})
        assert result.status_code == 200
        return next(a["description"] for a in result.json()["data"]["agents"] if a["address"] == "openagents:agent-alpha")

    def edit(ws, value):
        result = api.patch(f"/v1/workspaces/{ws['id']}/members/agent-alpha",
                           json={"description": value}, headers={"X-Workspace-Token": ws["token"]})
        assert result.status_code == 200, result.text

    assert join(first, "  CSV 默认能力  ")["description_initialized"] is True
    assert description(first) == "CSV 默认能力"
    assert join(first, "Changed local default")["description_initialized"] is False
    assert description(first) == "CSV 默认能力"
    assert join(second, "FPGA specialist")["description_initialized"] is True
    edit(first, "This workspace: chip test reports")
    assert join(first, "Changed local default")["description_initialized"] is False
    assert description(first) == "This workspace: chip test reports"
    assert description(second) == "FPGA specialist"
    edit(first, "")
    assert join(first, "Do not restore this")["description_initialized"] is False
    assert description(first) == ""
    assert join(first)["description_initialized"] is False
    assert description(first) == ""


def test_invalid_default_description_does_not_register_an_agent(backend_context):
    fixtures, api, db = backend_context
    workspace = fixtures["workspace"].__wrapped__(api, db)
    for value, status in [(True, 422), ("x" * 4001, 422), ("bad\0description", 400)]:
        response = api.post("/v1/join", json={"network": workspace["id"], "token": workspace["token"],
                            "agent_name": "invalid-description", "description": value})
        assert response.status_code == status
    from app.models import WorkspaceMember
    from sqlalchemy import select
    assert db.execute(select(WorkspaceMember).where(WorkspaceMember.agent_name == "invalid-description")).scalar_one_or_none() is None
