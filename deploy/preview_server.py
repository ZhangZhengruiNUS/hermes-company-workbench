"""preview_server.py — 8902 端口: 静态 + /api/ 反代到 8081 (含 SSE 流式).
仅受限预览用; 生产走 nginx."""
import http.server, socketserver, urllib.request, socket

API = "http://127.0.0.1:8081"
ROOT = "/tmp/preview-www"

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            super().do_GET()

    def do_POST(self):
        self._proxy()

    def _proxy(self):
        url = API + self.path
        body = None
        if self.command == "POST":
            ln = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(ln) if ln else b""
        req = urllib.request.Request(url, data=body, method=self.command)
        for h in ("Content-Type", "Authorization"):
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        try:
            r = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as e:
            r = e
        except Exception as e:
            self.send_error(502, str(e))
            return
        ct = r.headers.get("Content-Type", "application/json")
        self.send_response(r.status if hasattr(r, "status") else 200)
        self.send_header("Content-Type", ct)
        self.send_header("Cache-Control", "no-store")
        if "event-stream" in ct:
            self.send_header("Connection", "keep-alive")
        self.end_headers()
        if "event-stream" in ct:
            # 流式: 按 read1 块转发(不逐字节), 15s 无数据发 SSE keepalive 注释
            self.connection.settimeout(15)
            try:
                while True:
                    try:
                        chunk = r.read1(4096)
                    except socket.timeout:
                        chunk = b""
                    if chunk:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    else:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                self.close_connection = True
        else:
            self.wfile.write(r.read())

    def send_response(self, code, message=None):
        # 强制 HTTP/1.1 (SSE 需要)
        self.protocol_version = "HTTP/1.1"
        super().send_response(code, message)

class TS(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

print("preview on 8902 (static+api proxy)")
TS(("127.0.0.1", 8902), H).serve_forever()
