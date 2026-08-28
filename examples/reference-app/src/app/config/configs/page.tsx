"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ironflow } from "@ironflow/browser";
import type { ConfigEntry } from "@ironflow/browser";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorAlert } from "@/components/error-alert";

export default function ConfigsPage() {
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

  const loadConfigs = useCallback(async () => {
    setListError(null);
    if (!ironflow.isConfigured) {
      setListError("Client not configured. Please wait for connection.");
      return;
    }
    setLoading(true);
    try {
      setConfigs(await ironflow.configManager().list());
      setLoaded(true);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to list configs");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Configs</h1>
        <p className="text-muted-foreground">
          Browse environment configuration from the Browser SDK. Use a trusted
          server-side client, the CLI, or dashboard to make changes.
        </p>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Existing Configs</CardTitle>
              <CardDescription>{loaded ? `${configs.length} config${configs.length !== 1 ? "s" : ""}` : "Click refresh to load"}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadConfigs()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ErrorAlert message={listError} />
          {configs.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              {loaded ? "No configs found." : "Click Refresh to load existing configs."}
            </p>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Revision</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
                <TableBody>
                  {configs.map((config) => (
                    <TableRow key={config.name}>
                      <TableCell>
                        <button className="font-medium text-primary hover:underline cursor-pointer" onClick={() => router.push(`/config/editor?config=${encodeURIComponent(config.name)}`)}>
                          {config.name}
                        </button>
                      </TableCell>
                      <TableCell><Badge variant="secondary">rev {config.revision}</Badge></TableCell>
                      <TableCell className="text-xs">{new Date(config.updatedAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
