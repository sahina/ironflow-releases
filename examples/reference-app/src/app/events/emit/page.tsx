"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EventEmitForm } from "@/components/event-emit-form";
import { EventCardWithBadge } from "@/components/event-card";

interface EmittedEvent {
  id: string;
  name: string;
  data: unknown;
  timestamp: Date;
}

export default function EmitEventsPage() {
  const [emittedEvents, setEmittedEvents] = useState<EmittedEvent[]>([]);

  const handleEmitted = (name: string, data: unknown) => {
    const newEvent: EmittedEvent = {
      id: crypto.randomUUID(),
      name,
      data,
      timestamp: new Date(),
    };
    setEmittedEvents((prev) => [newEvent, ...prev]);
  };

  const clearLog = () => {
    setEmittedEvents([]);
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Emit Events</h1>
        <p className="text-muted-foreground">
          Send custom events to the Ironflow server and see them logged in
          real-time.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Emit Form */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Emit Event</CardTitle>
              <CardDescription>
                Send any event with a custom name and JSON payload
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EventEmitForm onEmitted={handleEmitted} />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Event Log */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Event Log</CardTitle>
                <CardDescription>
                  {emittedEvents.length} event{emittedEvents.length !== 1 ? "s" : ""}{" "}
                  emitted
                </CardDescription>
              </div>
              {emittedEvents.length > 0 && (
                <Button variant="outline" size="sm" onClick={clearLog}>
                  <Trash2 className="h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {emittedEvents.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No events emitted yet. Use the form above to send your first
                  event.
                </p>
              ) : (
                emittedEvents.map((event) => (
                  <EventCardWithBadge
                    key={event.id}
                    name={event.name}
                    data={event.data}
                    timestamp={event.timestamp}
                  />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
