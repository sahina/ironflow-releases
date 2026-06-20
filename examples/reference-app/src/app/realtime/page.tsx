import Link from "next/link";
import { ArrowRight, Cable, Users } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const realtimePages = [
  {
    title: "Connection State",
    description: "Monitor and control WebSocket connection",
    icon: Cable,
    href: "/realtime/connection",
  },
  {
    title: "Consumer Groups",
    description: "See round-robin distribution across subscribers",
    icon: Users,
    href: "/realtime/consumer-groups",
  },
];

export default function RealtimePage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Real-time</h1>
        <p className="text-muted-foreground">
          Connection management and consumer group distribution.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        {realtimePages.map((page) => {
          const Icon = page.icon;
          return (
            <Link key={page.title} href={page.href}>
              <Card className="h-full transition-colors hover:bg-muted/50 cursor-pointer">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Icon className="h-6 w-6 text-primary" />
                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <CardTitle>{page.title}</CardTitle>
                  <CardDescription>{page.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
