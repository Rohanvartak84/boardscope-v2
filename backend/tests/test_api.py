import json, time, os, stat
from boardscope import db, connections
from boardscope.security import public_board
from boardscope.logs import store
from boardscope.config import DATA, CONFIG
from boardscope.execution import Engine, engine


def draft(kind="ssh"):
    cs = [
        {
            "id": "ssh1",
            "type": "ssh",
            "host": "127.0.0.1",
            "port": 1,
            "username": "tester",
            "auth": "password",
            "password": "private-test-secret",
        }
    ]
    uart = {
        "id": "uart1",
        "type": "uart",
        "device": "/dev/ttyDOESNOTEXIST",
        "baud": 115200,
    }
    return {
        "name": "Board-01",
        "connections": (
            cs if kind == "ssh" else [uart] if kind == "uart" else cs + [uart]
        ),
    }


def save(client, kind="ssh"):
    return client.post("/api/boards", json=draft(kind)).json()


def test_auth_csrf_origin_and_host(client):
    assert client.get("/api/state").status_code == 200
    cookie = client.cookies.get("bs_session")
    client.cookies.clear()
    for url in (
        "/api/state",
        "/api/logs",
        "/api/logs/stream",
        "/api/logs/export",
        "/api/keys",
    ):
        assert client.get(url).status_code == 401
    assert (
        client.post("/api/boards/x/console", json={"command": "id"}).status_code == 401
    )
    client.cookies.set("bs_session", cookie)
    assert (
        client.post(
            "/api/boards", json=draft(), headers={"x-csrf-token": ""}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/boards", json=draft(), headers={"origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert client.get("/api/state", headers={"host": "evil.example"}).status_code == 403


def test_honest_empty_state(client):
    s = client.get("/api/state").json()
    assert s["boards"] == []
    assert s["counts"] == dict(reachable=0, running=0, queued=0, passed=0, failed=0)
    assert s["ai_configured"] is False


def test_three_connection_configurations_persist_and_secrets_hidden(client):
    for kind in ("ssh", "uart", "dual"):
        b = save(client, kind)
        assert b["id"]
        assert "private-test-secret" not in json.dumps(b)
    assert len(db.boards()) == 3
    with db.connect() as d:
        raw = "".join(r[0] for r in d.execute("SELECT data FROM boards"))
    assert "private-test-secret" not in raw
    assert stat.S_IMODE((DATA / "encryption.key").stat().st_mode) == 0o600
    db.init()
    assert len(client.get("/api/state").json()["boards"]) == 3


def test_verify_bad_endpoints_never_claims_reachable(client):
    r = client.post("/api/verify", json=draft("dual")).json()
    assert len(r["connections"]) == 2
    assert all(c["state"] == "disconnected" for c in r["connections"])
    b = client.post(
        "/api/boards", json=draft("dual") | {"receipt": r["receipt"]}
    ).json()
    assert not any(c.get("verified_at") for c in b["verification"]["connections"])
    assert client.get("/api/state").json()["counts"]["reachable"] == 0


def test_receipt_is_bound_to_exact_configuration(client, monkeypatch):
    monkeypatch.setattr(
        connections,
        "verify",
        lambda *a: {
            "connections": [
                {
                    "type": "ssh",
                    "state": "linux_shell_verified",
                    "verified_at": time.time(),
                }
            ],
            "metadata": {"os": "Test Linux", "kernel": "test"},
        },
    )
    d = draft()
    r = client.post("/api/verify", json=d).json()
    d["connections"][0]["host"] = "127.0.0.2"
    b = client.post("/api/boards", json=d | {"receipt": r["receipt"]}).json()
    assert b["verification"]["connections"] == []
    d = draft()
    r = client.post("/api/verify", json=d).json()
    b = client.post("/api/boards", json=d | {"receipt": r["receipt"]}).json()
    assert b["metadata"]["os"] == "Test Linux"


def test_missing_connection_and_approved_key_restrictions(client):
    assert (
        client.post("/api/boards", json={"name": "x", "connections": []}).status_code
        == 400
    )
    d = draft()
    d["connections"][0].update(auth="key", key_ref="../../etc/passwd")
    assert client.post("/api/boards", json=d).status_code == 400
    try:
        connections.private_host("8.8.8.8")
        assert False
    except ValueError:
        pass


def test_settings_inheritance_and_secret_retention(client):
    b = save(client)
    raw = db.board(b["id"])
    secret = raw["connections"][0]["password"]
    b["overrides"] = {"command_timeout": 19}
    b = client.post("/api/boards", json=b).json()
    assert db.board(b["id"])["connections"][0]["password"] == secret
    assert engine.effective(db.board(b["id"]))["command_timeout"] == 19
    assert (
        engine.effective(db.board(b["id"]))["reconnect_limits"]
        == CONFIG["defaults"]["reconnect_limits"]
    )


def wait(id):
    until = time.time() + 10
    while time.time() < until:
        r = db.run(id)
        if r["state"] not in ("queued", "running", "cancelling"):
            return r
        time.sleep(0.05)
    raise AssertionError("worker did not finish")


def test_worker_transport_failure_is_not_test_failure(client):
    b = save(client)
    r = client.post(
        "/api/runs", json={"board_id": b["id"], "items": [{"test": "inventory"}]}
    )
    assert r.status_code == 200
    result = wait(r.json()["id"])
    assert result["state"] == "infrastructure_error"
    assert result["failure_category"] == "infrastructure"
    assert client.get("/api/state").json()["counts"]["failed"] == 0
    assert (
        client.get("/api/runs/" + result["id"] + "/report").json()["run"]["id"]
        == result["id"]
    )


def test_reboot_custom_review_and_suite_validation(client):
    b = save(client)
    for kind in ("reboot", "custom"):
        assert (
            client.post(
                "/api/runs",
                json={
                    "board_id": b["id"],
                    "items": [{"test": kind, "parameters": {"script": "true"}}],
                },
            ).status_code
            == 400
        )
    assert (
        client.post("/api/suites", json={"name": "Empty", "stages": []}).status_code
        == 400
    )
    r = client.post(
        "/api/suites",
        json={
            "name": "Smoke",
            "stages": [{"test": "inventory"}, {"test": "inventory"}],
        },
    )
    assert r.status_code == 200
    id = client.post(
        "/api/runs", json={"board_id": b["id"], "suite_id": r.json()["id"]}
    ).json()["id"]
    result = wait(id)
    assert len(result["plan"]) == 2


def test_log_sources_raw_redaction_pagination_export(client):
    b = save(client)
    store.add(b["id"], None, "uart", b"kernel\r\n\x1b[31mraw\xff")
    store.add(b["id"], "run-x", "stdout", "private-test-secret hidden")
    rows = client.get("/api/logs", params={"board_id": b["id"]}).json()
    assert len(rows) == 2
    assert rows[0]["source"] == "uart"
    assert rows[0]["run_id"] is None
    assert "private-test-secret" not in json.dumps(rows)
    assert "[REDACTED]" in rows[1]["raw"]
    assert (
        len(
            client.get(
                "/api/logs", params={"board_id": b["id"], "before": rows[1]["id"]}
            ).json()
        )
        == 1
    )
    assert "kernel" in client.get("/api/logs/export", params={"board_id": b["id"]}).text


def test_history_retained_after_board_removed(client):
    b = save(client)
    id = client.post(
        "/api/runs", json={"board_id": b["id"], "items": [{"test": "inventory"}]}
    ).json()["id"]
    wait(id)
    assert (
        client.request(
            "DELETE", "/api/boards/" + b["id"], json={"confirm": b["name"]}
        ).status_code
        == 200
    )
    assert client.get("/api/state").json()["boards"] == []
    assert client.get("/api/history").json()[0]["id"] == id


def test_restart_marks_uncertain_active_runs(client):
    b = save(client)
    id = "restart-fixture"
    with db.connect() as d:
        d.execute(
            "INSERT INTO runs VALUES(?,?,?,?,?,?)",
            (
                id,
                b["id"],
                "running",
                time.time(),
                None,
                json.dumps({"name": "unfinished"}),
            ),
        )
    db.init()
    r = db.run(id)
    assert r["state"] == "interrupted"
    assert "remote processes may still be running" in r["error"]


def test_ai_disabled_does_not_make_network_request(client, monkeypatch):
    import httpx

    monkeypatch.setattr(
        httpx.Client,
        "post",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("External request")),
    )
    r = client.request("POST", "/api/ai/ask", json={"question": "Explain"})
    assert r.status_code == 200
    assert r.json()["configured"] is False


def test_resource_exclusion_and_read_parallelism(client):
    e = Engine()
    assert e.acquire("b", ["read"])
    assert e.acquire("b", ["read"])
    assert not e.acquire("b", ["exclusive"])
    e.release("b", ["read"])
    e.release("b", ["read"])
    assert e.acquire("b", ["network"])
    assert not e.acquire("b", ["network"])
    assert not e.acquire("b", ["exclusive"])


def test_log_quota_is_explicit_not_silent(client, monkeypatch):
    monkeypatch.setitem(CONFIG, "max_log_bytes", 3)
    from boardscope.logs import EvidenceFull

    try:
        store.add("b", None, "uart", "four")
        assert False
    except EvidenceFull as e:
        assert "quota" in str(e)
