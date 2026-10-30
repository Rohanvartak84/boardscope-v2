import os, tempfile

os.environ["BOARDSCOPE_DATA"] = tempfile.mkdtemp(prefix="boardscope-test-")
os.environ["BOARDSCOPE_CONFIG"] = os.path.join(
    os.environ["BOARDSCOPE_DATA"], "config.toml"
)
from pathlib import Path

Path(os.environ["BOARDSCOPE_CONFIG"]).write_text(
    'key_directory = "'
    + os.environ["BOARDSCOPE_DATA"]
    + '/keys"\norigins = ["http://testserver", "http://127.0.0.1:8000"]\n'
)
import pytest
from fastapi.testclient import TestClient
from boardscope.app import app
from boardscope.security import set_password
from boardscope import db


@pytest.fixture(scope="session")
def client():
    set_password("test-local-password")
    with TestClient(app) as c:
        r = c.post("/api/login", json={"password": "test-local-password"})
        assert r.status_code == 200
        c.headers["x-csrf-token"] = r.json()["csrf"]
        yield c


@pytest.fixture(autouse=True)
def cleanup(client):
    with db.connect() as d:
        for table in ("logs", "runs", "boards", "suites", "conversations", "meta"):
            d.execute("DELETE FROM " + table)
    yield
