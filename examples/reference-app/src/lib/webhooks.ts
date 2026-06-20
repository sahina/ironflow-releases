import { createWebhook } from "@ironflow/node"

export const githubWebhook = createWebhook({
  id: "github",
  verify: async (req) => {
    // Production: verify HMAC-SHA256 from X-Hub-Signature-256 header using
    // your webhook secret. This demo skips signature verification for simplicity.
    // See: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
    if (process.env.NODE_ENV === "production") {
      throw new Error("GitHub webhook signature verification not configured for production")
    }
    return JSON.parse(req.body)
  },
  transform: (payload) => {
    const data = payload as Record<string, unknown>
    return {
      name: `github.${(data.action as string) || "push"}`,
      data: payload,
      idempotencyKey: data.delivery as string,
    }
  },
})

export const stripeWebhook = createWebhook({
  id: "stripe",
  verify: async (req) => {
    // Production: verify signature using Stripe's webhook secret and
    // stripe.webhooks.constructEvent(). This demo skips verification for simplicity.
    // See: https://docs.stripe.com/webhooks#verify-official-libraries
    if (process.env.NODE_ENV === "production") {
      throw new Error("Stripe webhook signature verification not configured for production")
    }
    return JSON.parse(req.body)
  },
  transform: (payload) => {
    const data = payload as Record<string, unknown>
    return {
      name: `stripe.${(data.type as string) || "event"}`,
      data: ((data.data as Record<string, unknown>)?.object as Record<string, unknown>) ?? payload,
      idempotencyKey: data.id as string,
    }
  },
})

export const allWebhooks = [githubWebhook, stripeWebhook]
