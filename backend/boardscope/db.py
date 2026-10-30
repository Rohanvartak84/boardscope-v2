import sqlite3, json, threading, time
from contextlib import contextmanager
from .config import DATA

lock = threading.RLock()


def init():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    DATA.chmod(0o700)
    with connect() as db:
        db.executescript(
            """
        CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO migrations VALUES(1);
        CREATE TABLE IF NOT EXISTS boards(id TEXT PRIMARY KEY, data TEXT NOT NULL, removed INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS suites(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, board_id TEXT, state TEXT, created REAL, finished REAL, data TEXT);
        CREATE INDEX IF NOT EXISTS runs_board_state ON runs(board_id,state,created);
        CREATE INDEX IF NOT EXISTS runs_finished ON runs(state,finished);
        CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT, run_id TEXT, source TEXT, timestamp REAL, raw BLOB);
        CREATE INDEX IF NOT EXISTS logs_context ON logs(board_id,run_id,id);
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY, board_id TEXT, run_id TEXT, timestamp REAL, question TEXT, answer TEXT);
        """
        )
        db.execute(
            "UPDATE runs SET state='interrupted', finished=?, data=json_set(data,'$.error','Agent restarted; remote processes may still be running. Inspect the target before retrying.','$.failure_category','agent_restart') WHERE state IN ('running','queued','cancelling')",
            (time.time(),),
        )
    (DATA / "boardscope.sqlite3").chmod(0o600)


@contextmanager
def connect():
    with lock:
        db = sqlite3.connect(DATA / "boardscope.sqlite3", timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except:
            db.rollback()
            raise
        finally:
            db.close()


def boards():
    with connect() as db:
        return [
            json.loads(r["data"])
            for r in db.execute("SELECT data FROM boards WHERE removed=0")
        ]


def board(id):
    with connect() as db:
        r = db.execute(
            "SELECT data FROM boards WHERE id=? AND removed=0", (id,)
        ).fetchone()
    if not r:
        raise ValueError("Board not found")
    return json.loads(r["data"])


def save_board(b):
    with connect() as db:
        db.execute(
            "INSERT OR REPLACE INTO boards(id,data,removed) VALUES(?,?,0)",
            (b["id"], json.dumps(b)),
        )


def runs(limit=100, offset=0, board_id=None, state=None):
    query = "SELECT * FROM runs WHERE 1=1"
    args = []
    if board_id:
        query += " AND board_id=?"
        args.append(board_id)
    if state:
        query += " AND state=?"
        args.append(state)
    with connect() as db:
        rows = db.execute(
            query + " ORDER BY created DESC LIMIT ? OFFSET ?", (*args, limit, offset)
        ).fetchall()
    return [
        json.loads(r["data"])
        | {k: r[k] for k in ("id", "board_id", "state", "created", "finished")}
        for r in rows
    ]


def run(id):
    with connect() as db:
        r = db.execute("SELECT * FROM runs WHERE id=?", (id,)).fetchone()
    if not r:
        raise ValueError("Run not found")
    return json.loads(r["data"]) | {
        k: r[k] for k in ("id", "board_id", "state", "created", "finished")
    }


def update_run(id, **changes):
    r = run(id)
    r.update(changes)
    with connect() as db:
        db.execute(
            "UPDATE runs SET state=?,finished=?,data=? WHERE id=?",
            (r["state"], r.get("finished"), json.dumps(r), id),
        )
