"""Static asset check. Supplements browser/network checks; not a firewall."""

from pathlib import Path
import re

root = Path(__file__).resolve().parents[1] / "frontend/dist"
assert (root / "index.html").exists(), "Build frontend first"
html = (root / "index.html").read_text()
for value in re.findall(r'(?:src|href)=["\']([^"\']+)', html):
    assert not value.startswith(("http:", "https:", "//")), value
    assert (root / value.lstrip("/")).is_file(), value
for file in root.rglob("*.css"):
    text = file.read_text()
    assert not re.search(r'@import\s|url\(["\']?(?:https?:)?//', text), file
print(
    "PASS: HTML assets exist locally; no external HTML asset URLs or CSS imports/remote URLs."
)
urls = set()
for file in root.rglob("*.js"):
    urls.update(re.findall(r'https?://[^\s"\'<>`]+', file.read_text()))
print(
    "Bundle URL strings to inspect (inert documentation/namespace strings are not network requests):"
)
for url in sorted(urls):
    print(" ", url[:180])
