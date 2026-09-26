"""Launch ACE 3000 using only Python's standard library."""

import argparse
import errno
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener
import webbrowser


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"


class GameHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class GameServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def is_same_game(url):
    """Reuse a listener only when it returns this game's exact index document."""
    try:
        expected = (ROOT / "index.html").read_bytes()
        if b"<title>ACE 3000" not in expected or b'id="game"' not in expected:
            return False
        opener = build_opener(ProxyHandler({}))
        with opener.open(url, timeout=2) as response:
            return (
                response.status == 200
                and response.geturl() == url
                and response.headers.get_content_type() == "text/html"
                and response.read(len(expected) + 1) == expected
            )
    except (OSError, URLError, ValueError):
        return False


def open_browser(url):
    try:
        if not webbrowser.open(url, new=2):
            print("Open the address above in your browser to play.", flush=True)
    except webbrowser.Error:
        print("Open the address above in your browser to play.", flush=True)


def port_number(value):
    try:
        port = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("port must be a number from 1 to 65535") from exc
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return port


def main(argv=None):
    parser = argparse.ArgumentParser(description="Play ACE 3000 in your browser.")
    parser.add_argument("--port", type=port_number, default=8765, help="local port (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="serve without opening a browser")
    args = parser.parse_args(argv)
    url = f"http://{HOST}:{args.port}/"
    handler = partial(GameHandler, directory=str(ROOT))
    try:
        server = GameServer((HOST, args.port), handler)
    except OSError as exc:
        in_use = exc.errno == errno.EADDRINUSE or getattr(exc, "winerror", None) == 10048
        if in_use and is_same_game(url):
            print(f"ACE 3000 is already running: {url}", flush=True)
            if not args.no_browser:
                open_browser(url)
            return 0
        if in_use:
            print(f"Port {args.port} is in use by another app. Try: python serve.py --port {args.port + 1 if args.port < 65535 else 8765}", file=sys.stderr)
        else:
            print(f"Could not start ACE 3000: {exc}", file=sys.stderr)
        return 1

    with server:
        print(f"ACE 3000 is ready: {url}", flush=True)
        print("Keep this window open while playing. Press Ctrl+C to stop.", flush=True)
        if not args.no_browser:
            open_browser(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nACE 3000 stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
