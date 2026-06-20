"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ironflow } from "@ironflow/browser";
import type { ConfigEntry, ConfigResponse } from "@ironflow/browser";
import { Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorAlert } from "@/components/error-alert";

interface OpLogEntry {
  id: number;
  operation: string;
  name: string;
  success: boolean;
  detail: string;
  timestamp: Date;
}

function EditorPageContent() {
  const searchParams = useSearchParams();
  const initialConfig = searchParams.get("config") || "";

  // Tab state
  const [activeTab, setActiveTab] = useState("set");

  // Config operations
  const [configName, setConfigName] = useState(initialConfig);
  const [opValue, setOpValue] = useState('{\n  "example": true\n}');
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [getResult, setGetResult] = useState<ConfigResponse | null>(null);

  // Browse configs
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [configFilter, setConfigFilter] = useState("");
  const [configsLoading, setConfigsLoading] = useState(false);
  const [configsLoaded, setConfigsLoaded] = useState(false);

  // Operation log
  const [opLog, setOpLog] = useState<OpLogEntry[]>([]);
  const nextIdRef = useRef(1);

  const addLog = useCallback((operation: string, name: string, success: boolean, detail: string) => {
    const id = nextIdRef.current++;
    setOpLog((log) => [{ id, operation, name, success, detail, timestamp: new Date() }, ...log].slice(0, 20));
  }, []);

  const loadConfigs = useCallback(async () => {
    if (!ironflow.isConfigured) return;
    setConfigsLoading(true);
    try {
      const result = await ironflow.configManager().list();
      setConfigs(result);
      setConfigsLoaded(true);
    } catch (err) {
      addLog("list", "*", false, err instanceof Error ? err.message : "Failed");
    } finally {
      setConfigsLoading(false);
    }
  }, [addLog]);

  const handleSet = async () => {
    setOpError(null);
    if (!configName.trim()) { setOpError("Config name is required."); return; }
    let parsed: Record<string, unknown>;
    try {
      const result = JSON.parse(opValue);
      if (typeof result !== "object" || result === null || Array.isArray(result)) {
        setOpError("JSON data must be a valid object."); return;
      }
      parsed = result as Record<string, unknown>;
    } catch { setOpError("Invalid JSON data."); return; }

    setOpLoading(true);
    try {
      const result = await ironflow.configManager().set(configName.trim(), parsed);
      addLog("set", configName.trim(), true, `revision: ${result.revision}`);
      await loadConfigs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog("set", configName.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  const handleGet = async () => {
    setOpError(null);
    setGetResult(null);
    if (!configName.trim()) { setOpError("Config name is required."); return; }

    setOpLoading(true);
    try {
      const entry = await ironflow.configManager().get(configName.trim());
      setGetResult(entry);
      addLog("get", configName.trim(), true, `revision: ${entry.revision}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog("get", configName.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  const handlePatch = async () => {
    setOpError(null);
    if (!configName.trim()) { setOpError("Config name is required."); return; }
    let parsed: Record<string, unknown>;
    try {
      const result = JSON.parse(opValue);
      if (typeof result !== "object" || result === null || Array.isArray(result)) {
        setOpError("JSON data must be a valid object."); return;
      }
      parsed = result as Record<string, unknown>;
    } catch { setOpError("Invalid JSON data."); return; }

    setOpLoading(true);
    try {
      const result = await ironflow.configManager().patch(configName.trim(), parsed);
      addLog("patch", configName.trim(), true, `revision: ${result.revision}`);
      await loadConfigs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog("patch", configName.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  const handleDelete = async () => {
    setOpError(null);
    if (!configName.trim()) { setOpError("Config name is required."); return; }

    setOpLoading(true);
    try {
      await ironflow.configManager().delete(configName.trim());
      addLog("delete", configName.trim(), true, "Config deleted");
      setGetResult(null);
      await loadConfigs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog("delete", configName.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  // Auto-load configs on mount
  useEffect(() => {
    if (!configsLoaded && ironflow.isConfigured) {
      loadConfigs();
    }
  }, [configsLoaded, loadConfigs]);

  // Auto-load selected config from URL param (runs once on mount)
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current) return;
    if (!initialConfig || !ironflow.isConfigured) return;
    initialLoadDone.current = true;

    let active = true;
    setActiveTab("get");
    setConfigName(initialConfig);
    ironflow.configManager().get(initialConfig).then((entry) => {
      if (!active) return;
      setGetResult(entry);
      addLog("get", initialConfig, true, `revision: ${entry.revision}`);
    }).catch((err) => {
      if (!active) return;
      const msg = err instanceof Error ? err.message : "Failed";
      addLog("get", initialConfig, false, msg);
    });
    return () => { active = false; };
  }, [initialConfig, addLog]);

  const filteredConfigs = configs.filter((c) => c.name.includes(configFilter));

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Config Editor</h1>
        <p className="text-muted-foreground">
          Set, get, patch, and delete configuration data. Supports shallow merge
          with automatic CAS retry for concurrent updates.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Config Operations (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Config Operations</CardTitle>
              <CardDescription>
                Perform operations on named configurations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="set">Set</TabsTrigger>
                  <TabsTrigger value="get">Get</TabsTrigger>
                  <TabsTrigger value="patch">Patch</TabsTrigger>
                  <TabsTrigger value="delete">Delete</TabsTrigger>
                </TabsList>

                <div className="space-y-4 mb-4">
                  <div className="space-y-2">
                    <Label htmlFor="configName">Config Name</Label>
                    <Input
                      id="configName"
                      value={configName}
                      onChange={(e) => setConfigName(e.target.value)}
                      placeholder="e.g., app-settings or feature-flags"
                    />
                  </div>
                </div>

                <ErrorAlert message={opError} />

                <TabsContent value="set" className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Full replacement of the config data. The entire JSON document
                    will be stored, replacing any existing data.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="setValue">Data (JSON)</Label>
                    <Textarea
                      id="setValue"
                      value={opValue}
                      onChange={(e) => setOpValue(e.target.value)}
                      className="font-mono text-sm"
                      rows={4}
                    />
                  </div>
                  <Button onClick={handleSet} disabled={opLoading} className="w-full">
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                    Set Config
                  </Button>
                </TabsContent>

                <TabsContent value="get" className="space-y-4">
                  <Button onClick={handleGet} disabled={opLoading} className="w-full">
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Get Config
                  </Button>
                  {getResult && (
                    <div className="bg-muted rounded-md p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Name:</span>
                        <code className="font-mono">{getResult.name}</code>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Revision:</span>
                        <Badge variant="secondary">rev {getResult.revision}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Updated:</span>
                        <span>{new Date(getResult.updatedAt).toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Data:</span>
                        <pre className="mt-1 bg-background p-2 rounded text-xs overflow-x-auto">
                          {JSON.stringify(getResult.data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="patch" className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Shallow merge into the existing config. Only the keys you
                    provide will be updated; other keys are preserved. Uses
                    automatic CAS retry for safe concurrent updates.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="patchValue">Patch Data (JSON)</Label>
                    <Textarea
                      id="patchValue"
                      value={opValue}
                      onChange={(e) => setOpValue(e.target.value)}
                      className="font-mono text-sm"
                      rows={4}
                    />
                  </div>
                  <Button variant="secondary" onClick={handlePatch} disabled={opLoading} className="w-full">
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                    Patch Config
                  </Button>
                </TabsContent>

                <TabsContent value="delete" className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Permanently delete this configuration. This action cannot be
                    undone.
                  </p>
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={opLoading}
                    className="w-full"
                  >
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                    Delete Config
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Operation Log */}
          {opLog.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Operation Log</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setOpLog([])}>
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {opLog.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-2 text-sm border-b pb-2 last:border-0"
                    >
                      <Badge variant={entry.success ? "secondary" : "destructive"} className="text-xs">
                        {entry.operation}
                      </Badge>
                      <code className="font-mono text-xs">{entry.name}</code>
                      <span className="text-muted-foreground text-xs ml-auto">
                        {entry.detail}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {entry.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Browse Configs (1 col) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Browse Configs</CardTitle>
                <CardDescription>
                  {configsLoaded ? `${configs.length} config${configs.length !== 1 ? "s" : ""}` : "Load configs to browse"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={configFilter}
                onChange={(e) => setConfigFilter(e.target.value)}
                placeholder="Filter by name"
                className="text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={loadConfigs}
                disabled={configsLoading}
              >
                <RefreshCw className={`h-4 w-4 ${configsLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {filteredConfigs.length === 0 && configsLoaded ? (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No configs found.
                </p>
              ) : filteredConfigs.length === 0 && !configsLoaded ? (
                <p className="text-muted-foreground text-sm text-center py-4">
                  Configs will load automatically.
                </p>
              ) : (
                filteredConfigs.map((config) => (
                  <button
                    key={config.name}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm font-mono cursor-pointer transition-colors flex items-center justify-between"
                    onClick={() => { setConfigName(config.name); setActiveTab("get"); }}
                  >
                    <span>{config.name}</span>
                    <Badge variant="secondary" className="text-xs ml-2">
                      rev {config.revision}
                    </Badge>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense>
      <EditorPageContent />
    </Suspense>
  );
}
