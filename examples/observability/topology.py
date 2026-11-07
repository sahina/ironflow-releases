"""Check Jaeger v3 OTLP JSON using span identity and native links."""


def attributes(span):
    result = {}
    for attribute in span.get("attributes", []):
        value = attribute["value"]
        result[attribute["key"]] = int(value["intValue"]) if "intValue" in value else next(iter(value.values()))
    return result


def identity(span):
    return span["traceId"], span["spanId"]


def references(span, kind):
    if kind == "parent":
        parent = span.get("parentSpanId", "")
        return {(span["traceId"], parent)} if parent and parent != "0" * 16 else set()
    return {(link["traceId"], link["spanId"]) for link in span.get("links", [])}


def verify(document, run_id, producer_trace):
    spans = {identity(span): span for resource in document["resourceSpans"]
             for scope in resource.get("scopeSpans", []) for span in scope.get("spans", [])}
    assignments = sorted(
        (s for s in spans.values() if s["name"] == "Run: trace-walkthrough" and attributes(s).get("run.id") == run_id),
        key=lambda s: int(s["startTimeUnixNano"]),
    )
    assert len(assignments) == 3, f"expected initial, sleep, retry assignments; got {len(assignments)}"
    first = assignments[0]
    assert first["traceId"] == producer_trace, "first assignment lost HTTP producer trace"
    parents = references(first, "parent")
    assert len(parents) == 1 and parents <= spans.keys(), "missing emit parent"
    emitter = spans[next(iter(parents))]
    assert emitter["name"] == "eventtrigger.Emit", "first assignment must follow event emission"
    http_parents = references(emitter, "parent")
    assert len(http_parents) == 1 and http_parents <= spans.keys(), "missing HTTP parent"
    http_parent = spans[next(iter(http_parents))]
    http_tags = attributes(http_parent)
    assert http_tags.get("http.route") == "/ironflow.v1.IronflowService/", "unexpected HTTP service mount"
    assert (http_tags.get("rpc.service"), http_tags.get("rpc.method")) == (
        "ironflow.v1.IronflowService", "Emit",
    ), "first parent must be the Emit RPC"
    assert len({s["traceId"] for s in assignments}) == 3, "later segments must have distinct trace IDs"
    assert [attributes(s).get("ironflow.attempt") for s in assignments] == [1, 1, 2], "unexpected assignment attempts"
    trace_ids = {s["traceId"] for s in assignments}
    all_processes = [s for s in spans.values() if s["traceId"] in trace_ids and s["name"] == "process"]
    all_steps = [s for s in spans.values() if s["traceId"] in trace_ids and s["name"] == "step.run"]
    assert len(all_processes) == 3, "expected three SDK process spans across fixture traces"
    assert len(all_steps) == 3, "expected three executed callbacks, with memoized callbacks omitted"
    for index, assignment in enumerate(assignments):
        anchor = identity(assignment)
        if index:
            assert not references(assignment, "parent"), "later assignment must be a root"
            required = {identity(first), identity(assignments[index - 1])}
            assert required <= references(assignment, "links"), "missing first/preceding segment links"
        processes = [s for s in spans.values() if s["name"] == "process" and anchor in references(s, "parent")]
        assert len(processes) == 1, "expected one SDK process directly under accepted assignment"
        process = processes[0]
        assert process["traceId"] == assignment["traceId"], "SDK process split trace"
        steps = [s for s in spans.values() if s["name"] == "step.run" and identity(process) in references(s, "parent")]
        assert len(steps) == 1, "expected one executed callback per segment, with memoized callback omitted"
        assert steps[0]["traceId"] == process["traceId"], "step split trace"
        assert (process.get("status", {}).get("code") in (2, "STATUS_CODE_ERROR")) == (index == 1), "only intentional failure should mark process error"
        assert (steps[0].get("status", {}).get("code") in (2, "STATUS_CODE_ERROR")) == (index == 1), "only intentional failure should mark callback error"
    return {"run_id": run_id, "trace_ids": [s["traceId"] for s in assignments], "assignments": 3, "processes": 3, "steps": 3}
