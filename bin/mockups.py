from __future__ import annotations

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
WIRE_BLOCK = re.compile(r"dataset\.wire === \"([\w-]+)\"")
SCREEN_TEMPLATE = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>{title}</title>
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
                if prop not in SIZE_PROPERTIES:
                    self.problems.append((line, f"в style можно только размеры и позицию, «{prop}» вынеси в класс {STYLES}"))
                elif COLOR_LITERAL.search(value):
                    self.problems.append((line, f"цвет в style «{declaration}»: используй переменную из {STYLES}"))
        wire = values.get("data-wire")
        if wire is not None and wire not in self.blocks:
            known = ", ".join(sorted(self.blocks)) or "нет"
            self.problems.append((line, f"блока data-wire=\"{wire}\" нет в {SCRIPT}; доступны: {known}"))
        repeat = values.get("data-repeat")
        if repeat is not None and not (repeat.isdigit() and int(repeat) > 1):
            self.problems.append((line, f"data-repeat=\"{repeat}\": нужно целое число больше 1"))


def mockups_dir(root: Path, config: dict) -> Path | None:
    for tab in config.get("tabs", []):
        if tab.get("type") == "frame" and tab.get("src", "").endswith(f"/{BOARD}"):
            return root / Path(tab["src"]).parent
    return None


def defined_classes(folder: Path) -> set[str]:
    styles = folder / STYLES
    return set(CLASS_RULE.findall(styles.read_text())) if styles.is_file() else set()


def wire_blocks(folder: Path) -> set[str]:
    script = folder / SCRIPT
    return set(WIRE_BLOCK.findall(script.read_text())) if script.is_file() else set()


def load_manifest(folder: Path) -> dict:
    return json.loads((folder / MANIFEST).read_text())


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
        parser.feed(path.read_text())
        problems.extend(Problem(path.name, line, message) for line, message in parser.problems)
    problems.extend(check_feedback(folder, listed))
    return problems


def check_feedback(folder: Path, listed: set[str]) -> list[Problem]:
    path = folder / FEEDBACK
    if not path.is_file():
        return []
    problems = []
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        heading = FEEDBACK_SCREEN.match(line)
        if heading and heading[1] not in listed:
            problems.append(Problem(FEEDBACK, number, f"отзывы к экрану {heading[1]}, которого нет в {MANIFEST}"))
        if line.startswith("- ") and not FEEDBACK_ITEM.match(line):
            problems.append(Problem(FEEDBACK, number, "пункт отзыва должен быть вида «- [ ] N. `путь` — текст»"))
    return problems


def new_screen(folder: Path, name: str, title: str, group: str, size: tuple[int, int], about: str) -> Path:
    if not SCREEN_NAME.match(name):
        raise ValueError("имя экрана пишется в PascalCase латиницей, например OrderDetail")
    target = folder / f"{name}.html"
    if target.exists():
        raise ValueError(f"{target.name} уже есть")
    manifest = load_manifest(folder)
    width, height = size
    target.write_text(SCREEN_TEMPLATE.format(title=title, width=width, height=height))
    manifest.setdefault("screens", []).append(
        {"file": target.name, "title": title, "group": group, "size": [width, height], "about": about, "blocks": []}
    )
    (folder / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return target
