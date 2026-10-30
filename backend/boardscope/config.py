from pathlib import Path
import os, tomllib, ipaddress, socket

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(
    os.environ.get("BOARDSCOPE_DATA", Path.home() / ".local/share/boardscope")
).expanduser()
CONFIG_PATH = Path(os.environ.get("BOARDSCOPE_CONFIG", ROOT / "config.toml"))
DEFAULTS = {
    "command_timeout": 60,
    "reboot_recovery_timeout": 180,
    "reconnect_limits": 8,
    "uart_log_capture": True,
    "default_suite": None,
}


def load():
    c = tomllib.loads(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}
    c["defaults"] = DEFAULTS | c.get("defaults", {})
    c.setdefault("timezone", "UTC")
    c.setdefault("origins", ["http://127.0.0.1:8000", "http://localhost:8000"])
    c.setdefault("key_directory", str(Path.home() / ".ssh/boardscope"))
    c.setdefault("max_log_bytes", 256 * 1024 * 1024)
    c.setdefault("ai", {})
    return c


CONFIG = load()


def private_host(host):
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        if not addresses or any(
            not (
                ipaddress.ip_address(a[4][0]).is_private
                or ipaddress.ip_address(a[4][0]).is_loopback
            )
            or ipaddress.ip_address(a[4][0]).is_multicast
            for a in addresses
        ):
            raise ValueError("Only configured local/private destinations are permitted")
        return addresses[0][4][0]
    except socket.gaierror as e:
        raise ValueError(
            "Hostname could not be resolved; check agent DNS or use a local IP"
        ) from e
