import Link from "next/link";
import { ArrowRight, Filter, Radio, Send } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const eventPages = [
  {
    title: "Emit Events",
    description: "Send custom events to the Ironflow server",
    icon: Send,
    href: "/events/emit",
  },
  {
    title: "Subscribe",
    description: "Subscribe to real-time event streams",
    icon: Radio,
    href: "/events/subscribe",
  },
  {
    title: "Patterns",
    description: "See how wildcard pattern matching works",
    icon: Filter,
    href: "/events/patterns",
  },
];

export default function EventsPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Events</h1>
        <p className="text-muted-foreground">
          Emit and subscribe to real-time events with pattern matching
          capabilities.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {eventPages.map((page) => {
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
