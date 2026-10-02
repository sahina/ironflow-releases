"""Flask API in front of Ironflow. The engine runs in the same container, on loopback."""

import os

from flask import Flask, jsonify, request
from protobuf.wkt import Struct

from ironflow import IronflowRPC, IronflowRPCError
from ironflow.rpc.v1 import GetRunRequest, RunStatus, TriggerRequest

app = Flask(__name__)

_STATUS = {RunStatus.COMPLETED: "completed", RunStatus.FAILED: "failed"}


def _rpc() -> IronflowRPC:
    # entrypoint.sh exports both variables before it starts gunicorn.
    return IronflowRPC(
        server_url=os.environ["IRONFLOW_SERVER_URL"],
        api_key=os.environ["IRONFLOW_API_KEY"],
    )


@app.get("/healthz")
def healthz():
    return jsonify(ok=True)


@app.post("/orders")
def place_order():
    order = request.get_json(silent=True) or {}
    if (
        not isinstance(order, dict)
        or not isinstance(order.get("order_id"), str)
        or not isinstance(order.get("amount"), (int, float))
    ):
        return jsonify(error='body must be {"order_id": string, "amount": number}'), 400
    with _rpc() as rpc:
        result = rpc.events.emit(TriggerRequest(event="order.placed", data=Struct.from_python(order)))
    if not result.run_ids:
        # The event is recorded but no function matched it: the worker has not
        # registered yet. That event starts no run, so the caller must retry.
        return jsonify(error="worker not registered yet, retry"), 503
    return jsonify(run_id=result.run_ids[0], event_id=result.event_id), 202


@app.get("/orders/<run_id>")
def get_order(run_id: str):
    try:
        with _rpc() as rpc:
            run = rpc.runs.get(GetRunRequest(id=run_id))
    except IronflowRPCError as e:
        if e.code == "not_found":
            return jsonify(error="no such run"), 404
        raise
    output = run.output.to_python() if run.status == RunStatus.COMPLETED else None
    return jsonify(run_id=run.id, status=_STATUS.get(run.status, "running"), output=output)
