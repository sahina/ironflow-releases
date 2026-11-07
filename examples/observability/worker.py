"""Polling fixture for the Jaeger walkthrough. Applications own OTel setup."""
import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from ironflow.worker import Worker, function

provider = TracerProvider(resource=Resource.create({"service.name": "walkthrough-python"}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
    endpoint=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
    insecure=True,
)))
trace.set_tracer_provider(provider)


@function(
    id="trace-walkthrough", triggers=[{"event": "trace.walkthrough"}],
    retry={"max_attempts": 3, "initial_delay": "1s", "max_delay": "1s", "on_exhausted": "fail"},
)
async def walkthrough(ctx):
    await ctx.step.run("before-sleep", lambda: "ok")
    await ctx.step.sleep("pause", "2s")

    async def transient():
        if ctx.run.attempt <= 1:
            raise RuntimeError("intentional walkthrough retry")
        return "ok"

    return await ctx.step.run("after-sleep", transient)


if __name__ == "__main__":
    try:
        Worker(functions=[walkthrough]).run()
    finally:
        provider.shutdown()
