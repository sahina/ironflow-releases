import Link from "next/link";
import { Database, HardDrive, Mail, MessageSquare, Radio, Workflow } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    title: "Events",
    description: "Emit, subscribe, and ingest webhooks as Ironflow events",
    icon: Mail,
    href: "/events/emit",
    items: ["Emit events", "Subscribe to streams", "Wildcard patterns", "Webhook ingestion"],
  },
  {
    title: "Pub/Sub",
    description: "First-class developer pub/sub with topics and subscriptions",
    icon: MessageSquare,
    href: "/pubsub/publish",
    items: ["Publish to topics", "Subscribe with patterns", "Publish from workflows"],
  },
  {
    title: "Workflows",
    description: "Durable workflows with invoke, sagas, timeouts, and secrets",
    icon: Workflow,
    href: "/workflows/trigger",
    items: ["Trigger workflows", "Cross-function invoke", "Saga compensation", "Step timeouts"],
  },
  {
    title: "Event Sourcing",
    description: "Entity streams, projections, and event versioning",
    icon: Database,
    href: "/event-sourcing/streams",
    items: ["Entity streams", "Projections", "Upcasting"],
  },
  {
    title: "KV Store",
    description: "Create buckets, manage keys, and watch for real-time changes",
    icon: HardDrive,
    href: "/kv/buckets",
    items: ["Bucket management", "Key CRUD & atomic ops", "Real-time watch"],
  },
  {
    title: "Real-time",
    description: "Connection management and consumer groups",
    icon: Radio,
    href: "/realtime/connection",
    items: ["Connection state", "Consumer groups", "Round-robin distribution"],
  },
];

export default function Home() {
  return (
    <div className="container mx-auto py-8 px-4">
      {/* Hero Section */}
      <section className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          Ironflow SDK Demo
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Explore the capabilities of the Ironflow SDK with interactive demos
          for events, workflows, and real-time subscriptions.
        </p>
      </section>

      {/* Feature Cards Grid */}
      <section className="grid gap-6 md:grid-cols-3 mb-12">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Link key={feature.title} href={feature.href}>
              <Card className="h-full transition-colors hover:bg-muted/50 cursor-pointer">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Icon className="h-6 w-6 text-primary" />
                    <CardTitle>{feature.title}</CardTitle>
                  </div>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                    {feature.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      {/* Quick Start Card */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
            <CardDescription>
              Get the Ironflow server running to explore these demos
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
              <code>{`# Start the Ironflow server
./build/ironflow dev

# In another terminal, start this Next.js demo
cd examples/reference-app
pnpm dev`}</code>
            </pre>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
