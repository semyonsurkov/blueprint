import json
import os
import shutil
import sys
import tempfile
import threading
import time
from collections import deque
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_FILE = Path(__file__).parent / "blueprint.json"
HOST = "127.0.0.1"
DEFAULT_PORT = 5190
PAGE_URL = "/blueprint/"
SKIPPED_FOLDERS = {"node_modules", "vendor", "dist", "build", "__pycache__", "venv", "site-packages", "blueprint"}
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]")
FEEDBACK_NAME = "FEEDBACK.md"
MAX_BODY_BYTES = 20 * 1024 * 1024
PENDING_CONNECTIONS = 256
PAGE_DIR = Path(__file__).resolve().parent
POLL_SECONDS = 0.3
HEARTBEAT_SECONDS = 15
KEPT_CHANGES = 64
EVERYTHING = "*"


def read_config() -> dict:
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def writable_files(config: dict) -> set[str]:
    schemes = {tab["file"] for tab in config["tabs"] if tab.get("type") == "excalidraw" and "file" in tab}
    feedback = {
        (Path(tab["src"]).parent / FEEDBACK_NAME).as_posix()
        for tab in config["tabs"]
        if tab.get("type") == "frame" and "src" in tab
    }
    return schemes | feedback


def listed_folders(config: dict) -> dict[str, set[str]]:
    folders = {}
    for tab in config["tabs"]:
        if tab.get("type") in ("docs", "adr") and "dir" in tab:
            folders[tab["dir"]] = set(tab.get("exclude", []))
    return folders


def hidden(name: str) -> bool:
    return name.startswith(".")


def skipped(name: str) -> bool:
    return hidden(name) or name in SKIPPED_FOLDERS


def markdown_files(folder: str, exclude: set[str]) -> list[str]:
    root = (PROJECT_ROOT / folder).resolve()
    if root != PROJECT_ROOT and PROJECT_ROOT not in root.parents:
        return []
    files = []
    for folder_path, folders, names in os.walk(root):
        folders[:] = sorted(name for name in folders if not skipped(name) and name not in exclude)
        for name in sorted(names):
            if name.endswith(".md") and not hidden(name):
                files.append((Path(folder_path) / name).relative_to(PROJECT_ROOT).as_posix())
    return sorted(files)


def tab_paths(tab: dict) -> list[str]:
    docs = [item if isinstance(item, str) else item.get("path", "") for item in tab.get("docs", [])]
    return [path for path in [tab.get("file", ""), *docs] if path]


def folder_files(folder: Path) -> list[Path]:
    files = []
    for folder_path, folders, names in os.walk(folder):
        folders[:] = [name for name in folders if not skipped(name)]
        files += [Path(folder_path) / name for name in names if not hidden(name)]
    return files


def watched_files() -> list[Path]:
    files = [CONFIG_FILE, *(path for path in PAGE_DIR.iterdir() if path.is_file() and not hidden(path.name))]
    try:
        config = read_config()
    except (OSError, ValueError):
        return files
    for tab in config.get("tabs", []):
        files += [PROJECT_ROOT / path for path in tab_paths(tab)]
        if tab.get("type") == "frame" and "src" in tab:
            folder = (PROJECT_ROOT / tab["src"]).parent.resolve()
            if PROJECT_ROOT in folder.parents:
                files += folder_files(folder)
    for folder, exclude in listed_folders(config).items():
        files += [PROJECT_ROOT / path for path in markdown_files(folder, exclude)]
    return files


def snapshot() -> dict[str, tuple[int, int]]:
    state = {}
    for path in watched_files():
        try:
            info = path.stat()
            relative = path.resolve().relative_to(PROJECT_ROOT).as_posix()
        except (OSError, ValueError):
            continue
        state[relative] = (info.st_mtime_ns, info.st_size)
    return state


# В стандартной библиотеке нет событий файловой системы, поэтому файлы из конфига опрашиваются,
# и только пока хоть одна страница слушает /api/events.
class Watcher:
    def __init__(self):
        self.condition = threading.Condition()
        self.version = 0
        self.changes = deque(maxlen=KEPT_CHANGES)
        self.listeners = 0

    def run(self):
        previous = None
        while True:
            time.sleep(POLL_SECONDS)
            if not self.listeners:
                previous = None
                continue
            current = snapshot()
            if previous is not None:
                changed = sorted(path for path in previous.keys() | current.keys() if previous.get(path) != current.get(path))
                if changed:
                    with self.condition:
                        self.version += 1
                        self.changes.append((self.version, changed))
                        self.condition.notify_all()
            previous = current

    def subscribe(self) -> int:
        with self.condition:
            self.listeners += 1
            return self.version

    def unsubscribe(self):
        with self.condition:
            self.listeners -= 1

    def wait(self, since: int) -> tuple[int, list[str]]:
        with self.condition:
            self.condition.wait_for(lambda: self.version > since, timeout=HEARTBEAT_SECONDS)
            fresh = [paths for version, paths in self.changes if version > since]
            missed = self.changes and self.changes[0][0] > since + 1
            paths = sorted({path for group in fresh for path in group} | ({EVERYTHING} if missed else set()))
            return self.version, paths


WATCHER = Watcher()


def write_atomically(target: Path, body: bytes) -> None:
    descriptor, temporary = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(body)
        if target.exists():
            shutil.copymode(target, temporary)
        else:
            os.chmod(temporary, 0o644)
        os.replace(temporary, target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def own_hosts(port: int) -> set[str]:
    return {f"{host}:{port}" for host in LOOPBACK_HOSTS}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def _own_host(self) -> bool:
        return self.headers.get("Host", "").lower() in own_hosts(self.server.server_port)

    def _from_this_server(self) -> bool:
        origin = self.headers.get("Origin")
        return self._own_host() and (origin is None or urlparse(origin).netloc.lower() in own_hosts(self.server.server_port))

    def _readable(self, path: str) -> bool:
        if not self._own_host():
            self.send_error(403)
            return False
        if any(hidden(part) for part in path.split("/")):
            self.send_error(404)
            return False
        return True

    def list_directory(self, path):
        self.send_error(404)
        return None

    def do_HEAD(self):
        if self._readable(unquote(urlparse(self.path).path)):
            super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if not self._readable(path):
            return
        if path == "/":
            self.send_response(302)
            self.send_header("Location", PAGE_URL)
            self.end_headers()
            return
        if path == "/api/events":
            self._send_events()
            return
        if path == "/api/tree":
            self._send_tree(parse_qs(urlparse(self.path).query).get("dir", [""])[0])
            return
        super().do_GET()

    def _send_events(self):
        if not self._from_this_server():
            self._send_json(403, b'{"error":"foreign origin"}')
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.end_headers()
        version = WATCHER.subscribe()
        try:
            self.wfile.write(b"retry: 1000\n\n")
            self.wfile.flush()
            while True:
                version, paths = WATCHER.wait(version)
                message = f"data: {json.dumps({'paths': paths}, ensure_ascii=False)}\n\n" if paths else ": ping\n\n"
                self.wfile.write(message.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            WATCHER.unsubscribe()

    def _send_tree(self, folder: str):
        folders = listed_folders(read_config())
        if folder not in folders:
            self._send_json(403, b'{"error":"folder is not listed"}')
            return
        body = json.dumps(markdown_files(folder, folders[folder]), ensure_ascii=False)
        self._send_json(200, body.encode())

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/api/save":
            self.send_error(404)
            return
        if not self._from_this_server():
            self._send_json(403, b'{"error":"foreign origin"}')
            return
        length = self.headers.get("Content-Length", "")
        if not (length.isascii() and length.isdigit()) or int(length) > MAX_BODY_BYTES:
            self._send_json(413, b'{"error":"body is too large or has no length"}')
            return
        body = self.rfile.read(int(length))
        relative = parse_qs(url.query).get("path", [""])[0]
        if relative not in writable_files(read_config()):
            self._send_json(403, b'{"error":"path is not writable"}')
            return
        target = (PROJECT_ROOT / relative).resolve()
        if PROJECT_ROOT not in target.parents:
            self._send_json(403, b'{"error":"path is outside the project"}')
            return
        if target.suffix == ".excalidraw":
            try:
                json.loads(body)
            except ValueError:
                self._send_json(400, b'{"error":"body is not a valid scheme"}')
                return
        target.parent.mkdir(parents=True, exist_ok=True)
        write_atomically(target, body)
        self._send_json(200, b'{"ok":true}')

    def _send_json(self, status: int, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))


class Server(ThreadingHTTPServer):
    request_queue_size = PENDING_CONNECTIONS
    daemon_threads = True


if __name__ == "__main__":
    port = int(read_config().get("port", DEFAULT_PORT))
    handler = partial(Handler, directory=str(PROJECT_ROOT))
    try:
        server = Server((HOST, port), handler)
    except OSError as error:
        sys.exit(f"blueprint: порт {port} недоступен ({error.strerror}); задай другой в blueprint/blueprint.json")
    threading.Thread(target=WATCHER.run, daemon=True).start()
    print(f"blueprint: http://localhost:{port}", flush=True)
    server.serve_forever()
