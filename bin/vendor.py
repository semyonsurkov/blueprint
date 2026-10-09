from __future__ import annotations

import io
import json
import posixpath
import re
import shutil
import tarfile
import urllib.request
from pathlib import Path

ORIGIN = "https://esm.sh"
REGISTRY = "https://registry.npmjs.org"
LOCAL_ROOT = "/blueprint/vendor/"
FOLDER = "vendor"
MANIFEST = "manifest.json"
TIMEOUT_SECONDS = 60
ESM_URL = re.compile(r"https://esm\.sh/([^\"'`\s)]+)")
MODULE_IMPORT = re.compile(r"""((?:\bfrom\s*|\bimport\s*\(?\s*)["'])(/[^"']+)(["'])""")
RELATIVE_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}/[^"']+)["']""")
RAW_FILE = re.compile(r"\.(css|svg|woff2?|ttf|json|png)$")
PACKAGE_FILES = {
    "@excalidraw/excalidraw": ("dist/prod/fonts/", "dist/prod/index.css"),
    "lucide-static": ("icons/",),
}
SKIPPED_FILES = ("/Xiaolai/",)
BUNDLED = ("mermaid@",)
SKIPPED_IMPORTS = ("/@excalidraw/mermaid-to-excalidraw@",)


def is_module(url: str) -> bool:
    clean = url.partition("?")[0]
    return not clean.endswith("/") and not RAW_FILE.search(clean) and not any(
        clean.startswith(f"{name}@") and f"/{prefix.rstrip('/')}" in clean
        for name, prefixes in PACKAGE_FILES.items() for prefix in prefixes
    )


def local_name(path: str) -> str:
    clean, _, query = path.lstrip("/").partition("?")
    if query:
        clean += "__" + re.sub(r"[^\w.-]+", "_", query)
    if clean.endswith("/") or RAW_FILE.search(clean) or clean.endswith((".mjs", ".js")):
        return clean
    return clean + ".mjs"


def download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
        return response.read()


def localize_imports(text: str) -> str:
    return MODULE_IMPORT.sub(lambda match: f"{match[1]}{LOCAL_ROOT}{local_name(match[2])}{match[3]}", text)


def crawl(entries: list[str], target: Path) -> tuple[int, int, list[str]]:
    seen: set[str] = set()
    queue = list(entries)
    bundled = {entry for entry in entries if entry.lstrip("/").startswith(BUNDLED)}
    total = 0
    missing = []
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        source = path + ("&bundle" if "?" in path else "?bundle") if path in bundled else path
        try:
            body = download(ORIGIN + source)
        except OSError:
            missing.append(path)
            continue
        text = body.decode("utf-8")
        queue.extend(found for _, found, _ in MODULE_IMPORT.findall(text) if found not in seen and not found.startswith(SKIPPED_IMPORTS))
        base = posixpath.dirname(path.partition("?")[0])
        queue.extend(posixpath.normpath(posixpath.join(base, found)) for found in RELATIVE_IMPORT.findall(text))
        destination = target / local_name(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(localize_imports(text), encoding="utf-8")
        total += len(body)
    return len(seen) - len(missing), total, missing


def package_files(name: str, version: str, prefixes: tuple[str, ...], target: Path) -> tuple[int, int]:
    archive = download(f"{REGISTRY}/{name}/-/{name.split('/')[-1]}-{version}.tgz")
    count = total = 0
    with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
        for member in bundle.getmembers():
            inner = member.name.partition("/")[2]
            if not member.isfile() or not inner.startswith(prefixes) or any(part in member.name for part in SKIPPED_FILES):
                continue
            destination = target / f"{name}@{version}" / inner
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(member)
            if source is None:
                continue
            destination.write_bytes(source.read())
            count += 1
            total += member.size
    return count, total


def page_urls(page: Path) -> list[str]:
    urls = []
    for path in sorted(page.iterdir()):
        if path.suffix in (".html", ".js"):
            urls += ESM_URL.findall(path.read_text(encoding="utf-8"))
    return sorted(set(urls))


def localize_page(page: Path) -> list[str]:
    changed = []
    for path in sorted(page.iterdir()):
        if path.suffix not in (".html", ".js"):
            continue
        text = path.read_text(encoding="utf-8")
        updated = ESM_URL.sub(lambda match: LOCAL_ROOT + (local_name("/" + match[1]) if is_module(match[1]) else match[1]), text)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed.append(path.name)
    return changed


def vendor(page: Path, versions: dict[str, str]) -> dict:
    target = page / FOLDER
    if target.exists():
        shutil.rmtree(target)
    target.mkdir()
    modules = ["/" + url for url in page_urls(page) if is_module(url)]
    module_count, module_bytes, missing = crawl(modules, target)
    file_count = file_bytes = 0
    for name, prefixes in PACKAGE_FILES.items():
        if name in versions:
            count, size = package_files(name, versions[name], prefixes, target)
            file_count += count
            file_bytes += size
    manifest = {"versions": versions, "modules": module_count, "files": file_count, "bytes": module_bytes + file_bytes, "missing": missing}
    (target / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    localize_page(page)
    return manifest


def read_manifest(page: Path) -> dict | None:
    path = page / FOLDER / MANIFEST
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
