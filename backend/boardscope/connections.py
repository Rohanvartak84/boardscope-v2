"""One serial owner per endpoint; command gates are shared by all callers."""

import base64, hashlib, threading, time, uuid, re, shlex, socket
from pathlib import Path
import paramiko, serial
from serial.tools import list_ports
from .config import CONFIG, DATA, private_host
from .security import Vault
from .logs import store


class TransportError(Exception):
    pass


class Uncertain(TransportError):
    pass


class Cancelled(Exception):
    pass


class HostTrust(TransportError):
    def __init__(self, host, port, fingerprint, changed=False):
        super().__init__(
            "SSH host key changed; verify on the agent and remove the old trust entry manually."
            if changed
            else "SSH host key requires explicit fingerprint approval."
        )
        self.details = {
            "host": host,
            "port": port,
            "fingerprint": fingerprint,
            "changed": changed,
        }


vault = None
registry = {}
registry_lock = threading.RLock()
capture_errors = {}


def init():
    global vault
    vault = Vault()
    for p in (Path(CONFIG["key_directory"]).expanduser(),):
        p.mkdir(parents=True, exist_ok=True, mode=0o700)
    from . import db

    for b in db.boards():
        for c in b["connections"]:
            for field in ("password", "login_password", "key_passphrase"):
                if c.get(field):
                    store.register(vault.decrypt(c[field]))


def fingerprint(key):
    return "SHA256:" + base64.b64encode(
        hashlib.sha256(key.asbytes()).digest()
    ).decode().rstrip("=")


def keys():
    root = Path(CONFIG["key_directory"]).expanduser().resolve()
    return [
        p.name
        for p in root.iterdir()
        if p.is_file() and not p.is_symlink() and p.suffix != ".pub"
    ]


def key_path(name):
    root = Path(CONFIG["key_directory"]).expanduser().resolve()
    p = (root / name).resolve()
    if p.parent != root or name not in keys():
        raise ValueError("Choose a key from the approved agent key directory")
    if p.stat().st_mode & 0o077:
        raise ValueError("SSH key permissions must be 0600")
    return str(p)


class TrustPolicy(paramiko.MissingHostKeyPolicy):
    def __init__(self, c, approve=None):
        self.c = c
        self.approve = approve

    def missing_host_key(self, client, hostname, key):
        fp = fingerprint(key)
        if self.approve != fp:
            raise HostTrust(self.c["host"], self.c.get("port", 22), fp)
        client.get_host_keys().add(hostname, key.get_name(), key)
        client.save_host_keys(str(DATA / "known_hosts"))
        (DATA / "known_hosts").chmod(0o600)


class SSH:
    name = "SSH"

    def __init__(self, c, approve=None):
        self.c = c
        self.client = paramiko.SSHClient()
        private_ip = private_host(c["host"])
        p = DATA / "known_hosts"
        if p.exists():
            self.client.load_host_keys(str(p))
        self.client.set_missing_host_key_policy(TrustPolicy(c, approve))
        kw = {
            "hostname": c["host"],
            "port": c.get("port", 22),
            "username": c["username"],
            "timeout": 8,
            "banner_timeout": 8,
            "auth_timeout": 8,
            "look_for_keys": False,
            "allow_agent": False,
        }
        if c.get("auth", "password") == "key":
            kw.update(
                key_filename=key_path(c["key_ref"]),
                passphrase=vault.decrypt(c.get("key_passphrase", "")) or None,
            )
        else:
            kw["password"] = vault.decrypt(c.get("password", ""))
        try:
            kw["sock"] = socket.create_connection(
                (private_ip, c.get("port", 22)), timeout=8
            )
            self.client.connect(**kw)
        except paramiko.BadHostKeyException as e:
            self.close()
            raise HostTrust(
                c["host"], c.get("port", 22), fingerprint(e.key), True
            ) from e
        except Exception:
            self.close()
            raise

    def close(self):
        self.client.close()

    def command(self, cmd, timeout, cancel=None, emit=None, run_id=None):
        ident = uuid.uuid4().hex
        evidence = f"/tmp/boardscope-{ident}"
        # Background session leader is tracked in a private per-execution directory.
        payload=f'echo $$ >{evidence}/pid; exec sh -c {shlex.quote(cmd)}'
        wrapper = f"umask 077; mkdir {evidence} || exit 125; setsid -w sh -c {shlex.quote(payload)} & p=$!; wait $p; r=$?; echo $r >{evidence}/status; exit $r"
        try:
            channel = self.client.get_transport().open_session(timeout=8)
            channel.exec_command(wrapper)
        except Exception as e:
            raise Uncertain(
                "SSH submission failed; command may have started. It will not be replayed."
            ) from e
        start = time.monotonic()
        out = []
        err = []
        try:
            while True:
                for stderr, parts in ((False, out), (True, err)):
                    ready = channel.recv_stderr_ready if stderr else channel.recv_ready
                    recv = channel.recv_stderr if stderr else channel.recv
                    while ready():
                        raw_chunk = recv(8192)
                        chunk = raw_chunk.decode(errors="replace")
                        parts.append(chunk)
                        if sum(map(len, parts)) > 65536:
                            parts[:] = ["".join(parts)[-65536:]]
                        if emit:
                            emit("stderr" if stderr else "stdout", raw_chunk)
                if (
                    channel.exit_status_ready()
                    and not channel.recv_ready()
                    and not channel.recv_stderr_ready()
                ):
                    code = channel.recv_exit_status()
                    if code < 0:
                        raise Uncertain(
                            f"SSH closed without completion evidence; inspect {evidence}. No automatic replay."
                        )
                    try:
                        self.client.exec_command(f"rm -rf {evidence}", timeout=3)
                    except Exception:
                        pass
                    return code, "".join(out), "".join(err)
                if cancel and cancel.is_set():
                    self.cleanup(evidence, emit)
                    raise Cancelled(
                        "Cancellation requested; tracked process cleanup attempted"
                    )
                if time.monotonic() - start > timeout:
                    self.cleanup(evidence, emit)
                    raise TimeoutError(
                        "Command timeout; tracked process cleanup attempted"
                    )
                if (
                    not self.client.get_transport()
                    or not self.client.get_transport().is_active()
                ):
                    raise Uncertain(
                        f"SSH lost during execution; inspect {evidence}. Remote process state is uncertain; no replay."
                    )
                time.sleep(0.05)
        finally:
            channel.close()

    def cleanup(self, evidence, emit):
        try:
            _, out, err = self.client.exec_command(
                f'p=$(cat {evidence}/pid) || exit 1; case "$p" in ""|*[!0-9]*) exit 1;; esac; kill -TERM -"$p" 2>/dev/null || true; sleep 1; kill -KILL -"$p" 2>/dev/null || true; for i in 1 2 3 4 5 6 7 8 9 10; do test ! -e /proc/"$p" && exit 0; sleep 0.2; done; exit 1',
                timeout=5,
            )
            code = out.channel.recv_exit_status()
            if code and emit:
                _,diagnostic,_=self.client.exec_command(f'p=$(cat {evidence}/pid); ps -o pid,ppid,pgid,sid,stat,args -p "$p"',timeout=3)
                emit('event','Cleanup diagnostic: '+diagnostic.read(4096).decode(errors='replace'))
            if emit:
                emit(
                    "event",
                    "Cleanup "
                    + (
                        "confirmed process gone"
                        if code == 0
                        else "unconfirmed; inspect target process state"
                    ),
                )
        except Exception:
            if emit:
                emit(
                    "event",
                    "Cleanup failed: transport unavailable; remote processes may still be running",
                )


class UART:
    name = "UART"

    def __init__(self, c, board_id):
        self.c = c
        self.board_id = board_id
        self.gate = threading.Lock()
        self.cv = threading.Condition()
        self.buffer = bytearray()
        self.total = 0
        self.error = None
        self.closed = False
        advanced = c.get("advanced", {})
        self.port = serial.Serial(
            c["device"],
            c.get("baud", 115200),
            timeout=0.1,
            exclusive=True,
            bytesize=advanced.get("bytesize", 8),
            parity=advanced.get("parity", "N"),
            stopbits=advanced.get("stopbits", 1),
            xonxoff=advanced.get("xonxoff", False),
            rtscts=advanced.get("rtscts", False),
        )
        self.thread = threading.Thread(target=self.read, daemon=True)
        self.thread.start()

    def read(self):
        while not self.closed:
            try:
                chunk = self.port.read(4096)
                if not chunk:
                    continue
                with self.cv:
                    self.buffer.extend(chunk)
                    self.total += len(chunk)
                    if len(self.buffer) > 1024 * 1024:
                        del self.buffer[: -1024 * 1024]
                    self.cv.notify_all()
                if self.board_id and self.c.get("capture", True):
                    store.add(self.board_id, None, "uart", chunk)
            except Exception as e:
                self.error = str(e)
                self.closed = True
                if self.board_id:
                    capture_errors[self.board_id] = (
                        "UART capture stopped: " + self.error
                    )
                try:
                    store.add(
                        self.board_id,
                        None,
                        "event",
                        "UART capture stopped: " + self.error,
                    )
                except Exception:
                    pass
                break

    def close(self):
        self.closed = True
        self.port.close()
        self.thread.join(timeout=1)
        if self.board_id:
            try:
                store.flush(self.board_id)
            except Exception as e:
                capture_errors[self.board_id] = str(e)

    def since(self, start):
        with self.cv:
            base = self.total - len(self.buffer)
            if start < base:
                raise Uncertain(
                    "UART receive buffer gap detected; command outcome uncertain"
                )
            return bytes(self.buffer[start - base :])

    def probe(self):
        with self.gate:
            token = "BS" + uuid.uuid4().hex
            start = self.total
            self.port.write(
                (
                    "\nprintf '%s%s\\n' '"
                    + token[:12]
                    + "' '"
                    + token[12:]
                    + "'; uname -s\n"
                ).encode()
            )
            until = time.monotonic() + 5
            while time.monotonic() < until:
                text = self.since(start).decode(errors="replace")
                if re.search(r"(?m)^" + token + r"\r?\nLinux\r?$", text):
                    return "linux_shell_verified"
                time.sleep(0.1)
            if re.search(r"login:|[Pp]assword:", text):
                return "login_required"
            return "output_observed" if text.strip() else "port_opened"

    def login(self):
        if not self.c.get("login_username"):
            return
        with self.gate:
            self.port.write((self.c["login_username"] + "\n").encode())
            time.sleep(0.5)
            if self.c.get("login_password"):
                value = vault.decrypt(self.c["login_password"])
                store.register(value)
                self.port.write((value + "\n").encode())
                time.sleep(0.5)

    def command(self, cmd, timeout, cancel=None, emit=None, run_id=None):
        with self.gate:
            marker = "END" + uuid.uuid4().hex
            start = self.total
            # Split marker in the submitted text so terminal echo cannot impersonate completion.
            payload = f"sh -c {shlex.quote(cmd)}; rc=$?; printf '\\n%s%s:%s\\n' '{marker[:12]}' '{marker[12:]}' \"$rc\"\n"
            self.port.write(payload.encode())
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if self.closed:
                    raise Uncertain(
                        "UART disconnected; command completion unknown. No replay."
                    )
                data = self.since(start).decode(errors="replace")
                m = re.search(r"(?m)^" + marker + r":(\d+)\r?$", data)
                if m:
                    # Preserve serial raw separately; command echo is not run stdout.
                    output = data[: m.start()]
                    lines = output.splitlines()
                    output = "\n".join(x for x in lines if payload.strip() not in x)
                    if emit:
                        emit("stdout", output)
                    return int(m.group(1)), output, ""
                if cancel and cancel.is_set():
                    self.port.write(b"\x03")
                    raise Cancelled(
                        "UART Ctrl-C sent; process cleanup unconfirmed. Reverify shell before reuse."
                    )
                time.sleep(0.05)
            self.port.write(b"\x03")
            raise TimeoutError("UART timeout; Ctrl-C sent; remote cleanup unconfirmed")


def serial_owner(c, board_id):
    with registry_lock:
        obj = registry.get(c["device"])
        if obj and (obj.board_id != board_id or obj.c != c):
            raise TransportError(
                "Serial endpoint already owned by another session/configuration; close it or disable capture first"
            )
        if obj and obj.closed:
            obj.close()
            registry.pop(c["device"])
            obj = None
        if not obj:
            obj = UART(c, board_id)
            registry[c["device"]] = obj
        return obj


def release(board_id):
    with registry_lock:
        for key, obj in list(registry.items()):
            if obj.board_id == board_id:
                obj.close()
                registry.pop(key)


def ports():
    return [
        {"device": p.device, "description": p.description}
        for p in list_ports.comports()
    ]


def connect(board, event=lambda s: None, require_network=False):
    errors = []
    for c in sorted(board["connections"], key=lambda c: c["type"] != "ssh"):
        if c["type"] == "uart" and require_network:
            continue
        try:
            if c["type"] == "ssh":
                t = SSH(c)
            else:
                t = serial_owner(c, board["id"])
            if isinstance(t, UART) and t.probe() != "linux_shell_verified":
                raise TransportError(
                    "UART Linux shell not verified; check console/login/baud"
                )
            event(
                "Active transport: "
                + t.name
                + (" (automatic recovery)" if errors else "")
            )
            return t
        except Exception as e:
            errors.append(type(e).__name__ + ": " + str(e))
            event(c["type"].upper() + " unavailable: " + str(e))
    raise TransportError("; ".join(errors) or "Required connection is not configured")


def verify(board, approvals=None, temporary=False):
    results = []
    metadata = {}
    approvals = approvals or {}
    for i, c in enumerate(board["connections"]):
        t = None
        try:
            if c["type"] == "ssh":
                t = SSH(c, approvals.get(str(i)))
            else:
                t = serial_owner(c, board["id"])
            state = "linux_shell_verified" if isinstance(t, SSH) else t.probe()
            if state == "login_required" and c.get("login_username"):
                t.login()
                state = t.probe()
            result = {
                "type": c["type"],
                "state": state,
                "verified_at": time.time() if state == "linux_shell_verified" else None,
            }
            if state == "linux_shell_verified":
                code, out, _ = t.command(
                    "printf 'BS_OS='; . /etc/os-release 2>/dev/null; printf '%s\\n' \"$PRETTY_NAME\"; printf 'BS_KERNEL='; uname -r",
                    10,
                )
                for label, key in [("BS_OS", "os"), ("BS_KERNEL", "kernel")]:
                    m = re.search(r"(?m)^" + label + r"=([^\r\n]+)", out)
                    if m:
                        metadata[key] = m.group(1)
            else:
                result["error"] = (
                    "Port opened but no Linux shell evidence. Check console, baud and login prompt."
                )
            results.append(result)
        except HostTrust as e:
            results.append(
                {
                    "type": c["type"],
                    "state": (
                        "host_key_changed" if e.details["changed"] else "trust_required"
                    ),
                    "error": str(e),
                    "trust": e.details,
                }
            )
        except Exception as e:
            results.append(
                {
                    "type": c["type"],
                    "state": "disconnected",
                    "error": str(e)
                    + "; check endpoint, credentials, permissions and agent access.",
                }
            )
        finally:
            if isinstance(t, SSH):
                t.close()
    if temporary:
        release(board["id"])
    return {"connections": results, "metadata": metadata}


def start_capture(board):
    for c in board["connections"]:
        if c["type"] == "uart" and c.get("capture", True):
            try:
                serial_owner(c, board["id"])
                store.add(
                    board["id"],
                    None,
                    "event",
                    "UART capture port opened; shell reachability is not established by opening a port.",
                )
            except Exception as e:
                capture_errors[board["id"]] = (
                    "UART capture unavailable: "
                    + str(e)
                    + "; check port presence, evidence quota and agent permissions."
                )
                try:
                    store.add(board["id"], None, "event", capture_errors[board["id"]])
                except Exception:
                    release(board["id"])


def close():
    for obj in list(registry.values()):
        obj.close()
    registry.clear()
