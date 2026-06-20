import Link from "next/link";
import { ArrowRight, History, Play, Workflow } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const workflowPages = [
  {
    title: "Trigger Workflows",
    description: "Start workflow executions and see results",
    icon: Play,
    href: "/workflows/trigger",
  },
  {
    title: "Run History",
    description: "View and inspect workflow run history",
    icon: History,
    href: "/workflows/runs",
  },
  {
    title: "Step Types",
    description: "Visualize different step types executing",
    icon: Workflow,
    href: "/workflows/steps",
  },
];

export default function WorkflowsPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Workflows</h1>
        <p className="text-muted-foreground">
          Trigger durable workflows and observe step execution.
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {workflowPages.map((page) => {
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
