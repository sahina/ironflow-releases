import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface EventCardProps {
  /** Header content (left side) — typically a Badge with event name */
  children: React.ReactNode;
  /** Event data to render as formatted JSON */
  data: unknown;
  /** Event timestamp */
  timestamp: Date;
  /** Additional CSS classes for the container */
  className?: string;
  /** Inline styles (e.g., for animationDelay) */
  style?: React.CSSProperties;
}

export function EventCard({
  children,
  data,
  timestamp,
  className,
  style,
}: EventCardProps) {
  return (
    <div
      className={cn(
        "border rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2",
        className
      )}
      style={style}
    >
      <div className="flex items-center justify-between gap-2">
        {children}
        <span className="text-xs text-muted-foreground">
          {timestamp.toLocaleTimeString()}
        </span>
      </div>
      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

/** Convenience wrapper for the most common case: a Badge label */
export function EventCardWithBadge({
  name,
  data,
  timestamp,
  className,
  style,
}: Omit<EventCardProps, "children"> & { name: string }) {
  return (
    <EventCard
      data={data}
      timestamp={timestamp}
      className={className}
      style={style}
    >
      <Badge variant="secondary">{name}</Badge>
    </EventCard>
  );
}
