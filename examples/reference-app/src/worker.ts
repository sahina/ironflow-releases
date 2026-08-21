/**
 * Ironflow Worker Script (Pull Mode)
 *
 * Run with: pnpm run worker
 * For gRPC: pnpm run worker:grpc
 */
import { createWorker, ironflow, createProjection, createProjectionRunner } from "@ironflow/node"
import { EVENTS, STREAM_EVENTS } from "./lib/events"

// Worker-specific functions (long-running, simulated heavy processing)
const dataPipeline = ironflow.createFunction(
  {
    id: "data-pipeline",
    description: "Pull-mode pipeline: fetches 1500 records from a warehouse (2s), transforms to Parquet (3s), then validates output (2s). Demonstrates long-running pull workers with simulated I/O latency.",
    triggers: [{ event: EVENTS.WorkerDataPipeline }],
    mode: "pull",
      recording: true,
  },
  async ({ event, step }) => {
    const fetchResult = await step.run("fetch-raw-data", async () => {
      await new Promise((r) => setTimeout(r, 2000))
      return { records: 1500, source: "warehouse", fetchedAt: new Date().toISOString() }
    })

    const transformed = await step.run("transform-data", async () => {
      await new Promise((r) => setTimeout(r, 3000))
      return { transformed: fetchResult.records, format: "parquet", transformedAt: new Date().toISOString() }
    })

    const validated = await step.run("validate-data", async () => {
      await new Promise((r) => setTimeout(r, 2000))
      return { valid: transformed.transformed - 3, invalid: 3, validatedAt: new Date().toISOString() }
    })

    return { fetchResult, transformed, validated, completedAt: new Date().toISOString() }
  }
)

const batchProcessor = ironflow.createFunction(
  {
    id: "batch-processor",
    description: "Pull-mode batch processor using step.map with 3-worker concurrency. Processes N items (default 8) each taking 500–1500ms. Pass batchSize to control the load.",
    triggers: [{ event: EVENTS.WorkerBatchProcess }],
    mode: "pull",
      recording: true,
  },
  async ({ event, step }) => {
    const data = event.data as { batchSize?: number }
    const batchSize = data.batchSize ?? 8

    // Inside a step because Math.random() is not deterministic. Outside one,
    // a retry regenerates every value while the per-item steps below replay
    // their memoized outputs — the batch comes back as a mix of two attempts'
    // inputs. Memoizing the items pins them for the life of the run.
    const items = await step.run("build-batch", async () =>
      Array.from({ length: batchSize }, (_, i) => ({
        id: `item-${i + 1}`,
        value: Math.floor(Math.random() * 100),
      })))

    const results = await step.map("process-batch", items, async (item, itemStep) => {
      // The scoped `itemStep` is what makes each item its own memoized step —
      // ignore it and the whole map is one opaque, non-durable blob (#1671).
      return itemStep.run(`process:${item.id}`, async () => {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000))
        return { ...item, processed: true, result: item.value * 2 }
      })
    }, {
      concurrency: 3,
    })

    return { processed: results.length, results }
  }
)

const scheduledReport = ironflow.createFunction(
  {
    id: "scheduled-report",
    description: "Pull-mode cron function that fires every 30 seconds. Waits 5 seconds for data readiness via sleepUntil, then generates a summary report with simulated order stats.",
    triggers: [{ event: EVENTS.CronScheduledReport, cron: "*/30 * * * * *" }],
    mode: "pull",
      recording: true,
  },
  async ({ step }) => {
    const sleepTarget = new Date(Date.now() + 5000).toISOString()
    await step.sleepUntil("wait-for-data", sleepTarget)

    const report = await step.run("generate-report", async () => {
      await new Promise((r) => setTimeout(r, 2000))
      return {
        title: "Scheduled Report",
        generatedAt: new Date().toISOString(),
        summary: {
          totalOrders: Math.floor(Math.random() * 500),
          revenue: `$${(Math.random() * 50000).toFixed(2)}`,
          topProduct: "Widget Pro",
        },
      }
    })

    return report
  }
)

const balanceProjection = createProjection({
  name: "bank-account-balance",
  events: [STREAM_EVENTS.AccountOpened, STREAM_EVENTS.MoneyDeposited, STREAM_EVENTS.MoneyWithdrawn],
  initialState: () => ({ balance: 0, transactionCount: 0, lastTransaction: "" }),
  handler: (state: { balance: number; transactionCount: number; lastTransaction: string }, event: { name: string; data: unknown }) => {
    const data = event.data as Record<string, unknown>
    switch (event.name) {
      case STREAM_EVENTS.AccountOpened:
        return { ...state, lastTransaction: "opened" }
      case STREAM_EVENTS.MoneyDeposited:
        return {
          balance: state.balance + (Number(data.amount) || 0),
          transactionCount: state.transactionCount + 1,
          lastTransaction: `+${data.amount}`,
        }
      case STREAM_EVENTS.MoneyWithdrawn:
        return {
          balance: state.balance - (Number(data.amount) || 0),
          transactionCount: state.transactionCount + 1,
          lastTransaction: `-${data.amount}`,
        }
      default:
        return state
    }
  },
})

// Parse CLI args
const args = process.argv.slice(2)
const transportArg = args.find((a) => a.startsWith("--transport="))
const transport = transportArg ? transportArg.split("=")[1] : "polling"
const IRONFLOW_API_KEY = process.env.IRONFLOW_API_KEY

console.log(`Starting Ironflow worker (transport: ${transport})...`)

const worker = createWorker({
  functions: [dataPipeline, batchProcessor, scheduledReport],
  maxConcurrentJobs: 5,
  labels: { mode: "demo", transport },
})

worker.start().catch((err: Error) => {
  console.error("Worker failed:", err)
  process.exit(1)
})

// Start projection runner
const projectionRunner = createProjectionRunner({
  projection: balanceProjection,
  baseUrl: process.env.IRONFLOW_URL || "http://localhost:9123",
  headers: {
    ...(IRONFLOW_API_KEY && { Authorization: `Bearer ${IRONFLOW_API_KEY}` }),
  },
  logger: { info: console.log, warn: console.warn, error: console.error, debug: () => {} },
})

projectionRunner.start().catch((err: Error) => {
  console.error("Projection runner failed:", err)
})

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down worker...")
  projectionRunner.stop()
  await worker.drain()
  process.exit(0)
})
