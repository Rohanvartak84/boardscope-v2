"""Loopback SSH server and POSIX pseudo-terminal; no physical board claims."""

import os, socket, threading, time, subprocess, pty, select
import pytest, paramiko
from boardscope import connections, db
from boardscope.execution import engine
from boardscope.logs import store
from test_api import wait


class Server(paramiko.ServerInterface):
    def check_auth_password(self, u, p):
        return (
            paramiko.AUTH_SUCCESSFUL
            if (u, p) == ("tester", "ssh-test-password")
            else paramiko.AUTH_FAILED
        )

    def get_allowed_auths(self, u):
        return "password"

    def check_channel_request(self, k, i):
        return (
            paramiko.OPEN_SUCCEEDED
            if k == "session"
            else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
        )

    def check_channel_exec_request(self, channel, command):
        def execute():
            time.sleep(0.05)
            proc = subprocess.Popen(
                command.decode(),
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            def pump(pipe, stderr):
                try:
                    while chunk := pipe.read1(4096):
                        if stderr:
                            channel.send_stderr(chunk)
                        else:
                            channel.sendall(chunk)
                except (OSError, EOFError):
                    pass

            a = threading.Thread(target=pump, args=(proc.stdout, False))
            b = threading.Thread(target=pump, args=(proc.stderr, True))
            a.start()
            b.start()
            proc.wait()
            a.join()
            b.join()
            try:
                channel.send_exit_status(proc.returncode)
                channel.close()
            except Exception:
                pass

        threading.Thread(target=execute, daemon=True).start()
        return True


@pytest.fixture
def ssh_server():
    key = paramiko.RSAKey.generate(2048)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    sock.settimeout(0.2)
    stop = threading.Event()
    transports = []

    def loop():
        while not stop.is_set():
            try:
                s, _ = sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break

            def handle(s):
                t = paramiko.Transport(s)
                transports.append(t)
                t.add_server_key(key)
                try:
                    t.start_server(server=Server())
                    channels = []
                    while t.is_active() and not stop.is_set():
                        channel = t.accept(0.2)
                        if channel:
                            channels.append(channel)
                except (EOFError, paramiko.SSHException, OSError):
                    pass

            threading.Thread(target=handle, args=(s,), daemon=True).start()

    threading.Thread(target=loop, daemon=True).start()
    c = {
        "id": "ssh",
        "type": "ssh",
        "host": "127.0.0.1",
        "port": sock.getsockname()[1],
        "username": "tester",
        "auth": "password",
        "password": connections.vault.encrypt("ssh-test-password"),
    }
    yield c, key
    stop.set()
    sock.close()
    for t in transports:
        t.close()


def test_first_use_trust_real_ssh_host_key_and_change(client, ssh_server):
    c, key = ssh_server
    with pytest.raises(connections.HostTrust) as exc:
        connections.SSH(c)
    assert exc.value.details["fingerprint"] == connections.fingerprint(key)
    t = connections.SSH(c, connections.fingerprint(key))
    code, out, err = t.command(
        "printf real-ssh-evidence; printf stderr-evidence >&2", 5
    )
    t.close()
    assert code == 0
    assert out == "real-ssh-evidence"
    assert err == "stderr-evidence"
    known = paramiko.HostKeys()
    known.load(str(connections.DATA / "known_hosts"))
    known.add(f"[127.0.0.1]:{c['port']}", "ssh-rsa", paramiko.RSAKey.generate(2048))
    known.save(str(connections.DATA / "known_hosts"))
    with pytest.raises(connections.HostTrust) as exc:
        connections.SSH(c, connections.fingerprint(key))
    assert exc.value.details["changed"] is True


def test_real_ssh_inventory_suite_assertion_and_cancellation(client, ssh_server):
    c, key = ssh_server
    t = connections.SSH(c, connections.fingerprint(key))
    t.close()
    b = {
        "id": "transport-board",
        "name": "Transport lab",
        "connections": [c],
        "overrides": {},
        "metadata": {},
        "verification": {"connections": []},
    }
    db.save_board(b)
    id = engine.submit(
        b,
        [
            {"test": "inventory"},
            {
                "test": "custom",
                "confirmed": True,
                "parameters": {"script": "printf custom-evidence", "expected_exit": 0},
            },
        ],
        "Smoke",
    )
    r = wait(id)
    assert r["state"] == "passed", r
    assert len(r["evidence"]) == 2
    assert any("custom-evidence" in l["raw"] for l in store.list(run=id, limit=500))
    id = engine.submit(
        b, [{"test": "custom", "confirmed": True, "parameters": {"script": "exit 7"}}]
    )
    assert wait(id)["state"] == "failed"
    id = engine.submit(
        b,
        [
            {
                "test": "custom",
                "confirmed": True,
                "parameters": {"script": "echo before-sleep; sleep 30"},
            }
        ],
    )
    deadline = time.time() + 5
    while time.time() < deadline:
        if any("before-sleep" in l["raw"] for l in store.list(run=id)):
            break
        time.sleep(0.05)
    else:
        pytest.fail("Output did not stream before process completion")
    engine.cancel(id)
    r = wait(id)
    assert r["state"] == "cancelled"
    assert any(
        "Cleanup confirmed process gone" in l["raw"] for l in store.list(run=id)
    ), [x["raw"] for x in store.list(run=id)]


@pytest.fixture
def fake_serial_shell():
    master, slave = pty.openpty()
    path = os.ttyname(slave)
    stop = threading.Event()
    seen = []

    def shell():
        buf = b""
        while not stop.is_set():
            if not select.select([master], [], [], 0.1)[0]:
                continue
            try:
                buf += os.read(master, 8192)
            except OSError:
                break
            while b"\n" in buf:
                command, buf = buf.split(b"\n", 1)
                if not command.strip():
                    continue
                seen.append(command.decode(errors="replace"))
                # Runs the exact shell protocol on the local fixture, not on host app paths.
                try:
                    r = subprocess.run(
                        command.decode(), shell=True, capture_output=True, timeout=3
                    )
                    os.write(master, r.stdout + r.stderr)
                except Exception:
                    pass

    t = threading.Thread(target=shell, daemon=True)
    t.start()
    yield path, seen
    stop.set()
    t.join(timeout=1)
    os.close(master)
    os.close(slave)


def test_uart_linux_evidence_owner_serialization_and_recovery(
    client, fake_serial_shell, monkeypatch
):
    path, seen = fake_serial_shell
    c = {"id": "uart", "type": "uart", "device": path, "baud": 115200, "capture": True}
    t = connections.serial_owner(c, "pty-board")
    try:
        assert t.probe() == "linux_shell_verified"
        assert connections.serial_owner(c, "pty-board") is t
        with pytest.raises(connections.TransportError):
            connections.serial_owner(c, "other-board")
        results = []
        threads = [
            threading.Thread(
                target=lambda n=n: results.append(t.command(f"printf fixture-{n}", 5))
            )
            for n in range(2)
        ]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        assert len(results) == 2 and all(x[0] == 0 for x in results)

        class Broken:
            def __init__(self, *a, **k):
                raise OSError("SSH unavailable fixture")

        monkeypatch.setattr(connections, "SSH", Broken)
        b = {
            "id": "pty-board",
            "connections": [{"type": "ssh", "host": "127.0.0.1"}, c],
        }
        events = []
        assert connections.connect(b, events.append) is t
        assert any("automatic recovery" in x for x in events)
        with pytest.raises(connections.TransportError):
            connections.connect(b, require_network=True)
        assert any(
            l["source"] == "uart" and l["run_id"] is None
            for l in store.list(board="pty-board")
        )
    finally:
        connections.release("pty-board")


def test_open_serial_is_not_shell_evidence(client):
    master, slave = pty.openpty()
    path = os.ttyname(slave)
    t = connections.serial_owner(
        {"type": "uart", "device": path, "baud": 115200}, "silent"
    )
    try:
        assert t.probe() == "port_opened"
    finally:
        connections.release("silent")
        os.close(master)
        os.close(slave)
