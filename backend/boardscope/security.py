import os, json, secrets, hashlib, hmac, time
from cryptography.fernet import Fernet
from .config import DATA

sessions = {}
attempts = {}


class Vault:
    def __init__(self):
        DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
        p = DATA / "encryption.key"
        if not p.exists():
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(Fernet.generate_key())
        if p.stat().st_mode & 0o077:
            raise RuntimeError("encryption.key must have permissions 0600")
        self.fernet = Fernet(p.read_bytes())

    def encrypt(self, v):
        return self.fernet.encrypt(v.encode()).decode() if v else ""

    def decrypt(self, v):
        return self.fernet.decrypt(v.encode()).decode() if v else ""


def password_hash(password, salt):
    return hashlib.scrypt(
        password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1
    ).hex()


def set_password(password):
    if len(password) < 12:
        raise ValueError("Use at least 12 characters")
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    salt = secrets.token_hex(16)
    p = DATA / "auth.json"
    p.write_text(json.dumps({"salt": salt, "hash": password_hash(password, salt)}))
    p.chmod(0o600)


def login(password, ip):
    now = time.time()
    recent = [t for t in attempts.get(ip, []) if now - t < 60]
    if len(recent) >= 5:
        raise ValueError("Too many attempts; wait one minute")
    attempts[ip] = recent + [now]
    p = DATA / "auth.json"
    if not p.exists():
        raise ValueError("Run python -m boardscope setup in the agent terminal first")
    a = json.loads(p.read_text())
    if not hmac.compare_digest(password_hash(password, a["salt"]), a["hash"]):
        raise ValueError("Invalid password")
    for key, value in list(sessions.items()):
        if value["expires"] <= now:
            sessions.pop(key, None)
    if len(sessions) >= 100:
        sessions.pop(min(sessions, key=lambda key: sessions[key]["expires"]))
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    sessions[token] = {"csrf": csrf, "expires": now + 8 * 3600}
    attempts.pop(ip, None)
    return token, csrf


def session(token):
    s = sessions.get(token)
    return s if s and s["expires"] > time.time() else None


def public_board(b):
    b = json.loads(json.dumps(b))
    for c in b["connections"]:
        for k in ("password", "login_password", "key_passphrase"):
            if c.get(k):
                c[k + "_saved"] = True
            c.pop(k, None)
    return b
