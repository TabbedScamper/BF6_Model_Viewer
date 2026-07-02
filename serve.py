"""Dev server for the model library.
- html/js/css/json: Cache-Control no-cache (revalidate every load -> edits show up)
- models/*.glb: long cache (immutable payloads; URLs carry a ?b= mtime buster)
Usage: python serve.py [port]
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.split("?")[0].startswith("/models/"):
            self.send_header("Cache-Control", "public, max-age=604800")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ThreadingHTTPServer(("", port), H).serve_forever()
