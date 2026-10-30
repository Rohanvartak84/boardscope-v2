import time, re, threading, base64
from . import db
from .config import DATA, CONFIG


class EvidenceFull(Exception):
    pass


class LogStore:
    def __init__(self):
        self.secrets = set()
        self.lock = threading.RLock()
        self.pending = {}

    def register(self, value):
        with self.lock:
            if value:
                self.secrets.add(value)

    def redact(self, s):
        with self.lock:
            for value in sorted(self.secrets, key=len, reverse=True):
                if value:
                    s = s.replace(value, "[REDACTED]")
        return s

    def add(self, board, run, source, raw):
        if isinstance(raw, str):
            raw = raw.encode()
        # Secrets are removed before evidence is persisted; preserve remaining bytes exactly.
        with self.lock:
            key = (board, run, source)
            raw = self.pending.pop(key, b"") + raw
            values = [
                v.encode() for v in sorted(self.secrets, key=len, reverse=True) if v
            ]
            for value in values:
                raw = raw.replace(value, b"[REDACTED]")
            # Hold only a possible trailing secret prefix across capture chunks.
            hold = max(
                (
                    n
                    for value in values
                    for n in range(1, min(len(value), len(raw) + 1))
                    if raw.endswith(value[:n])
                ),
                default=0,
            )
            if hold:
                self.pending[key] = raw[-hold:]
                raw = raw[:-hold]
            if not raw:
                return
        with self.lock, db.connect() as d:
            cached = d.execute(
                "SELECT value FROM meta WHERE key='evidence_bytes'"
            ).fetchone()
            used = (
                int(cached[0])
                if cached
                else d.execute(
                    "SELECT COALESCE(SUM(length(raw)),0) FROM logs"
                ).fetchone()[0]
            )
            if used + len(raw) > CONFIG["max_log_bytes"]:
                raise EvidenceFull(
                    "Evidence quota reached; capture stopped explicitly. Export/archive evidence and increase max_log_bytes before retrying."
                )
            d.execute(
                "INSERT INTO logs(board_id,run_id,source,timestamp,raw) VALUES(?,?,?,?,?)",
                (board, run, source, time.time(), raw),
            )
            d.execute(
                "INSERT OR REPLACE INTO meta VALUES('evidence_bytes',?)",
                (str(used + len(raw)),),
            )

    def flush(self, board, run=None):
        with self.lock:
            keys = [k for k in self.pending if k[0] == board and k[1] == run]
            for k in keys:
                self.pending.pop(k, None)
                self.add(*k, b"[REDACTED PARTIAL SECRET]")

    def list(self, board=None, run=None, source=None, after=0, before=None, limit=300):
        q = "SELECT * FROM logs WHERE id>?"
        args = [after]
        for k, v in [("board_id", board), ("run_id", run), ("source", source)]:
            if v:
                q += f" AND {k}=?"
                args.append(v)
        if before:
            q += " AND id<?"
            args.append(before)
        with db.connect() as d:
            rows = d.execute(
                q + " ORDER BY id " + ("DESC" if before else "ASC") + " LIMIT ?",
                (*args, min(limit, 500)),
            ).fetchall()
        out = [
            dict(r)
            | {
                "raw": bytes(r["raw"]).decode("utf-8", errors="replace"),
                "raw_base64": base64.b64encode(bytes(r["raw"])).decode(),
            }
            for r in rows
        ]
        return list(reversed(out)) if before else out


store = LogStore()


def display_text(value):
    return re.sub(
        r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|$))", "", value
    ).replace("\r", "")
