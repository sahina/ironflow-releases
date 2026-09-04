import { OperationsView } from "@/components/views";
import { bootstrapKey, ironflowUrl } from "@/lib/env";

// Read per request, not baked in at build: the engine's port is discovered at
// boot, so a prerendered page would point at whatever port the build saw.
export const dynamic = "force-dynamic";

export default function OperationsPage() {
  return <OperationsView serverUrl={ironflowUrl()} apiKey={bootstrapKey()} />;
}
