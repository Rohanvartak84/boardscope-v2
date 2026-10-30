"""Create source + built local frontend ZIP; never include runtime or dependencies."""

from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root.parent / "boardscope-source.zip"
excluded = {
    ".git",
    ".venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".browser-runtime",
    "test-results",
    "playwright-report",
    "runtime",
    "reports",
    "models",
    "secrets",
    "upload",
}
with ZipFile(output, "w", ZIP_DEFLATED) as z:
    for p in sorted(root.rglob("*")):
        if not p.is_file() or any(s in excluded for s in p.relative_to(root).parts):
            continue
        if (
            p.name == "config.toml"
            or p.name.startswith(".env")
            or p.suffix
            in {".pyc", ".key", ".pem", ".log", ".db", ".jsonl", ".tsbuildinfo"}
            or ".sqlite" in p.name
        ):
            continue
        z.write(p, Path("boardscope") / p.relative_to(root))
print(output)
