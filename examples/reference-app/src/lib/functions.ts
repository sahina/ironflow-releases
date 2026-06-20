import { ironflow } from "@ironflow/node"
import { EVENTS } from "./events"

export const simpleWorkflow = ironflow.createFunction(
  {
    id: "simple-workflow",
    description: "Minimal workflow example. Runs a single durable step and returns the input with a timestamp. Good starting point for understanding how createFunction works.",
    triggers: [{ event: EVENTS.DemoSimple }],
    recording: true,
  },
  async ({ event, step }) => {
    const result = await step.run("process", async () => {
      return {
        message: "Hello from simple workflow",
        input: event.data,
        processedAt: new Date().toISOString(),
      }
    })
    return result
  }
)

export const advancedWorkflow = ironflow.createFunction(
  {
    id: "advanced-workflow",
    description: "Demonstrates sleep, waitForEvent, and parallel steps in sequence. Fetches data, sleeps 3s, waits for a demo.approved event (5m timeout), then runs two tasks in parallel.",
    triggers: [{ event: EVENTS.DemoAdvanced }],
    recording: true,
  },
  async ({ event, step }) => {
    const data = await step.run("fetch-data", async () => {
      return { items: ["item-a", "item-b", "item-c"] }
    })

    await step.sleep("wait-3s", "3s")

    const approval = await step.waitForEvent("wait-approval", {
      event: EVENTS.DemoApproved,
      timeout: "5m",
    })

    const results = await Promise.all([
      step.run("task-a", async () => ({ task: "A", completed: true })),
      step.run("task-b", async () => ({ task: "B", completed: true })),
    ])

    return {
      data,
      approval: approval.data,
      parallelResults: results,
      completedAt: new Date().toISOString(),
    }
  }
)

export const hotPatchDemo = ironflow.createFunction(
  {
    id: "hot-patch-demo",
    description: "Three-step pipeline for live patching demos. Pass failAtStep:'process-data' or failAtStep:'store-result' to trigger a failure, then use scoped injection to fix the output and resume.",
    triggers: [{ event: EVENTS.DemoHotPatch }],
    recording: true,
  },
  async ({ event, step }) => {
    const fetchResult = await step.run("fetch-data", async () => {
      return { source: "external-api", records: 42 }
    })

    const processResult = await step.run("process-data", async () => {
      const data = event.data as { failAtStep?: string }
      if (data.failAtStep === "process-data") {
        throw new Error("Simulated processing failure")
      }
      return { processed: true, recordCount: fetchResult.records }
    })

    const storeResult = await step.run("store-result", async () => {
      const data = event.data as { failAtStep?: string }
      if (data.failAtStep === "store-result") {
        throw new Error("Simulated storage failure")
      }
      return { stored: true, location: "s3://results/output.json" }
    })

    return { fetchResult, processResult, storeResult }
  }
)

export const parallelDemo = ironflow.createFunction(
  {
    id: "parallel-demo",
    description: "Runs four branches (A/B/C/D) in parallel with configurable concurrency and error policy. Pass injectError:true to trigger a failure and compare failFast vs allSettled behavior.",
    triggers: [{ event: EVENTS.DemoParallel }],
    recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as {
      concurrency?: number
      onError?: "failFast" | "allSettled"
      injectError?: boolean
    }

    const results = await step.parallel(
      "parallel-branches",
      [
        () =>
          step.run("branch-a", async () => {
            await new Promise((r) => setTimeout(r, 1000))
            return { branch: "A", duration: "1s" }
          }),
        () =>
          step.run("branch-b", async () => {
            await new Promise((r) => setTimeout(r, 1500))
            if (data.injectError) throw new Error("Branch B failed")
            return { branch: "B", duration: "1.5s" }
          }),
        () =>
          step.run("branch-c", async () => {
            await new Promise((r) => setTimeout(r, 800))
            return { branch: "C", duration: "0.8s" }
          }),
        () =>
          step.run("branch-d", async () => {
            await new Promise((r) => setTimeout(r, 2000))
            return { branch: "D", duration: "2s" }
          }),
      ],
      {
        concurrency: data.concurrency ?? 4,
        onError: data.onError ?? "failFast",
      }
    )

    return { results, completedAt: new Date().toISOString() }
  }
)

export const mapDemo = ironflow.createFunction(
  {
    id: "map-demo",
    description: "Processes a list of items in parallel using step.map with configurable concurrency (default 3). Each item runs as a separate durable step. Pass failAtItem to test error handling.",
    triggers: [{ event: EVENTS.DemoMap }],
    recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as {
      items?: Array<{ id: string; value: number }>
      concurrency?: number
      onError?: "failFast" | "allSettled"
      failAtItem?: string
    }

    const items = data.items ?? [
      { id: "item-1", value: 10 },
      { id: "item-2", value: 20 },
      { id: "item-3", value: 30 },
      { id: "item-4", value: 40 },
      { id: "item-5", value: 50 },
    ]

    const results = await step.map("process-items", items, async (item, itemStep) => {
      return itemStep.run(`process-${item.id}`, async () => {
        await new Promise((r) => setTimeout(r, 1000))
        if (data.failAtItem && item.id === data.failAtItem) {
          throw new Error(`Processing failed for ${item.id}`)
        }
        return { ...item, processed: true, doubled: item.value * 2 }
      })
    }, {
      concurrency: data.concurrency ?? 3,
      onError: data.onError ?? "failFast",
    })

    return { results, total: results.length }
  }
)

export const sleepUntilDemo = ironflow.createFunction(
  {
    id: "sleep-until-demo",
    description: "Sleeps until an absolute future timestamp, then records the wake-up time. Pass offsetSeconds to control the delay (default 10s). Demonstrates step.sleepUntil for time-based scheduling.",
    triggers: [{ event: EVENTS.DemoSleepUntil }],
    recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { offsetSeconds?: number }
    const offsetSeconds = data.offsetSeconds ?? 10

    const targetTime = new Date(Date.now() + offsetSeconds * 1000)

    await step.sleepUntil("sleep-until-target", targetTime.toISOString())

    const result = await step.run("after-sleep", async () => {
      return {
        wokeAt: new Date().toISOString(),
        targetWas: targetTime.toISOString(),
        message: `Woke up after sleeping until ${targetTime.toISOString()}`,
      }
    })

    return result
  }
)

const cronHandler = async ({ step }: { step: Parameters<Parameters<typeof ironflow.createFunction>[1]>[0]["step"] }) => {
  const report = await step.run("generate-report", async () => {
    return {
      generatedAt: new Date().toISOString(),
      metrics: {
        activeUsers: Math.floor(Math.random() * 100),
        requestsPerMinute: Math.floor(Math.random() * 1000),
        errorRate: (Math.random() * 5).toFixed(2) + "%",
      },
    }
  })
  return report
}

export const cronReporter1m = ironflow.createFunction(
  {
    id: "cron-reporter-1m",
    description: "Cron function that fires every minute and generates a metrics snapshot (active users, request rate, error rate). Demonstrates scheduled functions.",
    triggers: [{ event: EVENTS.CronReporter1m, cron: "* * * * *" }],
      recording: true,
  },
  cronHandler
)

export const cronReporter2m = ironflow.createFunction(
  {
    id: "cron-reporter-2m",
    description: "Cron function that fires every 2 minutes and generates a metrics snapshot. Same handler as cron-reporter-1m — use to compare run cadences.",
    triggers: [{ event: EVENTS.CronReporter2m, cron: "*/2 * * * *" }],
      recording: true,
  },
  cronHandler
)

export const cronReporter5m = ironflow.createFunction(
  {
    id: "cron-reporter-5m",
    description: "Cron function that fires every 5 minutes and generates a metrics snapshot. Same handler as cron-reporter-1m — use to compare run cadences.",
    triggers: [{ event: EVENTS.CronReporter5m, cron: "*/5 * * * *" }],
      recording: true,
  },
  cronHandler
)

export const concurrencyDemo = ironflow.createFunction(
  {
    id: "concurrency-demo",
    description: "Limits concurrent runs to 2 per customerId. Each run takes 3 seconds. Invoke multiple times with the same customerId to see queuing in action.",
    triggers: [{ event: EVENTS.DemoConcurrency }],
    concurrency: { limit: 2, key: "customerId" },
      recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { customerId: string }

    const result = await step.run("slow-process", async () => {
      await new Promise((r) => setTimeout(r, 3000))
      return {
        customerId: data.customerId,
        processedAt: new Date().toISOString(),
        duration: "3s",
      }
    })

    return result
  }
)

export const actorDemo = ironflow.createFunction(
  {
    id: "actor-demo",
    description: "Routes all runs for the same userId to the same worker instance using actorKey. Useful for stateful per-user workflows that must run sequentially.",
    triggers: [{ event: EVENTS.DemoActor }],
    actorKey: "userId",
      recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { userId: string }

    const result = await step.run("user-task", async () => {
      return {
        userId: data.userId,
        workerId: process.env.HOSTNAME || "unknown",
        processedAt: new Date().toISOString(),
      }
    })

    return result
  }
)

// --- Step-Level Timeouts Demo ---
export const timeoutDemo = ironflow.createFunction(
  {
    id: "timeout-demo",
    description: "Demonstrates per-step timeouts. The risky-step sleeps 15s and will be killed by the 10s function-level stepTimeout. Pass slowStepMs and perStepTimeout to control the timed-step behavior.",
    triggers: [{ event: EVENTS.DemoTimeout }],
    stepTimeout: "10s",
    // Don't retry on timeout — the demo is showing the timeout behavior itself
    retry: { maxAttempts: 1 },
      recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { slowStepMs?: number; perStepTimeout?: string }

    const fast = await step.run("fast-step", async () => {
      return { message: "Fast step completed", duration: "50ms" }
    })

    const timed = await step.run(
      "timed-step",
      async () => {
        const delayMs = data.slowStepMs ?? 2000
        await new Promise((r) => setTimeout(r, delayMs))
        return { message: "Timed step completed", actualDuration: `${delayMs}ms` }
      },
      { timeout: data.perStepTimeout ?? "5s" }
    )

    const risky = await step.run("risky-step", async () => {
      await new Promise((r) => setTimeout(r, 15000))
      return { message: "This should timeout" }
    })

    return { fast, timed, risky }
  }
)

// --- step.invoke() Demo ---
export const calculateTotal = ironflow.createFunction(
  {
    id: "calculate-total",
    description: "Helper function with no event triggers — invocable only via step.invoke() or step.invokeAsync(). Computes a cart total from a list of {price, qty} items.",
    // Empty triggers — this function is only invocable via step.invoke() / step.invokeAsync()
    triggers: [],
      recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { items: Array<{ price: number; qty: number }> }
    const total = await step.run("compute", async () => {
      return data.items.reduce((sum, item) => sum + item.price * item.qty, 0)
    })
    return { total, currency: "USD", calculatedAt: new Date().toISOString() }
  }
)

export const invokeDemo = ironflow.createFunction(
  {
    id: "invoke-demo",
    description: "Demonstrates step.invoke() and step.invokeAsync(). Pass mode:'sync' to call calculate-total and await the result inline, or mode:'async' to fire-and-forget and get a child run ID.",
    triggers: [{ event: EVENTS.DemoInvoke }],
    recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { mode?: "sync" | "async" }

    const items = [
      { price: 29.99, qty: 2 },
      { price: 49.99, qty: 1 },
    ]

    if (data.mode === "async") {
      const { runId } = await step.invokeAsync("calculate-total", { items })
      return { mode: "async", childRunId: runId }
    }

    const result = await step.invoke<{ total: number; currency: string; calculatedAt: string }>(
      "calculate-total",
      { items },
      { timeout: "30s" }
    )
    return { mode: "sync", result }
  }
)

// --- Saga Compensation Demo ---
export const sagaDemo = ironflow.createFunction(
  {
    id: "saga-demo",
    description: "Travel booking saga with automatic compensation. Books hotel → flight → payment in sequence, each with a registered rollback. Pass failAtStep:'book-flight' or 'charge-payment' to trigger compensation.",
    triggers: [{ event: EVENTS.DemoSaga }],
    recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { failAtStep?: string }

    const hotel = await step.run("reserve-hotel", async () => {
      return { reservationId: `HTL-${Date.now()}`, hotel: "Grand Plaza", nights: 3 }
    })
    step.compensate("reserve-hotel", async () => {
      console.log(`Cancelling hotel reservation ${hotel.reservationId}`)
    })

    if (data.failAtStep === "book-flight") {
      throw new Error("Simulated flight booking failure")
    }
    const flight = await step.run("book-flight", async () => {
      return { bookingRef: `FLT-${Date.now()}`, route: "NYC → LON" }
    })
    step.compensate("book-flight", async () => {
      console.log(`Cancelling flight ${flight.bookingRef}`)
    })

    if (data.failAtStep === "charge-payment") {
      throw new Error("Simulated payment failure")
    }
    const payment = await step.run("charge-payment", async () => {
      return { chargeId: `PAY-${Date.now()}`, amount: 1250.0 }
    })
    step.compensate("charge-payment", async () => {
      console.log(`Refunding charge ${payment.chargeId}`)
    })

    if (data.failAtStep === "send-confirmation") {
      throw new Error("Simulated confirmation failure")
    }
    const confirmation = await step.run("send-confirmation", async () => {
      return { emailSent: true, sentAt: new Date().toISOString() }
    })

    return { hotel, flight, payment, confirmation }
  }
)

// --- Developer Pub/Sub Workflow Demo ---
export const pubsubWorkflowDemo = ironflow.createFunction(
  {
    id: "pubsub-workflow-demo",
    description: "Publishes an event to a configurable topic from inside a workflow step using step.publish. Pass topic and message to control the output. Demonstrates workflow-to-pubsub integration.",
    triggers: [{ event: EVENTS.DemoPubSubWorkflow }],
    recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { topic?: string; message?: string }
    const topic = data.topic ?? EVENTS.DemoNotifications

    const result = await step.publish(topic, {
      message: data.message ?? "Published from workflow step",
      publishedAt: new Date().toISOString(),
    })

    return { published: true, eventId: result.eventId, sequence: result.sequence }
  }
)

// --- Secrets Management Demo ---
export const secretsDemo = ironflow.createFunction(
  {
    id: "secrets-demo",
    description: "Reads DEMO_API_KEY and DEMO_WEBHOOK_URL secrets at runtime via step.secrets. Returns a masked preview confirming availability without exposing the raw values.",
    triggers: [{ event: EVENTS.DemoSecrets }],
    secrets: ["DEMO_API_KEY", "DEMO_WEBHOOK_URL"],
      recording: true,
  },
  async ({ step, secrets }) => {
    const hasApiKey = secrets.has("DEMO_API_KEY")
    const hasWebhookUrl = secrets.has("DEMO_WEBHOOK_URL")

    const result = await step.run("use-secrets", async () => {
      const apiKey = hasApiKey ? secrets.get("DEMO_API_KEY") : "not-configured"
      const webhookUrl = hasWebhookUrl ? secrets.get("DEMO_WEBHOOK_URL") : "not-configured"

      return {
        apiKeyPresent: hasApiKey,
        apiKeyPreview: apiKey ? apiKey.substring(0, 4) + "****" : "N/A",
        webhookUrlPresent: hasWebhookUrl,
        webhookUrlPreview: webhookUrl ? webhookUrl.substring(0, 20) + "..." : "N/A",
        checkedAt: new Date().toISOString(),
      }
    })

    return result
  }
)

// Push mode functions (served by Next.js API route)
export const pushFunctions = [
  simpleWorkflow,
  advancedWorkflow,
  hotPatchDemo,
  parallelDemo,
  mapDemo,
  sleepUntilDemo,
  cronReporter1m,
  cronReporter2m,
  cronReporter5m,
  concurrencyDemo,
  actorDemo,
  timeoutDemo,
  calculateTotal,
  invokeDemo,
  sagaDemo,
  pubsubWorkflowDemo,
  secretsDemo,
]

// All functions (used by the API route handler)
export const allFunctions = pushFunctions
