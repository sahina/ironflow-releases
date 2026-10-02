"""One durable function. Each step is memoized, so a crash resumes after the last one."""

from ironflow.worker import Worker, function


@function(id="process-order", name="Process order", triggers=[{"event": "order.placed"}])
async def process_order(ctx):
    order = ctx.event.data
    priced = await ctx.step.run(
        "price",
        lambda: {"order_id": order["order_id"], "total": round(order["amount"] * 1.08, 2)},
    )
    return await ctx.step.run("receipt", lambda: {**priced, "receipt": f"r-{order['order_id']}"})


if __name__ == "__main__":
    # server_url and api_key come from IRONFLOW_SERVER_URL and IRONFLOW_API_KEY,
    # which entrypoint.sh exports. run() drains on SIGTERM.
    Worker(functions=[process_order]).run()
