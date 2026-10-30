import argparse, getpass
from .security import set_password

p = argparse.ArgumentParser()
p.add_argument("action", choices=["setup", "serve"])
args = p.parse_args()
if args.action == "setup":
    a = getpass.getpass("New local password (12+ characters): ")
    if a != getpass.getpass("Confirm password: "):
        raise SystemExit("Passwords differ")
    set_password(a)
    print("Local account configured.")
else:
    import uvicorn

    uvicorn.run("boardscope.app:app", host="127.0.0.1", port=8000, access_log=False)
