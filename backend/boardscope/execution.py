import threading, queue, time, uuid, json, shlex, re
from . import db, connections
from .config import CONFIG
from .logs import store, EvidenceFull
from .catalog import CATALOG

ACTIVE = ("queued", "running", "cancelling")


class Prerequisite(Exception):
    pass


class AssertionFailure(Exception):
    pass


class Engine:
    def __init__(self):
        self.q = queue.Queue(maxsize=64)
        self.stop = threading.Event()
        self.cancels = {}
        self.busy = {}
        self.gate = threading.RLock()
        self.threads = []

    def start(self):
        for i in range(4):
            t = threading.Thread(
                target=self.worker, daemon=True, name=f"boardscope-worker-{i}"
            )
            t.start()
            self.threads.append(t)

    def shutdown(self):
        self.stop.set()
        for event in self.cancels.values():
            event.set()
        for t in self.threads:
            t.join(timeout=3)

    def active(self, board_id):
        return [r for r in db.runs(1000, board_id=board_id) if r["state"] in ACTIVE]

    def effective(self, b):
        return CONFIG["defaults"] | b.get("overrides", {})

    def submit(self, b, items, suite=None):
        if self.q.full():
            raise ValueError("Job queue is full; wait for queued work")
        if len(items) > 20 or not items:
            raise ValueError("A plan needs 1–20 stages")
        id = uuid.uuid4().hex
        settings = self.effective(b)
        plan = []
        for item in items:
            definition = CATALOG[item["test"]]
            p = item.get("parameters", {})
            if store.redact(json.dumps(p, sort_keys=True)) != json.dumps(
                p, sort_keys=True
            ):
                raise ValueError(
                    "Do not embed saved credentials in test parameters or scripts; use target-side credential references"
                )
            if item["test"] == "custom":
                if not p.get("script") or len(p["script"]) > 65536:
                    raise ValueError("A reviewed script of at most 64 KiB is required")
                if not item.get("confirmed"):
                    raise ValueError("Review and confirm custom script execution")
            if item["test"] == "reboot" and not item.get("confirmed"):
                raise ValueError("Explicit reboot confirmation required")
            if item["test"] == "connectivity":
                connections.private_host(p.get("destination", ""))
            plan.append({"definition": definition, "parameters": p})
        r = {
            "name": suite or plan[0]["definition"]["name"],
            "plan": plan,
            "settings": settings,
            "board_snapshot": __import__(
                "boardscope.security", fromlist=["public_board"]
            ).public_board(b),
            "step": "Queued",
            "transport": None,
            "started": None,
            "timeout": sum(
                (
                    settings["reboot_recovery_timeout"]
                    if p["definition"]["id"] == "reboot"
                    else min(p["definition"]["timeout"], settings["command_timeout"])
                )
                for p in plan
            ),
            "failure_category": None,
            "error": None,
            "cleanup": None,
            "evidence": [],
        }
        with db.connect() as d:
            d.execute(
                "INSERT INTO runs VALUES(?,?,?,?,?,?)",
                (id, b["id"], "queued", time.time(), None, json.dumps(r)),
            )
        self.cancels[id] = threading.Event()
        self.q.put_nowait(id)
        return id

    def cancel(self, id):
        r = db.run(id)
        if r["state"] not in ACTIVE:
            raise ValueError("Run is no longer active")
        self.cancels.setdefault(id, threading.Event()).set()
        if r["state"] == "queued":
            db.update_run(
                id,
                state="cancelled",
                finished=time.time(),
                error="Cancelled while queued; no target process started",
                failure_category="cancellation",
            )
        else:
            db.update_run(id, state="cancelling")

    def acquire(self, board_id, resources):
        with self.gate:
            existing = self.busy.get(board_id, [])
            if existing and (
                "exclusive" in resources
                or any(
                    "exclusive" in x or set(x) & set(resources) - {"read"}
                    for x in existing
                )
            ):
                return False
            self.busy.setdefault(board_id, []).append(resources)
            return True

    def release(self, board_id, resources):
        with self.gate:
            self.busy[board_id].remove(resources)

    def resources(self, r, b):
        rs = list({x for p in r["plan"] for x in p["definition"]["resources"]})
        # UART recovery may occur at any command boundary. Reserve shell across a run
        # for dual/UART boards to prevent interactive or parallel interleaving.
        if any(c["type"] == "uart" for c in b["connections"]):
            rs = ["exclusive"]
        return rs

    def worker(self):
        while not self.stop.is_set():
            try:
                id = self.q.get(timeout=0.3)
            except queue.Empty:
                continue
            r = db.run(id)
            if r["state"] not in ACTIVE:
                self.cancels.pop(id, None)
                self.q.task_done()
                continue
            b = db.board(r["board_id"])
            resources = self.resources(r, b)
            if not self.acquire(b["id"], resources):
                self.q.task_done()
                try:
                    self.q.put_nowait(id)
                except queue.Full:
                    db.update_run(
                        id,
                        state="infrastructure_error",
                        finished=time.time(),
                        error="Queue admission failed",
                    )
                time.sleep(0.2)
                continue
            try:
                self.execute(id, b)
            finally:
                self.release(b["id"], resources)
                self.q.task_done()

    def execute(self, id, b):
        cancel = self.cancels[id]
        t = None
        r = db.run(id)
        state = "passed"
        changes = {}

        def emit(source, text):
            store.add(b["id"], id, source, text)

        def event(text):
            emit("event", text)

        def command(cmd, timeout):
            if cancel.is_set():
                raise connections.Cancelled("Cancelled before command submission")
            result = t.command(cmd, timeout, cancel, emit, id)
            db.update_run(id, exit_status=result[0])
            return result

        try:
            if cancel.is_set():
                raise connections.Cancelled(
                    "Cancelled while queued; no target process started"
                )
            db.update_run(id, state="running", started=time.time())
            event("Run " + id + " started; effective settings captured")
            for index, item in enumerate(r["plan"]):
                definition = item["definition"]
                kind = definition["id"]
                p = item["parameters"]
                timeout = min(r["settings"]["command_timeout"], definition["timeout"])
                db.update_run(
                    id,
                    step=f"Stage {index+1}/{len(r['plan'])}: {definition['name']} — prerequisites",
                )
                if kind == "connectivity" and not any(
                    c["type"] == "ssh" for c in b["connections"]
                ):
                    raise Prerequisite(
                        "Network test requires an SSH network control connection; UART cannot replace networking"
                    )
                if isinstance(t, connections.SSH):
                    t.close()
                t = connections.connect(b, event, kind == "connectivity")
                db.update_run(id, transport=t.name)
                required = (
                    "uname cat"
                    + (" ping" if kind == "connectivity" else "")
                    + (" setsid" if t.name == "SSH" else "")
                )
                # SSH launcher requires setsid; shell return 127 is classified as prerequisite.
                code, out, err = command(
                    f'for x in {required}; do command -v "$x" || exit 127; done; test "$(uname -s)" = Linux || exit 127; if test -r /etc/os-release; then . /etc/os-release; fi; printf "BS_OS=%s\\n" "$PRETTY_NAME"; printf "BS_KERNEL="; uname -r',
                    timeout,
                )
                if code:
                    raise Prerequisite(
                        "Linux shell or required tool unavailable: " + out + err
                    )
                for field, key in [("BS_OS", "os"), ("BS_KERNEL", "kernel")]:
                    match = re.search(r"(?m)^" + field + r"=([^\r\n]+)", out)
                    if match:
                        b["metadata"][key] = store.redact(match.group(1))
                verified = b.setdefault("verification", {}).setdefault(
                    "connections", []
                )
                kind_key = "ssh" if t.name == "SSH" else "uart"
                verified[:] = [v for v in verified if v["type"] != kind_key] + [
                    {
                        "type": kind_key,
                        "state": "linux_shell_verified",
                        "verified_at": time.time(),
                    }
                ]
                db.save_board(b)
                db.update_run(
                    id,
                    detected_metadata=dict(b["metadata"]),
                    step=f"Stage {index+1}/{len(r['plan'])}: {definition['name']}",
                )
                if kind == "inventory":
                    code, out, err = command(
                        "cat /etc/os-release && uname -a && cat /proc/sys/kernel/random/boot_id && cat /proc/meminfo && cat /proc/cpuinfo",
                        timeout,
                    )
                    if code == 127:
                        raise Prerequisite("Inventory target tool is missing")
                    if code:
                        raise AssertionFailure("Inventory command failed")
                elif kind == "connectivity":
                    # Pin an agent-resolved private IP to prevent target-side DNS rebinding.
                    destination = connections.private_host(p["destination"])
                    code, out, err = command(
                        "ping -c 3 -W 2 " + shlex.quote(destination), timeout
                    )
                    if code == 127:
                        raise Prerequisite("Target ping executable is missing")
                    if code:
                        raise AssertionFailure(
                            "Expected three ICMP probes to succeed; ping exited "
                            + str(code)
                        )
                elif kind == "custom":
                    code, out, err = command(p["script"], timeout)
                    if code in (126, 127):
                        raise Prerequisite(
                            "Custom script dependency is missing or not executable (exit "
                            + str(code)
                            + ")"
                        )
                    if code != int(p.get("expected_exit") or 0):
                        raise AssertionFailure(
                            f'Expected exit {p.get("expected_exit",0)}, got {code}'
                        )
                elif kind == "reboot":
                    code, out, _ = command(
                        "cat /proc/sys/kernel/random/boot_id", timeout
                    )
                    old = reboot_id(out)
                    if code or not old:
                        raise Prerequisite("Could not read Linux boot identity")
                    # sudo -n never prompts for or exposes a sudo password.
                    code, _, _ = command('test "$(id -u)" = 0 || sudo -n true', timeout)
                    if code:
                        raise Prerequisite(
                            "Reboot requires root or configured noninteractive sudo"
                        )
                    event(
                        "Submitting one reboot request. Disconnect is expected; request will never be replayed."
                    )
                    try:
                        command(
                            'if test "$(id -u)" = 0; then reboot; else sudo -n reboot; fi',
                            10,
                        )
                    except (connections.Uncertain, TimeoutError):
                        pass
                    if isinstance(t, connections.SSH):
                        t.close()
                    deadline = (
                        time.monotonic() + r["settings"]["reboot_recovery_timeout"]
                    )
                    attempts = 0
                    recovered = False
                    while (
                        time.monotonic() < deadline
                        and attempts < r["settings"]["reconnect_limits"]
                    ):
                        if cancel.wait(min(5, max(0.1, deadline - time.monotonic()))):
                            raise connections.Cancelled(
                                "Recovery wait cancelled; reboot may already have occurred"
                            )
                        attempts += 1
                        try:
                            t = connections.connect(b, event)
                            db.update_run(id, transport=t.name)
                            code, out, _ = command(
                                "cat /proc/sys/kernel/random/boot_id", 10
                            )
                            new = reboot_id(out)
                            if not code and new and new != old:
                                recovered = True
                                break
                        except (connections.TransportError, OSError, TimeoutError):
                            continue
                    if not recovered:
                        raise connections.Uncertain(
                            "Reboot recovery did not prove a changed boot ID before timeout/reconnect limit"
                        )
                    event("Reboot recovered with changed Linux boot identity")
                if code == 127:
                    raise Prerequisite("Target command or script dependency is missing")
                evidence = db.run(id)["evidence"]
                evidence.append({"stage": index + 1, "exit_status": code, "test": kind})
                db.update_run(id, evidence=evidence)
                event("Stage completed: " + definition["name"])
        except connections.Cancelled as e:
            state = "cancelled"
            changes = {
                "error": str(e),
                "failure_category": "cancellation",
                "cleanup": "See execution events; UART or lost-transport cleanup may be unconfirmed",
            }
        except Prerequisite as e:
            state = "blocked"
            changes = {"error": str(e), "failure_category": "prerequisite"}
        except AssertionFailure as e:
            state = "failed"
            changes = {"error": str(e), "failure_category": "assertion"}
        except TimeoutError as e:
            state = "timed_out"
            changes = {
                "error": str(e),
                "failure_category": "timeout",
                "cleanup": "Cleanup attempted; see events",
            }
        except connections.Uncertain as e:
            state = "interrupted"
            changes = {"error": str(e), "failure_category": "uncertain_remote_state"}
        except Exception as e:
            state = "infrastructure_error"
            changes = {
                "error": store.redact(type(e).__name__ + ": " + str(e)),
                "failure_category": "infrastructure",
            }
        finally:
            if isinstance(t, connections.SSH):
                t.close()
            try:
                store.flush(b["id"], id)
                event("Run finished: " + state + " " + changes.get("error", ""))
            except Exception as e:
                state = "infrastructure_error"
                changes["error"] = "Evidence persistence failed: " + str(e)
            db.update_run(
                id, state=state, finished=time.time(), step="Completed", **changes
            )
            self.cancels.pop(id, None)


def reboot_id(out):
    import re

    m = re.search(r"(?m)^([a-f0-9]{8}-[a-f0-9-]{27,})\r?$", out)
    return m.group(1) if m else None


engine = Engine()
