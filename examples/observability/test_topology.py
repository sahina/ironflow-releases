import copy
import unittest

from topology import verify


def fixture():
    spans = []

    def span(trace, sid, name, refs=(), values=None, failed=False):
        value = {"traceId": trace, "spanId": sid, "name": name,
                 "startTimeUnixNano": str(len(spans)), "links": [], "attributes": [
                     {"key": key, "value": {"intValue": str(val)} if isinstance(val, int) else {"stringValue": val}}
                     for key, val in (values or {}).items()
                 ], "status": {"code": 2 if failed else 0}}
        for kind, tid, parent in refs:
            if kind == "parent":
                assert tid == trace
                value["parentSpanId"] = parent
            else:
                value["links"].append({"traceId": tid, "spanId": parent})
        spans.append(value)
        return value

    span("a", "http", "POST", values={
        "http.route": "/ironflow.v1.IronflowService/",
        "rpc.service": "ironflow.v1.IronflowService", "rpc.method": "Emit",
    })
    for i, trace in enumerate(("a", "b", "c")):
        refs = [("parent", "a", "emit")] if i == 0 else [("links", "a", "run")]
        if i == 2:
            refs.append(("links", "b", "run"))
        span(trace, "run", "Run: trace-walkthrough", refs, {"run.id": "target", "ironflow.attempt": 2 if i == 2 else 1})
        span(trace, "job", "process", [("parent", trace, "run")], failed=i == 1)
        span(trace, "step", "step.run", [("parent", trace, "job")], failed=i == 1)
    for value in spans[1:]:
        value["startTimeUnixNano"] = str(int(value["startTimeUnixNano"]) + 1)
    emitter = span("a", "emit", "eventtrigger.Emit", [("parent", "a", "http")])
    emitter["startTimeUnixNano"] = "1"
    return {"resourceSpans": [{"scopeSpans": [{"spans": spans}]}]}


class TopologyTest(unittest.TestCase):
    def setUp(self):
        self.document = copy.deepcopy(fixture())
        self.spans = self.document["resourceSpans"][0]["scopeSpans"][0]["spans"]

    def test_expected_topology(self):
        self.assertEqual(verify(self.document, "target", "a")["trace_ids"], ["a", "b", "c"])

    def test_missing_preceding_link(self):
        self.spans[7]["links"].pop()
        with self.assertRaisesRegex(AssertionError, "missing first/preceding"):
            verify(self.document, "target", "a")

    def test_poll_cannot_parent_job(self):
        self.spans[2]["parentSpanId"] = "http"
        with self.assertRaisesRegex(AssertionError, "SDK process"):
            verify(self.document, "target", "a")

    def test_resume_cannot_be_child(self):
        self.spans[4]["parentSpanId"] = "run"
        with self.assertRaisesRegex(AssertionError, "must be a root"):
            verify(self.document, "target", "a")

    def test_memoized_callback_must_not_repeat(self):
        self.spans.append({**self.spans[6], "spanId": "extra-step"})
        with self.assertRaisesRegex(AssertionError, "memoized"):
            verify(self.document, "target", "a")

    def test_http_trace_must_continue(self):
        with self.assertRaisesRegex(AssertionError, "HTTP producer"):
            verify(self.document, "target", "other")

    def test_only_failed_process_is_error(self):
        self.spans[2]["status"]["code"] = 2
        with self.assertRaisesRegex(AssertionError, "intentional failure"):
            verify(self.document, "target", "a")

    def test_step_must_parent_to_job(self):
        self.spans[3]["parentSpanId"] = "run"
        with self.assertRaisesRegex(AssertionError, "callback"):
            verify(self.document, "target", "a")

    def test_actual_bounded_route_with_rpc_identity(self):
        self.assertEqual(verify(self.document, "target", "a")["steps"], 3)

    def test_orphan_callback_must_not_be_ignored(self):
        self.spans.append({**self.spans[3], "spanId": "orphan", "parentSpanId": ""})
        with self.assertRaisesRegex(AssertionError, "callback"):
            verify(self.document, "target", "a")

    def test_http_parent_must_be_emit(self):
        self.spans[0]["attributes"][-1]["value"]["stringValue"] = "GetRun"
        with self.assertRaisesRegex(AssertionError, "Emit RPC"):
            verify(self.document, "target", "a")

    def test_assignment_cannot_skip_emission_span(self):
        self.spans[1]["parentSpanId"] = "http"
        with self.assertRaisesRegex(AssertionError, "event emission"):
            verify(self.document, "target", "a")

    def test_emission_must_parent_to_http(self):
        self.spans[-1]["parentSpanId"] = "missing"
        with self.assertRaisesRegex(AssertionError, "HTTP parent"):
            verify(self.document, "target", "a")

    def test_attempt_sequence_must_include_one_retry(self):
        self.spans[7]["attributes"][-1]["value"]["intValue"] = "1"
        with self.assertRaisesRegex(AssertionError, "assignment attempts"):
            verify(self.document, "target", "a")

    def test_failed_callback_must_have_error_status(self):
        self.spans[6]["status"] = {}
        with self.assertRaisesRegex(AssertionError, "callback error"):
            verify(self.document, "target", "a")

    def test_orphan_process_must_not_be_ignored(self):
        self.spans.append({**self.spans[2], "spanId": "orphan", "parentSpanId": ""})
        with self.assertRaisesRegex(AssertionError, "SDK process"):
            verify(self.document, "target", "a")


if __name__ == "__main__":
    unittest.main()
