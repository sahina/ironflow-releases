"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ironflow } from "@ironflow/browser";
import type { ConfigEntry, ConfigResponse } from "@ironflow/browser";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ErrorAlert } from "@/components/error-alert";

function EditorPageContent() {
  const searchParams = useSearchParams();
  const initialConfig = searchParams.get("config") || "";
  const [configName, setConfigName] = useState(initialConfig);
  const [result, setResult] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  const loadConfigs = useCallback(async () => {
    if (!ironflow.isConfigured) return;
    setListLoading(true);
    try {
      setConfigs(await ironflow.configManager().list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list configs");
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async (name: string) => {
    if (!name.trim()) {
      setError("Config name is required.");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      setResult(await ironflow.configManager().get(name.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (initialConfig && ironflow.isConfigured) void loadConfig(initialConfig);
  }, [initialConfig, loadConfig]);

  const filtered = configs.filter((config) => config.name.includes(filter));

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Config Reader</h1>
        <p className="text-muted-foreground">
          Browser applications can read configuration and watch for changes.
          Use a trusted server-side client, the CLI, or dashboard for mutations.
        </p>
      </section>

      <ErrorAlert message={error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Get Config</CardTitle>
            <CardDescription>Read one named configuration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="configName">Config Name</Label>
              <Input id="configName" value={configName} onChange={(event) => setConfigName(event.target.value)} placeholder="e.g., app-settings" />
            </div>
            <Button onClick={() => void loadConfig(configName)} disabled={loading} className="w-full">
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Get Config
            </Button>
            {result && (
              <div className="bg-muted rounded-md p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name:</span>
                  <code className="font-mono">{result.name}</code>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Revision:</span>
                  <Badge variant="secondary">rev {result.revision}</Badge>
                </div>
                <pre className="bg-background p-2 rounded text-xs overflow-x-auto">{JSON.stringify(result.data, null, 2)}</pre>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Browse Configs</CardTitle>
            <CardDescription>{configs.length} available</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by name" />
              <Button variant="outline" size="sm" onClick={() => void loadConfigs()} disabled={listLoading}>
                <RefreshCw className={`h-4 w-4 ${listLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {filtered.map((config) => (
                <button
                  key={config.name}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm font-mono cursor-pointer flex items-center justify-between"
                  onClick={() => {
                    setConfigName(config.name);
                    void loadConfig(config.name);
                  }}
                >
                  <span>{config.name}</span>
                  <Badge variant="secondary" className="text-xs ml-2">rev {config.revision}</Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function EditorPage() {
  return <Suspense><EditorPageContent /></Suspense>;
}
