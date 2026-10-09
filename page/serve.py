import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_FILE = Path(__file__).parent / "blueprint.json"
HOST = "127.0.0.1"
DEFAULT_PORT = 5190
PAGE_URL = "/blueprint/"
HIDDEN_PREFIXES = (".git", ".env")
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]")
FEEDBACK_NAME = "FEEDBACK.md"
MAX_BODY_BYTES = 20 * 1024 * 1024


def read_config() -> dict:
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def writable_files(config: dict) -> set[str]:
    schemes = {tab["file"] for tab in config["tabs"] if tab["type"] == "excalidraw"}
    feedback = {
        (Path(tab["src"]).parent / FEEDBACK_NAME).as_posix()
        for tab in config["tabs"]
        if tab["type"] == "frame" and "src" in tab
    }
    return schemes | feedback


def listed_folders(config: dict) -> dict[str, set[str]]:
    folders = {}
    for tab in config["tabs"]:
        if tab["type"] in ("docs", "adr"):
            folders[tab["dir"]] = set(tab.get("exclude", []))
    return folders


def hidden(name: str) -> bool:
    return name.lower().startswith(HIDDEN_PREFIXES)


def markdown_files(folder: str, exclude: set[str]) -> list[str]:
    root = (PROJECT_ROOT / folder).resolve()
    if root != PROJECT_ROOT and PROJECT_ROOT not in root.parents:
        return []
    files = []
    for path in sorted(root.rglob("*.md")):
        parts = path.relative_to(root).parts
        if any(hidden(part) or part in exclude for part in parts):
            continue
        files.append(path.relative_to(PROJECT_ROOT).as_posix())
    return files


def own_hosts(port: int) -> set[str]:
    return {f"{host}:{port}" for host in LOOPBACK_HOSTS}


class Handler(SimpleHTTPRequestHandler):
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
        if path == "/api/tree":
            self._send_tree(parse_qs(urlparse(self.path).query).get("dir", [""])[0])
            return
        super().do_GET()

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
        if not length.isdigit() or int(length) > MAX_BODY_BYTES:
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
            json.loads(body)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        self._send_json(200, b'{"ok":true}')

    def _send_json(self, status: int, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))


if __name__ == "__main__":
    port = int(read_config().get("port", DEFAULT_PORT))
    handler = partial(Handler, directory=str(PROJECT_ROOT))
    try:
        server = ThreadingHTTPServer((HOST, port), handler)
    except OSError as error:
        sys.exit(f"blueprint: порт {port} недоступен ({error.strerror}); задай другой в blueprint/blueprint.json")
    print(f"blueprint: http://localhost:{port}", flush=True)
    server.serve_forever()
