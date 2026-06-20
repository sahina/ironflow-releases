"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ironflow } from "@ironflow/browser";
import type { KVBucketInfo, KVEntry } from "@ironflow/browser";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ErrorAlert } from "@/components/error-alert";

interface OpLogEntry {
  id: number;
  operation: string;
  key: string;
  success: boolean;
  detail: string;
  timestamp: Date;
}

function KeysPageContent() {
  const searchParams = useSearchParams();
  const initialBucket = searchParams.get("bucket") || "";

  // Bucket selection
  const [buckets, setBuckets] = useState<KVBucketInfo[]>([]);
  const [selectedBucket, setSelectedBucket] = useState(initialBucket);
  const [bucketsLoaded, setBucketsLoaded] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState("put");

  // Key operations
  const [opKey, setOpKey] = useState("");
  const [opValue, setOpValue] = useState('{\n  "example": true\n}');
  const [opRevision, setOpRevision] = useState("");
  const [opPurge, setOpPurge] = useState(false);
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [getResult, setGetResult] = useState<KVEntry | null>(null);

  // Browse keys
  const [keys, setKeys] = useState<string[]>([]);
  const [keyFilter, setKeyFilter] = useState("");
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysLoaded, setKeysLoaded] = useState(false);

  // Operation log
  const [opLog, setOpLog] = useState<OpLogEntry[]>([]);
  const nextIdRef = useRef(1);

  const addLog = useCallback((operation: string, key: string, success: boolean, detail: string) => {
    const id = nextIdRef.current++;
    setOpLog((log) => [{ id, operation, key, success, detail, timestamp: new Date() }, ...log].slice(0, 20));
  }, []);

  const loadBuckets = useCallback(async () => {
    if (!ironflow.isConfigured) return;
    try {
      const result = await ironflow.kv().listBuckets();
      setBuckets(result);
      setBucketsLoaded(true);
    } catch {
      // Silently fail -- bucket list is supplementary
    }
  }, []);

  const loadKeys = useCallback(async () => {
    if (!selectedBucket || !ironflow.isConfigured) return;
    setKeysLoading(true);
    try {
      const result = await ironflow.kv().bucket(selectedBucket).listKeys(keyFilter || undefined);
      setKeys(result);
      setKeysLoaded(true);
    } catch (err) {
      addLog("listKeys", keyFilter || "*", false, err instanceof Error ? err.message : "Failed");
    } finally {
      setKeysLoading(false);
    }
  }, [selectedBucket, keyFilter, addLog]);

  const handlePut = async () => {
    setOpError(null);
    if (!selectedBucket) { setOpError("Select a bucket first."); return; }
    if (!opKey.trim()) { setOpError("Key is required."); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(opValue); } catch { setOpError("Invalid JSON value."); return; }

    setOpLoading(true);
    try {
      const result = await ironflow.kv().bucket(selectedBucket).put(opKey.trim(), parsed);
      addLog("put", opKey.trim(), true, `revision: ${result.revision}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog("put", opKey.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  const handleGet = async () => {
    setOpError(null);
    setGetResult(null);
    if (!selectedBucket) { setOpError("Select a bucket first."); return; }
    if (!opKey.trim()) { setOpError("Key is required."); return; }

    setOpLoading(true);
    try {
      const entry = await ironflow.kv().bucket(selectedBucket).get(opKey.trim());
      setGetResult(entry);
      addLog("get", opKey.trim(), true, `revision: ${entry.revision}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog("get", opKey.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  const handleDelete = async () => {
    setOpError(null);
    if (!selectedBucket) { setOpError("Select a bucket first."); return; }
    if (!opKey.trim()) { setOpError("Key is required."); return; }

    setOpLoading(true);
    try {
      const bucket = ironflow.kv().bucket(selectedBucket);
      if (opPurge) {
        await bucket.purge(opKey.trim());
        addLog("purge", opKey.trim(), true, "Key and history removed");
      } else {
        await bucket.delete(opKey.trim());
        addLog("delete", opKey.trim(), true, "Tombstone placed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog(opPurge ? "purge" : "delete", opKey.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  const handleCreate = async () => {
    setOpError(null);
    if (!selectedBucket) { setOpError("Select a bucket first."); return; }
    if (!opKey.trim()) { setOpError("Key is required."); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(opValue); } catch { setOpError("Invalid JSON value."); return; }

    setOpLoading(true);
    try {
      const result = await ironflow.kv().bucket(selectedBucket).create(opKey.trim(), parsed);
      addLog("create", opKey.trim(), true, `revision: ${result.revision}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog("create", opKey.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  const handleUpdate = async () => {
    setOpError(null);
    if (!selectedBucket) { setOpError("Select a bucket first."); return; }
    if (!opKey.trim()) { setOpError("Key is required."); return; }
    if (!opRevision) { setOpError("Revision is required for CAS update."); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(opValue); } catch { setOpError("Invalid JSON value."); return; }

    setOpLoading(true);
    try {
      const result = await ironflow.kv().bucket(selectedBucket).update(
        opKey.trim(), parsed, parseInt(opRevision, 10)
      );
      addLog("update", opKey.trim(), true, `revision: ${result.revision}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setOpError(msg);
      addLog("update", opKey.trim(), false, msg);
    } finally {
      setOpLoading(false);
    }
  };

  // Auto-load buckets on mount
  useEffect(() => {
    if (!bucketsLoaded && ironflow.isConfigured) {
      loadBuckets();
    }
  }, [bucketsLoaded, loadBuckets]);

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">KV Keys</h1>
        <p className="text-muted-foreground">
          Read, write, and delete key-value pairs. Supports atomic
          create-if-not-exists and compare-and-swap updates.
        </p>
      </section>

      {/* Bucket Selector */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <Label htmlFor="bucket-select" className="whitespace-nowrap">Bucket:</Label>
          {buckets.length > 0 ? (
            <Select value={selectedBucket} onValueChange={setSelectedBucket}>
              <SelectTrigger id="bucket-select">
                <SelectValue placeholder="Select a bucket" />
              </SelectTrigger>
              <SelectContent>
                {buckets.map((b) => (
                  <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="bucket-select"
              value={selectedBucket}
              onChange={(e) => setSelectedBucket(e.target.value)}
              placeholder="Enter bucket name"
            />
          )}
        </div>
        <Button variant="outline" size="sm" onClick={loadBuckets}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Key Operations (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Key Operations</CardTitle>
              <CardDescription>
                Perform CRUD and atomic operations on keys
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="put">Put</TabsTrigger>
                  <TabsTrigger value="get">Get</TabsTrigger>
                  <TabsTrigger value="delete">Delete</TabsTrigger>
                  <TabsTrigger value="create">Create</TabsTrigger>
                  <TabsTrigger value="update">Update (CAS)</TabsTrigger>
                </TabsList>

                <div className="space-y-4 mb-4">
                  <div className="space-y-2">
                    <Label htmlFor="opKey">Key</Label>
                    <Input
                      id="opKey"
                      value={opKey}
                      onChange={(e) => setOpKey(e.target.value)}
                      placeholder="e.g., user.123 or settings.theme"
                    />
                  </div>
                </div>

                <ErrorAlert message={opError} />

                <TabsContent value="put" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="putValue">Value (JSON)</Label>
                    <Textarea
                      id="putValue"
                      value={opValue}
                      onChange={(e) => setOpValue(e.target.value)}
                      className="font-mono text-sm"
                      rows={4}
                    />
                  </div>
                  <Button onClick={handlePut} disabled={opLoading || !selectedBucket} className="w-full">
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                    Put Value
                  </Button>
                </TabsContent>

                <TabsContent value="get" className="space-y-4">
                  <Button onClick={handleGet} disabled={opLoading || !selectedBucket} className="w-full">
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Get Value
                  </Button>
                  {getResult && (
                    <div className="bg-muted rounded-md p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Key:</span>
                        <code className="font-mono">{getResult.key}</code>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Revision:</span>
                        <span>{getResult.revision}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Write:</span>
                        <Badge variant={getResult.operation === "put" ? "default" : "destructive"}>
                          {getResult.operation}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Updated:</span>
                        <span>{new Date(getResult.created_at).toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Value:</span>
                        <pre className="mt-1 bg-background p-2 rounded text-xs overflow-x-auto">
                          {(() => {
                            const v = getResult.value;
                            if (typeof v === "string") {
                              // Try base64 decode, then pretty-print if JSON
                              try {
                                const decoded = atob(v);
                                const parsed = JSON.parse(decoded);
                                return JSON.stringify(parsed, null, 2);
                              } catch {
                                // Try direct JSON parse
                                try {
                                  return JSON.stringify(JSON.parse(v), null, 2);
                                } catch {
                                  return v;
                                }
                              }
                            }
                            return JSON.stringify(v, null, 2);
                          })()}
                        </pre>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="delete" className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="purge"
                      checked={opPurge}
                      onCheckedChange={setOpPurge}
                    />
                    <Label htmlFor="purge">
                      Purge (permanently remove key and all history)
                    </Label>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={opLoading || !selectedBucket}
                    className="w-full"
                  >
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                    {opPurge ? "Purge Key" : "Delete Key"}
                  </Button>
                </TabsContent>

                <TabsContent value="create" className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Creates the key only if it doesn&apos;t already exist. Returns a 412 conflict error if the key is already present.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="createValue">Value (JSON)</Label>
                    <Textarea
                      id="createValue"
                      value={opValue}
                      onChange={(e) => setOpValue(e.target.value)}
                      className="font-mono text-sm"
                      rows={4}
                    />
                  </div>
                  <Button onClick={handleCreate} disabled={opLoading || !selectedBucket} className="w-full">
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                    Create (If Not Exists)
                  </Button>
                </TabsContent>

                <TabsContent value="update" className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Compare-And-Swap: updates only if the key&apos;s current
                    revision matches. Get a key first to see its revision, then
                    use that revision here. If another client changed the key
                    in between, the revision won&apos;t match and you&apos;ll
                    get a 412 conflict error — preventing lost updates.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="updateValue">Value (JSON)</Label>
                    <Textarea
                      id="updateValue"
                      value={opValue}
                      onChange={(e) => setOpValue(e.target.value)}
                      className="font-mono text-sm"
                      rows={4}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="revision">Expected Revision</Label>
                    <Input
                      id="revision"
                      type="number"
                      value={opRevision}
                      onChange={(e) => setOpRevision(e.target.value)}
                      placeholder="Revision from last get"
                    />
                  </div>
                  <Button onClick={handleUpdate} disabled={opLoading || !selectedBucket} className="w-full">
                    {opLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                    Update (CAS)
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
                      <code className="font-mono text-xs">{entry.key}</code>
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

        {/* Right: Browse Keys (1 col) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Browse Keys</CardTitle>
                <CardDescription>
                  {keysLoaded ? `${keys.length} key${keys.length !== 1 ? "s" : ""}` : "Load keys to browse"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={keyFilter}
                onChange={(e) => setKeyFilter(e.target.value)}
                placeholder="Filter: user.* or >"
                className="text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={loadKeys}
                disabled={keysLoading || !selectedBucket}
              >
                <RefreshCw className={`h-4 w-4 ${keysLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {keys.length === 0 && keysLoaded ? (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No keys found.
                </p>
              ) : keys.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">
                  Select a bucket and click refresh.
                </p>
              ) : (
                keys.map((key) => (
                  <button
                    key={key}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-sm font-mono cursor-pointer transition-colors"
                    onClick={() => { setOpKey(key); setActiveTab("get"); }}
                  >
                    {key}
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

export default function KeysPage() {
  return (
    <Suspense>
      <KeysPageContent />
    </Suspense>
  );
}
