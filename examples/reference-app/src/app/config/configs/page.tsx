"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ironflow } from "@ironflow/browser";
import type { ConfigEntry } from "@ironflow/browser";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ErrorAlert } from "@/components/error-alert";

export default function ConfigsPage() {
  // Create form state
  const [name, setName] = useState("");
  const [jsonData, setJsonData] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Config list state
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
      const result = await ironflow.configManager().list();
      setConfigs(result);
      setLoaded(true);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to list configs");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreate = async () => {
    setCreateError(null);
    if (!ironflow.isConfigured) {
      setCreateError("Client not configured. Please wait for connection.");
      return;
    }
    if (!name.trim()) {
      setCreateError("Config name is required.");
      return;
    }

    let parsed: Record<string, unknown> = {};
    if (jsonData.trim()) {
      try {
        const result = JSON.parse(jsonData.trim());
        if (typeof result !== "object" || result === null || Array.isArray(result)) {
          setCreateError("JSON data must be a valid object.");
          return;
        }
        parsed = result as Record<string, unknown>;
      } catch {
        setCreateError("Invalid JSON data.");
        return;
      }
    }

    setCreating(true);
    try {
      await ironflow.configManager().set(name.trim(), parsed);
      setName("");
      setJsonData("");
      await loadConfigs();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create config");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (configName: string) => {
    try {
      await ironflow.configManager().delete(configName);
      await loadConfigs();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete config");
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Configs</h1>
        <p className="text-muted-foreground">
          Create and manage configuration namespaces. Configs store JSON
          key-value data with revision tracking built on the KV store.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Create Config Form */}
        <Card>
          <CardHeader>
            <CardTitle>Create Config</CardTitle>
            <CardDescription>
              Create a new configuration namespace with JSON data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Config Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., app-settings"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jsonData">JSON Data</Label>
              <Textarea
                id="jsonData"
                value={jsonData}
                onChange={(e) => setJsonData(e.target.value)}
                placeholder='{"key": "value"}'
                rows={6}
                className="font-mono text-sm"
              />
            </div>

            <ErrorAlert message={createError} />

            <Button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="w-full"
            >
              {creating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Right: Config List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Existing Configs</CardTitle>
                <CardDescription>
                  {loaded ? `${configs.length} config${configs.length !== 1 ? "s" : ""}` : "Click refresh to load"}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadConfigs}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ErrorAlert message={listError} />

            {configs.length === 0 && loaded ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No configs found. Create one to get started.
              </p>
            ) : configs.length === 0 && !loaded ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                Click &quot;Refresh&quot; to load existing configs.
              </p>
            ) : (
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Revision</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {configs.map((config) => (
                      <TableRow key={config.name}>
                        <TableCell>
                          <button
                            className="font-medium text-primary hover:underline cursor-pointer"
                            onClick={() => router.push(`/config/editor?config=${encodeURIComponent(config.name)}`)}
                          >
                            {config.name}
                          </button>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">rev {config.revision}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(config.updatedAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete config &quot;{config.name}&quot;?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete the configuration. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(config.name)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
