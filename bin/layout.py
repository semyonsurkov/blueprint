from __future__ import annotations

import zlib
from dataclasses import dataclass, field
from pathlib import Path

DOCS_NAMES = ("docs", "documents", "documentation", "doc", "wiki")
ADR_NAMES = ("adr", "decisions", "adrs")
EXCLUDE_NAMES = ("archive", "archived", "old")
SKIPPED = {"node_modules", "vendor", "dist", "build", "__pycache__", "venv", "site-packages", "blueprint"}
STACK_NAMES = ("stack.md", "tech-stack.md")
ARCHITECTURE_NAMES = ("architecture.md",)
ROADMAP_NAMES = ("roadmap.md", "ROADMAP.md")
IDEAS_NAMES = ("IDEAS.md", "ideas.md")
MOCKUPS_DEFAULT = "design/mockups"
MAX_DEPTH = 4
PORT_BASE = 5190
PORT_SPREAD = 700


@dataclass
class Layout:
    title: str
    docs: str | None = None
    exclude: list[str] = field(default_factory=list)
    architecture: str | None = None
    architecture_exists: bool = False
    overview: list[str] = field(default_factory=list)
    mockups: str | None = None
    roadmap: str | None = None
    ideas: str | None = None
    adr: str | None = None
    alternatives: dict[str, list[str]] = field(default_factory=dict)


def project_port(root: Path) -> int:
    return PORT_BASE + zlib.crc32(str(root.resolve()).encode("utf-8")) % PORT_SPREAD


def walk(root: Path, max_depth: int = MAX_DEPTH):
    stack = [(root, 0)]
    while stack:
        folder, depth = stack.pop()
        try:
            entries = sorted(folder.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.name.startswith(".") or entry.name in SKIPPED:
                continue
            yield entry
            if entry.is_dir() and depth < max_depth:
                stack.append((entry, depth + 1))


def relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def markdown_count(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for path in walk(folder) if path.suffix == ".md")


def by_depth(root: Path, paths: list[Path]) -> list[str]:
    return [relative(root, path) for path in sorted(paths, key=lambda item: (len(item.parts), item.as_posix()))]


def find_docs(root: Path) -> list[str]:
    found = [path for path in walk(root) if path.is_dir() and path.name.lower() in DOCS_NAMES and markdown_count(path)]
    return by_depth(root, found)


def find_adr(root: Path) -> list[str]:
    found = [path for path in walk(root) if path.is_dir() and path.name.lower() in ADR_NAMES and markdown_count(path)]
    return by_depth(root, found)


def find_schemes(root: Path, exclude: list[str]) -> list[str]:
    found = [
        path for path in walk(root)
        if path.suffix == ".excalidraw" and not any(part in exclude for part in path.relative_to(root).parts)
    ]
    named = [path for path in found if "architecture" in path.stem.lower()]
    return by_depth(root, named) + by_depth(root, [path for path in found if path not in named])


def find_file(root: Path, folders: list[str], names: tuple[str, ...]) -> str | None:
    for folder in folders:
        base = root / folder if folder else root
        try:
            present = {entry.name for entry in base.iterdir() if entry.is_file()}
        except OSError:
            continue
        for name in names:
            if name in present:
                return relative(root, base / name)
    return None


def find_named(root: Path, folder: str, names: tuple[str, ...], exclude: list[str]) -> str | None:
    base = root / folder
    for name in names:
        candidates = [path for path in walk(base) if path.name == name]
        for path in sorted(candidates, key=lambda item: len(item.parts)):
            if not any(part in exclude for part in path.relative_to(base).parts):
                return relative(root, path)
    return None


def is_mockups(folder: Path) -> bool:
    return (folder / "index.html").is_file() and (folder / "screens.json").is_file()


def readme_title(root: Path) -> str:
    readme = root / "README.md"
    if readme.is_file():
        for line in readme.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    return root.name


def from_config(found: Layout, previous: dict) -> Layout:
    tabs = {tab.get("id"): tab for tab in previous.get("tabs", [])}
    found.title = previous.get("title", found.title)
    found.docs = found.docs if "docs" in tabs else None
    found.adr = found.adr if "adr" in tabs else None
    found.mockups = found.mockups if "mockups" in tabs else None
    if "mvp" not in tabs:
        found.roadmap = found.ideas = None
    if "architecture" in tabs:
        found.architecture = tabs["architecture"].get("file", found.architecture)
        found.overview = [item if isinstance(item, str) else item["path"] for item in tabs["architecture"].get("docs", [])]
    if "docs" in tabs:
        found.docs = tabs["docs"].get("dir", found.docs)
        found.exclude = tabs["docs"].get("exclude", [])
    if "adr" in tabs:
        found.adr = tabs["adr"].get("dir", found.adr)
    if "mockups" in tabs:
        found.mockups = str(Path(tabs["mockups"].get("src", "")).parent.as_posix()) or found.mockups
    if "mvp" in tabs:
        documents = [item if isinstance(item, str) else item["path"] for item in tabs["mvp"].get("docs", [])]
        found.roadmap = documents[0] if documents else None
        found.ideas = documents[1] if len(documents) > 1 else None
    return found


def default_scheme(layout: Layout) -> str:
    base = layout.docs if layout.docs and layout.docs != "." else "docs"
    return f"{base}/architecture.excalidraw"


def detect(root: Path) -> Layout:
    layout = Layout(title=readme_title(root))
    docs = find_docs(root)
    layout.alternatives["docs"] = docs
    if docs:
        layout.docs = docs[0]
        base = root / layout.docs
        layout.exclude = [name for name in EXCLUDE_NAMES if (base / name).is_dir()]
        layout.overview = [
            path for path in (
                find_named(root, layout.docs, STACK_NAMES, layout.exclude),
                find_named(root, layout.docs, ARCHITECTURE_NAMES, layout.exclude),
            ) if path
        ]
    schemes = find_schemes(root, layout.exclude)
    layout.alternatives["architecture"] = schemes
    if schemes:
        layout.architecture, layout.architecture_exists = schemes[0], True
    adr = find_adr(root)
    layout.alternatives["adr"] = adr
    if adr:
        layout.adr = adr[0]
    folders = [layout.docs, ""] if layout.docs else [""]
    layout.roadmap = find_file(root, folders, ROADMAP_NAMES)
    layout.ideas = find_file(root, ["", *folders], IDEAS_NAMES)
    if is_mockups(root / MOCKUPS_DEFAULT):
        layout.mockups = MOCKUPS_DEFAULT
    return layout
