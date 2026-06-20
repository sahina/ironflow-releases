"use client";

import { useState } from "react";
import { ironflow } from "@ironflow/browser";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert } from "@/components/error-alert";

interface Preset {
  name: string;
  data: Record<string, unknown>;
}

interface EventEmitFormProps {
  /** Called after a successful emit with the event name and parsed data */
  onEmitted?: (name: string, data: unknown) => void;
  /** Preset quick-fire buttons */
  presets?: Preset[];
  /** Default event name */
  defaultName?: string;
  /** Default JSON payload string */
  defaultData?: string;
  /** Compact mode uses smaller textarea rows */
  compact?: boolean;
}

const DEFAULT_PRESETS: Preset[] = [
  { name: "user.created", data: { userId: "usr_123", email: "user@example.com" } },
  { name: "order.placed", data: { orderId: "ord_456", amount: 99.99 } },
  { name: "task.completed", data: { taskId: "task_789", status: "done" } },
];

export function EventEmitForm({
  onEmitted,
  presets = DEFAULT_PRESETS,
  defaultName = "demo.test",
  defaultData,
  compact = false,
}: EventEmitFormProps) {
  const [eventName, setEventName] = useState(defaultName);
  const [eventData, setEventData] = useState(
    defaultData ??
      JSON.stringify({ message: "Hello from the demo!", timestamp: new Date().toISOString() }, null, 2)
  );
  const [isEmitting, setIsEmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emitEvent = async (name: string, data: unknown) => {
    setIsEmitting(true);
    setError(null);
    try {
      await ironflow.emit(name, data);
      onEmitted?.(name, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to emit event");
    } finally {
      setIsEmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const parsed = JSON.parse(eventData);
      await emitEvent(eventName, parsed);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError("Invalid JSON: " + err.message);
      }
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className={compact ? "space-y-1" : "space-y-2"}>
          <Label htmlFor="emitName">Event Name</Label>
          <Input
            id="emitName"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="e.g., user.created, order.placed"
          />
        </div>
        <div className={compact ? "space-y-1" : "space-y-2"}>
          <Label htmlFor="emitData">JSON Payload</Label>
          <Textarea
            id="emitData"
            value={eventData}
            onChange={(e) => setEventData(e.target.value)}
            className={`font-mono text-sm ${compact ? "" : "min-h-[150px]"}`}
            rows={compact ? 3 : undefined}
            placeholder='{"key": "value"}'
          />
        </div>
        <ErrorAlert message={error} />
        <Button
          type="submit"
          disabled={isEmitting || !eventName.trim()}
          className={compact ? "w-full" : ""}
        >
          <Send className="h-4 w-4" />
          {isEmitting ? "Sending..." : compact ? "Send Event" : "Emit Event"}
        </Button>
      </form>
      {presets.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Presets:</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.name}
                variant="outline"
                size="sm"
                onClick={() => emitEvent(preset.name, preset.data)}
                disabled={isEmitting}
              >
                {compact ? preset.name : <><Send className="h-4 w-4" />{preset.name}</>}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
