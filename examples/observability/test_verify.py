import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

from test_topology import fixture
import verify as cli


class QueryContractTest(unittest.TestCase):
    def test_v3_queries_and_otlp_evidence(self):
        services = []

        def request(url, body=None, headers=None):
            parsed = urlparse(url)
            if parsed.path == "/api/v3/services":
                return {"services": []}
            if parsed.path.endswith("/Emit"):
                return {"runIds": ["target"]}
            if parsed.path.endswith("/GetRun"):
                return {"status": "RUN_STATUS_COMPLETED", "attempt": 2}
            self.assertEqual(parsed.path, "/api/v3/traces")
            query = parse_qs(parsed.query)
            self.assertIn("query.startTimeMin", query)
            self.assertIn("query.startTimeMax", query)
            self.assertEqual(query["query.rawTraces"], ["true"])
            services.extend(query["query.serviceName"])
            return {"result": fixture()}

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "evidence"
            with patch("sys.argv", ["verify.py", "--output", str(output)]), \
                    patch.object(cli, "request", side_effect=request), \
                    patch.object(cli.uuid, "uuid4", return_value=SimpleNamespace(hex="a")):
                cli.main()
            self.assertEqual(services, ["walkthrough-engine", "walkthrough-python"])
            self.assertEqual(json.loads((output / "summary.json").read_text())["steps"], 3)
            self.assertIn("resourceSpans", json.loads((output / "traces.json").read_text()))
            self.assertEqual(json.loads((output / "request.json").read_text())["traceparent"], "00-a-a-01")

    def test_failed_query_readiness_does_not_emit(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("sys.argv", ["verify.py", "--output", str(Path(directory) / "evidence")]), \
                    patch.object(cli, "request", side_effect=HTTPError("query", 404, "Not Found", {}, None)) as request:
                with self.assertRaises(HTTPError):
                    cli.main()
            request.assert_called_once_with("http://localhost:16686/api/v3/services")


if __name__ == "__main__":
    unittest.main()
