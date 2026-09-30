import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_FILE = Path(__file__).parent / "blueprint.json"
HOST = "127.0.0.1"
DEFAULT_PORT = 5190
PAGE_URL = "/blueprint/"
HIDDEN_PREFIXES = (".git", ".env")


def read_config() -> dict:
    return json.loads(CONFIG_FILE.read_text())


def writable_files(config: dict) -> set[str]:
    return {tab["file"] for tab in config["tabs"] if tab["type"] == "excalidraw"}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", PAGE_URL)
            self.end_headers()
            return
        if any(part.startswith(HIDDEN_PREFIXES) for part in path.split("/")):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if url.path != "/api/save":
            self.send_error(404)
            return
        if self.headers.get("Origin") not in (None, f"http://{self.headers.get('Host')}"):
            self._send_json(403, b'{"error":"foreign origin"}')
            return
        relative = parse_qs(url.query).get("path", [""])[0]
        if relative not in writable_files(read_config()):
            self._send_json(403, b'{"error":"path is not writable"}')
            return
        target = (PROJECT_ROOT / relative).resolve()
        if PROJECT_ROOT not in target.parents:
            self._send_json(403, b'{"error":"path is outside the project"}')
            return
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
