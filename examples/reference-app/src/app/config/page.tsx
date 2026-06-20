import Link from "next/link";
import { ArrowRight, List, Pencil, Radio } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const configPages = [
  {
    title: "Configs",
    description: "Create, list, and delete config entries",
    icon: List,
    href: "/config/configs",
  },
  {
    title: "Editor",
    description: "Set, get, patch, and delete config data with an interactive editor",
    icon: Pencil,
    href: "/config/editor",
  },
  {
    title: "Watch",
    description: "Subscribe to real-time config change notifications",
    icon: Radio,
    href: "/config/watch",
  },
];

export default function ConfigPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Config Management
        </h1>
        <p className="text-muted-foreground">
          Manage application configuration with set, patch, and real-time watch.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {configPages.map((page) => {
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
