"""Disposable verification server. Not a production fixture/demo mode."""

import os, sys, ipaddress
from pathlib import Path

root = Path(__file__).resolve().parents[1]
import shutil

runtime = root / "frontend/.browser-runtime"
if runtime.exists():
    shutil.rmtree(runtime)
os.environ["BOARDSCOPE_DATA"] = str(runtime)
os.environ["BOARDSCOPE_CONFIG"] = str(root / "frontend/test-results/no-config.toml")
sys.path.insert(0, str(root / "backend"))
from boardscope.security import set_password

set_password("browser-local-password")


# Reject every non-loopback Python socket connection in this verification server.
# This is a Python audit boundary, not an OS-wide firewall claim.
def audit(event, args):
    if event == "socket.connect":
        address = args[1]
        if isinstance(address, tuple):
            try:
                allowed = ipaddress.ip_address(address[0]).is_loopback
            except ValueError:
                allowed = address[0] == "localhost"
            if not allowed:
                raise PermissionError(
                    "Offline verification blocked non-loopback socket"
                )


sys.addaudithook(audit)
import uvicorn

uvicorn.run("boardscope.app:app", host="127.0.0.1", port=8000, access_log=False)
