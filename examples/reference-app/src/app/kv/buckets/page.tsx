"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ironflow } from "@ironflow/browser";
import type { KVBucketConfig, KVBucketInfo } from "@ironflow/browser";
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

export default function BucketsPage() {
  // Create form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ttl, setTtl] = useState("");
  const [maxValueSize, setMaxValueSize] = useState("");
  const [maxBytes, setMaxBytes] = useState("");
  const [history, setHistory] = useState("1");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Bucket list state
  const [buckets, setBuckets] = useState<KVBucketInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const router = useRouter();

  const loadBuckets = useCallback(async () => {
    setListError(null);
    if (!ironflow.isConfigured) {
      setListError("Client not configured. Please wait for connection.");
      return;
    }
    setLoading(true);
    try {
      const result = await ironflow.kv().listBuckets();
      setBuckets(result);
      setLoaded(true);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to list buckets");
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
      setCreateError("Bucket name is required.");
      return;
    }
    setCreating(true);
    try {
      const config: KVBucketConfig = { name: name.trim() };
      if (description.trim()) config.description = description.trim();
      if (ttl && parseInt(ttl, 10) > 0) config.ttlSeconds = parseInt(ttl, 10);
      if (maxValueSize && parseInt(maxValueSize, 10) > 0) config.maxValueSize = parseInt(maxValueSize, 10);
      if (maxBytes && parseInt(maxBytes, 10) > 0) config.maxBytes = parseInt(maxBytes, 10);
      if (history && parseInt(history, 10) > 0) config.history = parseInt(history, 10);

      await ironflow.kv().createBucket(config);
      setName("");
      setDescription("");
      setTtl("");
      setMaxValueSize("");
      setMaxBytes("");
      setHistory("1");
      await loadBuckets();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create bucket");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (bucketName: string) => {
    try {
      await ironflow.kv().deleteBucket(bucketName);
      await loadBuckets();
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete bucket");
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <section className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">KV Buckets</h1>
        <p className="text-muted-foreground">
          Create and manage KV Store buckets. Buckets are containers for
          key-value pairs with configurable TTL, size limits, and history depth.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Create Bucket Form */}
        <Card>
          <CardHeader>
            <CardTitle>Create Bucket</CardTitle>
            <CardDescription>
              Configure and create a new KV bucket
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., my-cache"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ttl">TTL (seconds)</Label>
                <Input
                  id="ttl"
                  type="number"
                  value={ttl}
                  onChange={(e) => setTtl(e.target.value)}
                  placeholder="0 = no expiry"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="history">History</Label>
                <Input
                  id="history"
                  type="number"
                  value={history}
                  onChange={(e) => setHistory(e.target.value)}
                  placeholder="1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="maxValueSize">Max Value Size (bytes)</Label>
                <Input
                  id="maxValueSize"
                  type="number"
                  value={maxValueSize}
                  onChange={(e) => setMaxValueSize(e.target.value)}
                  placeholder="No limit"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxBytes">Max Bucket Size (bytes)</Label>
                <Input
                  id="maxBytes"
                  type="number"
                  value={maxBytes}
                  onChange={(e) => setMaxBytes(e.target.value)}
                  placeholder="No limit"
                />
              </div>
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
                  Create Bucket
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Right: Bucket List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Existing Buckets</CardTitle>
                <CardDescription>
                  {loaded ? `${buckets.length} bucket${buckets.length !== 1 ? "s" : ""}` : "Click refresh to load"}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadBuckets}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ErrorAlert message={listError} />

            {buckets.length === 0 && loaded ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No buckets found. Create one to get started.
              </p>
            ) : buckets.length === 0 && !loaded ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                Click &quot;Refresh&quot; to load existing buckets.
              </p>
            ) : (
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Keys</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>TTL</TableHead>
                      <TableHead>History</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buckets.map((bucket) => (
                      <TableRow key={bucket.name}>
                        <TableCell>
                          <button
                            className="font-medium text-primary hover:underline cursor-pointer"
                            onClick={() => router.push(`/kv/keys?bucket=${encodeURIComponent(bucket.name)}`)}
                          >
                            {bucket.name}
                          </button>
                          {bucket.description && (
                            <p className="text-xs text-muted-foreground">{bucket.description}</p>
                          )}
                        </TableCell>
                        <TableCell>{bucket.values}</TableCell>
                        <TableCell>{formatBytes(bucket.bytes)}</TableCell>
                        <TableCell>{bucket.ttl_seconds ? `${bucket.ttl_seconds}s` : "None"}</TableCell>
                        <TableCell>{bucket.history}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(bucket.created_at).toLocaleDateString()}
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
                                <AlertDialogTitle>Delete bucket &quot;{bucket.name}&quot;?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete the bucket and all its keys. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(bucket.name)}>
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
