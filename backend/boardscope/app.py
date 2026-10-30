import asyncio, json, time, uuid, secrets, hashlib, re, os
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from . import db, connections, security, ai
from .config import CONFIG, DATA, ROOT
from .catalog import CATALOG
from .execution import engine, ACTIVE
from .logs import store

receipts = {}


@asynccontextmanager
async def lifespan(app):
    db.init()
    connections.init()
    engine.start()
    for b in db.boards():
        try:
            store.add(
                b["id"],
                None,
                "event",
                "Agent started: capture gap possible while the agent was offline; no automatic backfill is available.",
            )
            connections.start_capture(b)
        except Exception as e:
            connections.capture_errors[b["id"]] = "Capture startup failed: " + str(e)
    yield
    engine.shutdown()
    connections.close()


app = FastAPI(
    title="BoardScope local agent",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def guards(request, call_next):
    if request.url.path.startswith("/api"):
        origin = request.headers.get("origin")
        if origin and origin not in CONFIG["origins"]:
            return JSONResponse({"detail": "Origin not allowed"}, 403)
        host = request.headers.get("host", "")
        if host not in {
            __import__("urllib.parse", fromlist=["urlsplit"]).urlsplit(o).netloc
            for o in CONFIG["origins"]
        }:
            return JSONResponse(
                {"detail": "Host not allowed; configure explicit local origin"}, 403
            )
        public = request.url.path in ("/api/login", "/api/auth-status")
        s = security.session(request.cookies.get("bs_session"))
        if not public and not s:
            return JSONResponse({"detail": "Authentication required"}, 401)
        if request.method not in ("GET", "HEAD", "OPTIONS") and not public:
            if not secrets.compare_digest(
                request.headers.get("x-csrf-token", ""), s["csrf"]
            ):
                return JSONResponse({"detail": "CSRF validation failed"}, 403)
        if (
            request.method == "POST"
            and request.headers.get("content-length")
            and int(request.headers["content-length"]) > 200000
        ):
            return JSONResponse({"detail": "Request too large"}, 413)
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(ValueError)
async def value_error(request, exc):
    return JSONResponse({"detail": str(exc)}, 400)


@app.get("/api/auth-status")
def auth_status(request: Request):
    s = security.session(request.cookies.get("bs_session"))
    return {
        "authenticated": bool(s),
        "csrf": s["csrf"] if s else None,
        "setup_required": not (DATA / "auth.json").exists(),
    }


@app.post("/api/login")
async def login(request: Request):
    body = await request.json()
    token, csrf = security.login(body.get("password", ""), request.client.host)
    response = JSONResponse({"csrf": csrf})
    response.set_cookie(
        "bs_session",
        token,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        max_age=28800,
        path="/",
    )
    return response


@app.post("/api/logout")
def logout(request: Request):
    security.sessions.pop(request.cookies.get("bs_session"), None)
    r = JSONResponse({"ok": True})
    r.delete_cookie("bs_session")
    return r


@app.get("/api/state")
def state():
    boards = [security.public_board(b) for b in db.boards()]
    runs = db.runs(1000)
    today = datetime.now(ZoneInfo(CONFIG["timezone"])).date()
    with db.connect() as d:
        daily = list(
            d.execute(
                "SELECT state,finished FROM runs WHERE finished IS NOT NULL AND state IN ('passed','failed')"
            )
        )
    counts = {
        "reachable": sum(
            any(
                c.get("verified_at")
                and time.time() - c["verified_at"] < 120
                and c.get("state") == "linux_shell_verified"
                for c in b.get("verification", {}).get("connections", [])
            )
            for b in boards
        ),
        "running": sum(r["state"] in ("running", "cancelling") for r in runs),
        "queued": sum(r["state"] == "queued" for r in runs),
        "passed": sum(
            r["state"] == "passed"
            and datetime.fromtimestamp(
                r["finished"], ZoneInfo(CONFIG["timezone"])
            ).date()
            == today
            for r in daily
        ),
        "failed": sum(
            r["state"] == "failed"
            and datetime.fromtimestamp(
                r["finished"], ZoneInfo(CONFIG["timezone"])
            ).date()
            == today
            for r in daily
        ),
    }
    with db.connect() as d:
        suites = [json.loads(r[0]) for r in d.execute("SELECT data FROM suites")]
    return {
        "boards": boards,
        "active": [r for r in runs if r["state"] in ACTIVE],
        "recent": [r for r in runs if r["state"] not in ACTIVE][:5],
        "counts": counts,
        "catalog": list(CATALOG.values()),
        "suites": suites,
        "defaults": CONFIG["defaults"],
        "timezone": CONFIG["timezone"],
        "ai_configured": bool(CONFIG.get("ai", {}).get("enabled")),
        "agent_time": time.time(),
        "alerts": list(connections.capture_errors.values()),
    }


@app.get("/api/ports")
def ports():
    return connections.ports()


@app.get("/api/keys")
def keys():
    return connections.keys()


def digest(body):
    return hashlib.sha256(
        json.dumps(
            {k: v for k, v in body.items() if k not in ("receipt", "approvals")},
            sort_keys=True,
        ).encode()
    ).hexdigest()


def prepare(body):
    name = body.get("name", "").strip()
    if not name or len(name) > 100:
        raise ValueError("Board name must contain 1–100 characters")
    id = body.get("id") or uuid.uuid4().hex
    existing = db.board(id) if body.get("id") else None
    previous = {c["id"]: c for c in existing["connections"]} if existing else {}
    cs = body.get("connections", [])
    if not 1 <= len(cs) <= 2 or len({c["type"] for c in cs}) != len(cs):
        raise ValueError("Configure one SSH and/or one UART connection")
    clean = []
    for c in cs:
        kind = c.get("type")
        old = previous.get(c.get("id"), {})
        if kind == "ssh":
            if c.get("auth", "password") not in ("password", "key"):
                raise ValueError("Choose SSH password or key authentication")
            if not c.get("host") or not c.get("username"):
                raise ValueError("SSH requires host and username")
            if not 1 <= int(c.get("port", 22)) <= 65535:
                raise ValueError("Invalid SSH port")
            n = {k: c[k] for k in ("host", "username", "auth", "key_ref") if k in c}
            n["port"] = int(c.get("port", 22))
            if c.get("auth") == "key":
                connections.key_path(c.get("key_ref", ""))
            for k in ("password", "key_passphrase"):
                n[k] = connections.vault.encrypt(c[k]) if c.get(k) else old.get(k, "")
                if c.get(k):
                    store.register(c[k])
        elif kind == "uart":
            if not c.get("device") or not re.fullmatch(
                r"/dev/(?:tty[A-Za-z0-9_-]+|serial/by-(?:id|path)/[^/]+)",
                str(c["device"]),
            ):
                raise ValueError("Choose an agent serial endpoint")
            if int(c.get("baud", 115200)) not in (
                9600,
                19200,
                38400,
                57600,
                115200,
                230400,
                460800,
                921600,
            ):
                raise ValueError("Unsupported baud rate")
            n = {k: c[k] for k in ("device", "login_username", "advanced") if k in c}
            n["baud"] = int(c.get("baud", 115200))
            n["login_password"] = (
                connections.vault.encrypt(c["login_password"])
                if c.get("login_password")
                else old.get("login_password", "")
            )
            if c.get("login_password"):
                store.register(c["login_password"])
        else:
            raise ValueError("Only SSH and Serial/UART are supported")
        n.update(id=c.get("id") or uuid.uuid4().hex, type=kind)
        clean.append(n)
    overrides = body.get("overrides", existing.get("overrides", {}) if existing else {})
    for k, v in overrides.items():
        if k not in CONFIG["defaults"]:
            raise ValueError("Unknown setting " + k)
        if k == "uart_log_capture" and not isinstance(v, bool):
            raise ValueError("UART capture setting must be boolean")
        if k == "default_suite" and v is not None:
            with db.connect() as d:
                found = d.execute("SELECT id FROM suites WHERE id=?", (v,)).fetchone()
            if not found:
                raise ValueError("Choose an existing saved suite")
        if k in ("command_timeout", "reboot_recovery_timeout", "reconnect_limits") and (
            not isinstance(v, int) or not 1 <= v <= 3600
        ):
            raise ValueError("Invalid setting " + k)
    for c in clean:
        if c["type"] == "uart":
            c["capture"] = overrides.get(
                "uart_log_capture", CONFIG["defaults"]["uart_log_capture"]
            )
    return {
        "id": id,
        "name": name,
        "target": "linux",
        "connections": clean,
        "overrides": overrides,
        "verification": {"connections": []},
        "metadata": existing.get("metadata", {}) if existing else {},
    }


def busy_guard(id):
    if engine.active(id):
        raise ValueError(
            "Board has active or queued work; stop it before this operation"
        )
    if not engine.acquire(id, ["exclusive"]):
        raise ValueError("Board is busy with verification or console access")


@app.post("/api/verify")
async def verify(request: Request):
    body = await request.json()
    b = prepare(body)
    busy_guard(b["id"])
    # Never retain temporary ports after verification, including dialog cancellation.
    try:
        if body.get("id"):
            connections.release(b["id"])
        result = await run_in_threadpool(
            connections.verify, b, body.get("approvals", {}), True
        )
    finally:
        engine.release(b["id"], ["exclusive"])
    receipt = secrets.token_urlsafe(24)
    receipts[receipt] = {
        "digest": digest(body),
        "board": b,
        "result": result,
        "expires": time.time() + 300,
    }
    for key, value in list(receipts.items()):
        if value["expires"] < time.time():
            receipts.pop(key)
    return result | {"receipt": receipt}


@app.post("/api/boards")
async def save_board(request: Request):
    body = await request.json()
    b = prepare(body)
    if body.get("id"):
        busy_guard(b["id"])
    try:
        receipt = receipts.pop(body.get("receipt", ""), None)
        if (
            receipt
            and receipt["expires"] > time.time()
            and receipt["digest"] == digest(body)
        ):
            b = receipt["board"]
            b["verification"] = receipt["result"]
            b["metadata"] = b["metadata"] | receipt["result"]["metadata"]
        connections.release(b["id"])
        db.save_board(b)
        connections.start_capture(b)
    finally:
        if body.get("id"):
            engine.release(b["id"], ["exclusive"])
    return security.public_board(b)


@app.post("/api/boards/{id}/verify")
async def verify_saved(id):
    b = db.board(id)
    busy_guard(id)
    try:
        result = await run_in_threadpool(connections.verify, b, None, False)
    finally:
        engine.release(id, ["exclusive"])
    b["verification"] = result
    b["metadata"].update(result["metadata"])
    db.save_board(b)
    return result


@app.delete("/api/boards/{id}")
async def remove_board(id, request: Request):
    body = await request.json()
    if body.get("confirm") != db.board(id)["name"]:
        raise ValueError("Type the board name to confirm removal")
    busy_guard(id)
    try:
        connections.release(id)
        with db.connect() as d:
            d.execute(
                "UPDATE boards SET removed=1,data=? WHERE id=?",
                (json.dumps(security.public_board(db.board(id))), id),
            )
    finally:
        engine.release(id, ["exclusive"])
    return {"ok": True, "history_preserved": True}


@app.post("/api/suites")
async def save_suite(request: Request):
    body = await request.json()
    name = body.get("name", "").strip()
    stages = body.get("stages", [])
    if (
        not name
        or len(name) > 100
        or not 1 <= len(stages) <= 20
        or any(s.get("test") not in CATALOG for s in stages)
    ):
        raise ValueError("Suite needs a name and 1–20 supported stages")
    # Store no credentials in suites. Parameters are explicitly reviewed per launch.
    suite = {
        "id": body.get("id") or uuid.uuid4().hex,
        "name": name,
        "stages": [
            {"test": s["test"], "parameters": s.get("parameters", {})} for s in stages
        ],
    }
    with db.connect() as d:
        d.execute(
            "INSERT OR REPLACE INTO suites VALUES(?,?)",
            (suite["id"], json.dumps(suite)),
        )
    return suite


@app.post("/api/runs")
async def start_run(request: Request):
    body = await request.json()
    b = db.board(body["board_id"])
    items = body.get("items", [])
    suite = None
    if body.get("suite_id"):
        with db.connect() as d:
            r = d.execute(
                "SELECT data FROM suites WHERE id=?", (body["suite_id"],)
            ).fetchone()
        if not r:
            raise ValueError("Suite not found")
        s = json.loads(r[0])
        suite = s["name"]
        items = [x | {"confirmed": body.get("confirmed", False)} for x in s["stages"]]
        if engine.active(b["id"]):
            raise ValueError("Configured suite requires an idle board")
    if not items or any(x.get("test") not in CATALOG for x in items):
        raise ValueError("Choose supported tests")
    if any(x["test"] == "reboot" for x in items) and engine.active(b["id"]):
        raise ValueError("Reboot requires exclusive board access and no queued work")
    return {"id": engine.submit(b, items, suite)}


@app.post("/api/runs/{id}/stop")
def stop_run(id):
    engine.cancel(id)
    return {
        "ok": True,
        "message": "Cooperative cancellation requested; see cleanup events",
    }


@app.post("/api/boards/{id}/stop")
def stop_board(id):
    for r in engine.active(id):
        engine.cancel(r["id"])
    return {"ok": True}


@app.get("/api/history")
def history(page: int = 0, board_id: str | None = None, state: str | None = None):
    if page < 0:
        raise ValueError("Invalid page")
    return db.runs(20, page * 20, board_id, state)


@app.get("/api/runs/{id}/report")
def report(id):
    r = db.run(id)
    logs = store.list(run=id, before=2**63 - 1, limit=500)
    return JSONResponse(
        {
            "report_version": 1,
            "run": r,
            "log_tail": logs,
            "evidence_note": "Full evidence is available through paginated log API/export. UART is board-session evidence, not attributed to concurrent runs.",
        },
        headers={"Content-Disposition": f'attachment; filename="boardscope-{id}.json"'},
    )


@app.get("/api/logs")
def logs(
    board_id: str | None = None,
    run_id: str | None = None,
    source: str | None = None,
    after: int = 0,
    before: int | None = None,
):
    return store.list(board_id, run_id, source, after, before)


@app.get("/api/logs/export")
def export(
    board_id: str | None = None, run_id: str | None = None, source: str | None = None
):
    def generate():
        cursor = 0
        while True:
            rows = store.list(board_id, run_id, source, cursor, limit=500)
            if not rows:
                break
            for r in rows:
                yield json.dumps(r, ensure_ascii=False) + "\n"
            cursor = rows[-1]["id"]

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={
            "Content-Disposition": 'attachment; filename="boardscope-evidence.jsonl"'
        },
    )


@app.get("/api/logs/stream")
async def stream(
    request: Request,
    board_id: str | None = None,
    run_id: str | None = None,
    source: str | None = None,
    after: int = 0,
):
    token = request.cookies.get("bs_session")

    async def events():
        cursor = after
        while security.session(token) and not await request.is_disconnected():
            rows = await run_in_threadpool(store.list, board_id, run_id, source, cursor)
            if rows:
                cursor = rows[-1]["id"]
                yield "data: " + json.dumps(rows) + "\n\n"
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
    )


@app.post("/api/boards/{id}/console")
async def console(id, request: Request):
    body = await request.json()
    cmd = body.get("command", "")
    if not cmd or len(cmd) > 8000:
        raise ValueError("Enter a command of at most 8000 characters")
    busy_guard(id)
    b = db.board(id)

    def execute():
        t = None
        try:
            t = connections.connect(b, lambda s: store.add(id, None, "event", s))
            result = dict(
                zip(
                    ("exit_status", "stdout", "stderr"),
                    t.command(
                        cmd,
                        min(engine.effective(b)["command_timeout"], 60),
                        emit=lambda source, text: store.add(
                            id, None, "console_" + source, text
                        ),
                    ),
                )
            )
            result["stdout"] = store.redact(result["stdout"])
            result["stderr"] = store.redact(result["stderr"])
            return result
        finally:
            if isinstance(t, connections.SSH):
                t.close()

    try:
        return await run_in_threadpool(execute)
    except Exception as e:
        raise ValueError(store.redact(str(e)))
    finally:
        engine.release(id, ["exclusive"])


@app.get("/api/ai/history")
def ai_history(board_id: str | None = None, run_id: str | None = None):
    with db.connect() as d:
        return [
            dict(r)
            for r in d.execute(
                "SELECT * FROM conversations WHERE board_id IS ? AND run_id IS ? ORDER BY id DESC LIMIT 20",
                (board_id, run_id),
            )
        ][::-1]


@app.post("/api/ai/ask")
async def ask(request: Request):
    b = await request.json()
    try:
        return await run_in_threadpool(
            ai.ask, b.get("board_id"), b.get("run_id"), b.get("question", "")
        )
    except Exception as e:
        raise ValueError("Local AI unavailable: " + store.redact(str(e)))


DIST = ROOT / "frontend/dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        return FileResponse(DIST / "index.html")
