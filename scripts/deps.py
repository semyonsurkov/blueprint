#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VERSIONS = REPO_ROOT / "versions.json"
PAGE_DIR = REPO_ROOT / "page"
REGISTRY = "https://registry.npmjs.org"
ABBREVIATED = "application/vnd.npm.install-v1+json"
TIMEOUT_SECONDS = 20
ESM_URL = re.compile(r"esm\.sh/(?P<name>@[\w.-]+/[\w.-]+|[\w.-]+)@(?P<version>\d[\w.+-]*)")
VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
COMPARATOR = re.compile(r"^(>=|<=|>|<|=|\^|~)?v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$")


Version = tuple[int, int, int]


def parse(version: str) -> Version | None:
    match = VERSION.match(version)
    if not match:
        return None
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def key(version: str) -> Version:
    parsed = parse(version)
    if parsed is None:
        raise ValueError(f"версия «{version}» не в формате x.y.z")
    return parsed


def fetch(name: str) -> dict:
    request = urllib.request.Request(f"{REGISTRY}/{name.replace('/', '%2F')}", headers={"Accept": ABBREVIATED})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.load(response)


def bounds(token: str) -> list[tuple[str, Version]]:
    match = COMPARATOR.match(token)
    if not match:
        raise ValueError(f"не разобрать диапазон «{token}»")
    operator, *parts = match.groups()
    wild = [part in (None, "x", "*") for part in parts]
    numbers = [0 if is_wild else int(part) for part, is_wild in zip(parts, wild)]
    major, minor, patch = numbers
    if wild[0]:
        return []
    if operator == "^":
        upper = (major + 1, 0, 0) if major else ((0, minor + 1, 0) if minor or wild[2] else (0, 0, patch + 1))
        return [(">=", (major, minor, patch)), ("<", upper)]
    if operator == "~" or (operator in (None, "=") and any(wild)):
        upper = (major + 1, 0, 0) if wild[1] else (major, minor + 1, 0)
        return [(">=", (major, minor, patch)), ("<", upper)]
    return [(operator or "=", (major, minor, patch))]


def satisfies(version: str, spec: str) -> bool:
    value = parse(version)
    if value is None:
        return False
    for alternative in spec.split("||"):
        tokens = re.sub(r"(>=|<=|>|<|=)\s+", r"\1", alternative).split()
        checks = [bound for token in tokens for bound in bounds(token)]
        if all(compare(value, operator, limit) for operator, limit in checks):
            return True
    return False


def compare(value: Version, operator: str, limit: Version) -> bool:
    return {"=": value == limit, ">=": value >= limit, "<=": value <= limit, ">": value > limit, "<": value < limit}[operator]


def stable_versions(meta: dict) -> list[str]:
    return sorted((version for version in meta["versions"] if parse(version)), key=key)


def newest(meta: dict, current: str, allow_major: bool) -> str:
    candidates = stable_versions(meta)
    if not allow_major:
        candidates = [version for version in candidates if key(version)[0] == key(current)[0]]
    return candidates[-1] if candidates else current


def peer_conflicts(pinned: dict[str, str], metas: dict[str, dict]) -> list[str]:
    conflicts = []
    for name, version in pinned.items():
        peers = metas[name]["versions"].get(version, {}).get("peerDependencies", {})
        for peer, spec in peers.items():
            if peer in pinned and not satisfies(pinned[peer], spec):
                conflicts.append(f"{name}@{version} требует {peer} {spec}, а выбран {peer}@{pinned[peer]}")
    return conflicts


def together_conflicts(pinned: dict[str, str], groups: list[list[str]]) -> list[str]:
    return [
        f"{', '.join(group)} должны быть одной версии: {', '.join(f'{name}@{pinned[name]}' for name in group)}"
        for group in groups
        if len({pinned[name] for name in group}) > 1
    ]


def page_files() -> list[Path]:
    return sorted(path for path in PAGE_DIR.iterdir() if path.suffix in (".html", ".js", ".css"))


def usages() -> list[tuple[Path, str, str]]:
    found = []
    for path in page_files():
        for match in ESM_URL.finditer(path.read_text(encoding="utf-8")):
            found.append((path, match["name"], match["version"]))
    return found


def drift(pinned: dict[str, str]) -> list[str]:
    problems = []
    for path, name, version in usages():
        label = path.relative_to(REPO_ROOT).as_posix()
        if name not in pinned:
            problems.append(f"{label}: {name}@{version} нет в versions.json")
        elif pinned[name] != version:
            problems.append(f"{label}: {name}@{version}, а в versions.json {pinned[name]}")
    return problems


def rewrite(pinned: dict[str, str]) -> list[str]:
    changed = []
    for path in page_files():
        text = path.read_text(encoding="utf-8")
        updated = ESM_URL.sub(lambda match: f"esm.sh/{match['name']}@{pinned.get(match['name'], match['version'])}", text)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed.append(path.relative_to(REPO_ROOT).as_posix())
    return changed


def load() -> dict:
    return json.loads(VERSIONS.read_text(encoding="utf-8"))


def check(_args: argparse.Namespace) -> int:
    data = load()
    pinned = data["packages"]
    metas = {name: fetch(name) for name in pinned}
    width = max(map(len, pinned))
    print(f"{'пакет'.ljust(width)}  текущая   в мажорной  последняя")
    for name, version in pinned.items():
        minor = newest(metas[name], version, allow_major=False)
        latest = newest(metas[name], version, allow_major=True)
        print(f"{name.ljust(width)}  {version.ljust(9)} {('= ' if minor == version else '↑ ') + minor:<11} {('= ' if latest == version else '↑ ') + latest}")
    problems = drift(pinned) + peer_conflicts(pinned, metas) + together_conflicts(pinned, data.get("together", []))
    for problem in problems:
        print(f"! {problem}")
    return 1 if problems else 0


def update(args: argparse.Namespace) -> int:
    data = load()
    pinned = dict(data["packages"])
    unknown = [name for name in args.names if name not in pinned]
    if unknown:
        print(f"нет в versions.json: {', '.join(unknown)}", file=sys.stderr)
        return 1
    targets = args.names or list(pinned)
    for group in data.get("together", []):
        if any(name in targets for name in group):
            targets += [name for name in group if name not in targets]
    metas = {name: fetch(name) for name in pinned}
    for name in targets:
        pinned[name] = newest(metas[name], pinned[name], args.major)
    for group in data.get("together", []):
        common = min((pinned[name] for name in group), key=key)
        if all(common in metas[name]["versions"] for name in group):
            for name in group:
                pinned[name] = common
    conflicts = peer_conflicts(pinned, metas) + together_conflicts(pinned, data.get("together", []))
    if conflicts:
        print("обновление не применено, набор версий несовместим:", file=sys.stderr)
        for conflict in conflicts:
            print(f"  {conflict}", file=sys.stderr)
        print("подними пакеты по одному (deps.py update <пакет>) или реши, кого оставить", file=sys.stderr)
        return 1
    changes = {name: (data["packages"][name], pinned[name]) for name in pinned if pinned[name] != data["packages"][name]}
    if not changes:
        print("всё уже на последних допустимых версиях")
        return 0
    data["packages"] = pinned
    VERSIONS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    files = rewrite(pinned)
    for name, (old, new) in changes.items():
        print(f"{name}: {old} → {new}")
    print(f"переписано: {', '.join(files) or 'ничего'}; проверь страницу в браузере и закоммить versions.json вместе с page/")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="deps.py", description="версии библиотек страницы: проверка и обновление")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("check", help="текущие, доступные и несовместимые версии (по умолчанию)").set_defaults(run=check)
    update_parser = commands.add_parser("update", help="поднять версии и переписать адреса esm.sh в page/")
    update_parser.add_argument("names", nargs="*", help="пакеты; без имён все")
    update_parser.add_argument("--major", action="store_true", help="разрешить новую мажорную версию")
    update_parser.set_defaults(run=update)
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")
    return getattr(args, "run", check)(args)


if __name__ == "__main__":
    sys.exit(main())
