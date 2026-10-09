from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path

MANIFEST = "screens.json"
STYLES = "wire.css"
SCRIPT = "wire.js"
BOARD = "index.html"
FEEDBACK = "FEEDBACK.md"
FEEDBACK_ITEM = re.compile(r"^- \[( |x)\] \d+\. `[^`]+` — .+$")
FEEDBACK_SCREEN = re.compile(r"^## (\S+\.html)")
SCREEN_NAME = re.compile(r"^[A-Z][A-Za-z0-9]*$")
SIZE_PROPERTIES = {
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    "position", "left", "top", "right", "bottom", "flex-basis",
}
COLOR_LITERAL = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
CLASS_RULE = re.compile(r"\.([A-Za-z_][\w-]*)")
RENDER_CALL = re.compile(r"renderScreens\(\s*\{")
IDENTIFIER = re.compile(r"^[A-Za-z_]\w*$")
SCREEN_TEMPLATE = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="/blueprint/theme.js"></script>
<link rel="stylesheet" href="wire.css">
</head>
<body>
<div class="screen" style="width: {width}px; height: {height}px">
  <div class="page_col">
    <div class="h1">{title}</div>
  </div>
</div>
<script type="module" src="wire.js"></script>
</body>
</html>
"""


class Problem:
    def __init__(self, file: str, line: int, message: str):
        self.file = file
        self.line = line
        self.message = message

    def __str__(self) -> str:
        return f"{self.file}:{self.line}: {self.message}" if self.line else f"{self.file}: {self.message}"


class ScreenParser(HTMLParser):
    def __init__(self, classes: set[str], blocks: set[str]):
        super().__init__()
        self.classes = classes
        self.blocks = blocks
        self.problems: list[tuple[int, str]] = []

    def handle_starttag(self, tag, attrs):
        line = self.getpos()[0]
        values = dict(attrs)
        for name in (values.get("class") or "").split():
            if name not in self.classes:
                self.problems.append((line, f"класса .{name} нет в {STYLES}: возьми готовый или добавь правило в {STYLES}"))
        style = values.get("style")
        if style:
            for declaration in filter(None, (part.strip() for part in style.split(";"))):
                prop, _, value = declaration.partition(":")
                prop = prop.strip().lower()
                if COLOR_LITERAL.search(value):
                    self.problems.append((line, f"цвет в style «{declaration}»: используй переменную из {STYLES}"))
                elif prop not in SIZE_PROPERTIES:
                    self.problems.append((line, f"в style можно только размеры и позицию, «{prop}» вынеси в класс {STYLES}"))
        wire = values.get("data-wire")
        if wire is not None and wire not in self.blocks:
            known = ", ".join(sorted(self.blocks)) or "нет"
            self.problems.append((line, f"блока data-wire=\"{wire}\" нет в {SCRIPT}; доступны: {known}"))
        repeat = values.get("data-repeat")
        if repeat is not None and not (repeat.isdigit() and int(repeat) > 1):
            self.problems.append((line, f"data-repeat=\"{repeat}\": нужно целое число больше 1"))


def mockups_dir(root: Path, config: dict) -> Path | None:
    for tab in config.get("tabs", []):
        if tab.get("type") == "frame" and Path(tab.get("src", "")).name == BOARD:
            return root / Path(tab["src"]).parent
    return None


def defined_classes(folder: Path) -> set[str]:
    styles = folder / STYLES
    if not styles.is_file():
        return set()
    text = re.sub(r"url\([^)]*\)", "", styles.read_text(encoding="utf-8"))
    return set(CLASS_RULE.findall(text))


def wire_blocks(folder: Path) -> set[str]:
    script = folder / SCRIPT
    if not script.is_file():
        return set()
    text = script.read_text(encoding="utf-8")
    call = RENDER_CALL.search(text)
    if not call:
        return set()
    keys, depth, part = [], 0, ""
    for char in text[call.end():]:
        if char in "{([":
            depth += 1
        elif char in "})]":
            if depth == 0:
                break
            depth -= 1
        if char == "," and depth == 0:
            keys.append(part)
            part = ""
        elif depth == 0:
            part += char
    keys.append(part)
    names = (key.split(":")[0].strip() for key in keys)
    return {name for name in names if IDENTIFIER.match(name)}


def load_manifest(folder: Path) -> dict:
    path = folder / MANIFEST
    if not path.is_file():
        raise FileNotFoundError(MANIFEST)
    return json.loads(path.read_text(encoding="utf-8"))


def check(folder: Path) -> list[Problem]:
    problems: list[Problem] = []
    try:
        manifest = load_manifest(folder)
    except FileNotFoundError:
        return [Problem(MANIFEST, 0, "файл не найден")]
    except json.JSONDecodeError as error:
        return [Problem(MANIFEST, error.lineno, f"невалидный JSON: {error.msg}")]
    screens = manifest.get("screens", [])
    listed = set()
    for position, screen in enumerate(screens, start=1):
        label = f"screens[{position}]"
        for field in ("file", "title", "group", "size", "about"):
            if not screen.get(field):
                problems.append(Problem(MANIFEST, 0, f"{label}: нет поля «{field}»"))
        size = screen.get("size")
        if size is not None and not (isinstance(size, list) and len(size) == 2 and all(isinstance(n, int) and n > 0 for n in size)):
            problems.append(Problem(MANIFEST, 0, f"{label}: size должен быть [ширина, высота] в пикселях"))
        file = screen.get("file", "")
        if file:
            listed.add(file)
            if not (folder / file).is_file():
                problems.append(Problem(MANIFEST, 0, f"{label}: файла {file} нет, создай его через blueprint new-screen"))
    classes = defined_classes(folder)
    blocks = wire_blocks(folder)
    for path in sorted(folder.glob("*.html")):
        if path.name == BOARD:
            continue
        if path.name not in listed:
            problems.append(Problem(path.name, 0, f"экрана нет в {MANIFEST}: добавь запись или удали файл"))
        parser = ScreenParser(classes, blocks)
        parser.feed(path.read_text(encoding="utf-8"))
        problems.extend(Problem(path.name, line, message) for line, message in parser.problems)
    problems.extend(check_feedback(folder, listed))
    return problems


def check_feedback(folder: Path, listed: set[str]) -> list[Problem]:
    path = folder / FEEDBACK
    if not path.is_file():
        return []
    problems = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        heading = FEEDBACK_SCREEN.match(line)
        if heading and heading[1] not in listed:
            problems.append(Problem(FEEDBACK, number, f"комментарии к экрану {heading[1]}, которого нет в {MANIFEST}"))
        if line.startswith("- ") and not FEEDBACK_ITEM.match(line):
            problems.append(Problem(FEEDBACK, number, "пункт комментария должен быть вида «- [ ] N. `путь` — текст»"))
    return problems


def new_screen(folder: Path, name: str, title: str, group: str, size: tuple[int, int], about: str) -> Path:
    if not SCREEN_NAME.match(name):
        raise ValueError("имя экрана пишется в PascalCase латиницей, например OrderDetail")
    target = folder / f"{name}.html"
    if target.exists():
        raise ValueError(f"{target.name} уже есть")
    try:
        manifest = load_manifest(folder)
    except FileNotFoundError:
        raise ValueError(f"{MANIFEST} не найден в {folder}: макеты заведены не через blueprint init") from None
    except json.JSONDecodeError as error:
        raise ValueError(f"{MANIFEST} не читается как JSON, строка {error.lineno}: {error.msg}") from None
    if any(screen.get("file") == target.name for screen in manifest.get("screens", [])):
        raise ValueError(f"{target.name} уже записан в {MANIFEST}, хотя файла нет: удали запись или создай файл")
    width, height = size
    target.write_text(SCREEN_TEMPLATE.format(title=html.escape(title), width=width, height=height), encoding="utf-8")
    manifest.setdefault("screens", []).append(
        {"file": target.name, "title": title, "group": group, "size": [width, height], "about": about, "blocks": []}
    )
    (folder / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target
