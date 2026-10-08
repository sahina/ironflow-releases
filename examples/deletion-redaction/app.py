"""Local customer-registration push app for the deletion blog verification."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class CustomerApp(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1_048_576:
                raise ValueError("invalid request size")
            request = json.loads(self.rfile.read(length))
            customer = request["event"]["data"]
            if not all(isinstance(customer.get(k), str) and customer[k] for k in ("name", "email")):
                raise ValueError("name and email are required")
            run_id = request["run_id"]
            if not isinstance(run_id, str) or not run_id:
                raise ValueError("run_id is required")
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            self.send_error(400, str(error))
            return

        # A deterministic lookup result; the engine persists this durable step.
        account = {"name": customer["name"], "email": customer["email"]}
        result = {"status": "completed", "result": account, "steps": [{
            "id": f"{run_id}:account-lookup:0", "name": "account-lookup",
            "type": "invoke", "status": "completed", "output": account,
        }]}
        body = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    with ThreadingHTTPServer(("127.0.0.1", 0), CustomerApp) as server:
        print(f"http://127.0.0.1:{server.server_port}", flush=True)
        server.serve_forever()
