import { Button } from "@avoid.quest/ui/components/button";
import { Input } from "@avoid.quest/ui/components/input";
import { Progress } from "@avoid.quest/ui/components/progress";
import { cn } from "@avoid.quest/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  CloudUpload,
  Loader2,
  Music,
  Pause,
  Play,
  Trash2,
  Volume2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "ogg"]);

type FileEntry = {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
};

type Sample = {
  key: string;
  size: number;
};

function formatSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function getRowClasses(status: FileEntry["status"]) {
  if (status === "done") {
    return "border-emerald-500/15 bg-emerald-500/[0.04]";
  }
  if (status === "error") {
    return "border-red-400/15 bg-red-400/[0.04]";
  }
  return "border-white/[0.06] bg-white/[0.02]";
}

function getUploadLabel(uploading: boolean, pendingCount: number) {
  if (uploading) {
    return "Uploading...";
  }
  if (pendingCount > 0) {
    return `Upload ${pendingCount} file${pendingCount !== 1 ? "s" : ""}`;
  }
  return "All uploaded";
}

function StatusIcon({ status }: { status: FileEntry["status"] }) {
  if (status === "done") {
    return <CheckCircle2 className="size-4 text-emerald-400/70" />;
  }
  if (status === "error") {
    return <XCircle className="size-4 text-red-400/70" />;
  }
  return <Music className="size-4 text-white/25" />;
}

function FileRow({
  entry,
  uploading,
  onRemove,
}: {
  entry: FileEntry;
  uploading: boolean;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5 transition-colors",
        getRowClasses(entry.status)
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center">
          <StatusIcon status={entry.status} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white/70">{entry.file.name}</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-white/25">
              {formatSize(entry.file.size)}
            </span>
            {entry.status === "uploading" && (
              <span className="font-mono text-[11px] text-white/40">
                {entry.progress}%
              </span>
            )}
            {entry.error && (
              <span className="truncate font-mono text-[11px] text-red-400/60">
                {entry.error}
              </span>
            )}
          </div>
        </div>

        {entry.status === "pending" && !uploading && (
          <button
            className="shrink-0 rounded p-1 text-white/15 transition-colors hover:bg-white/5 hover:text-white/40"
            onClick={onRemove}
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {(entry.status === "uploading" || entry.status === "done") && (
        <div className="mt-2">
          <Progress
            className={cn(
              "h-1",
              entry.status === "done"
                ? "[&>[data-slot=progress-indicator]]:bg-emerald-400/50"
                : "[&>[data-slot=progress-indicator]]:bg-white/40"
            )}
            value={entry.progress}
          />
        </div>
      )}
    </div>
  );
}

function SampleRow({
  sample,
  isPlaying,
  onToggle,
}: {
  sample: Sample;
  isPlaying: boolean;
  onToggle: () => void;
}) {
  const ext = getExtension(sample.key);

  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
        isPlaying
          ? "border-white/15 bg-white/[0.06]"
          : "border-transparent bg-transparent hover:bg-white/[0.03]"
      )}
      onClick={onToggle}
      type="button"
    >
      <div className="flex shrink-0 items-center">
        {isPlaying ? (
          <Pause className="size-3.5 text-white/60" />
        ) : (
          <Play className="size-3.5 text-white/25" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white/70">{sample.key}</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-white/25">
            {formatSize(sample.size)}
          </span>
          <span className="font-mono text-[11px] text-white/15 uppercase">
            {ext}
          </span>
        </div>
      </div>
      {isPlaying && <Volume2 className="size-3.5 shrink-0 text-white/30" />}
    </button>
  );
}

function SampleLibrary() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSamples() {
      try {
        const res = await fetch("/api/audio-samples");
        if (res.ok && !cancelled) {
          const data: { samples?: Sample[] } = await res.json();
          setSamples(data.samples ?? []);
        }
      } catch {
        // Silently fail — library is secondary to upload
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSamples();
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePlay = useCallback(
    (key: string) => {
      if (playingKey === key) {
        audioRef.current?.pause();
        setPlayingKey(null);
        return;
      }

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(
        `/api/audio-sample?key=${encodeURIComponent(key)}`
      );
      audio.onended = () => setPlayingKey(null);
      audio.onerror = () => {
        setPlayingKey(null);
        toast.error(`Failed to play ${key}`);
      };
      audio.play();
      audioRef.current = audio;
      setPlayingKey(key);
    },
    [playingKey]
  );

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-white/20" />
      </div>
    );
  }

  if (samples.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="font-mono text-white/20 text-xs">No samples yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {samples.map((sample) => (
        <SampleRow
          isPlaying={playingKey === sample.key}
          key={sample.key}
          onToggle={() => togglePlay(sample.key)}
          sample={sample}
        />
      ))}
    </div>
  );
}

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

function UploadPage() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadGeneration, setUploadGeneration] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<XMLHttpRequest | null>(null);

  const handleAuth = useCallback(async () => {
    if (!password.trim()) {
      return;
    }
    setAuthLoading(true);
    setAuthError("");

    try {
      const res = await fetch("/api/audio-upload-auth", {
        method: "POST",
        headers: { Authorization: `Bearer ${password}` },
      });

      if (res.ok) {
        setAuthenticated(true);
      } else {
        setAuthError("Wrong password");
      }
    } catch {
      setAuthError("Connection error");
    } finally {
      setAuthLoading(false);
    }
  }, [password]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const entries: FileEntry[] = [];
    const rejected: string[] = [];

    for (const file of incoming) {
      const ext = getExtension(file.name);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        rejected.push(`${file.name} (invalid type)`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name} (too large)`);
        continue;
      }
      entries.push({ file, status: "pending", progress: 0 });
    }

    if (rejected.length > 0) {
      toast.error(`Rejected: ${rejected.join(", ")}`);
    }

    if (entries.length > 0) {
      setFiles((prev) => [...prev, ...entries]);
    }
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        addFiles(e.target.files);
      }
      e.target.value = "";
    },
    [addFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const uploadFile = useCallback(
    (entry: FileEntry, index: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        abortRef.current = xhr;

        const formData = new FormData();
        formData.append("file", entry.file);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            setFiles((prev) =>
              prev.map((f, i) =>
                i === index ? { ...f, progress, status: "uploading" } : f
              )
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setFiles((prev) =>
              prev.map((f, i) =>
                i === index ? { ...f, status: "done", progress: 100 } : f
              )
            );
            toast.success(`Uploaded ${entry.file.name}`);
            resolve(true);
          } else {
            let errorMsg = "Upload failed";
            try {
              const body = JSON.parse(xhr.responseText);
              if (body.error) {
                errorMsg = body.error;
              }
            } catch {
              // Use default error message
            }
            setFiles((prev) =>
              prev.map((f, i) =>
                i === index ? { ...f, status: "error", error: errorMsg } : f
              )
            );
            toast.error(`${entry.file.name}: ${errorMsg}`);
            resolve(false);
          }
        };

        xhr.onerror = () => {
          setFiles((prev) =>
            prev.map((f, i) =>
              i === index
                ? { ...f, status: "error", error: "Network error" }
                : f
            )
          );
          toast.error(`${entry.file.name}: Network error`);
          resolve(false);
        };

        xhr.open("POST", "/api/audio-upload");
        xhr.setRequestHeader("Authorization", `Bearer ${password}`);
        xhr.send(formData);
      });
    },
    [password]
  );

  const handleUpload = useCallback(async () => {
    setUploading(true);
    let anySucceeded = false;

    for (let i = 0; i < files.length; i++) {
      const entry = files[i];
      if (entry.status !== "pending") {
        continue;
      }

      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: "uploading", progress: 0 } : f
        )
      );

      const ok = await uploadFile(entry, i);
      if (ok) {
        anySucceeded = true;
      }
    }

    if (anySucceeded) {
      setUploadGeneration((g) => g + 1);
    }

    setUploading(false);
  }, [files, uploadFile]);

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;

  if (!authenticated) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-xs space-y-8">
          <div className="space-y-2 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <Music className="size-5 text-white/50" />
            </div>
            <h1 className="font-mono text-sm text-white/40 uppercase tracking-widest">
              Audio Upload
            </h1>
          </div>

          <div className="space-y-3">
            <Input
              autoFocus
              className="h-11 border-white/10 bg-white/5 text-center font-mono text-sm tracking-wider placeholder:text-white/20 focus-visible:border-white/25 focus-visible:ring-white/10"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAuth();
                }
              }}
              placeholder="password"
              type="password"
              value={password}
            />

            {authError && (
              <p className="text-center font-mono text-red-400/80 text-xs">
                {authError}
              </p>
            )}

            <Button
              className="h-11 w-full gap-2 border border-white/10 bg-white/5 font-mono text-white/70 text-xs uppercase tracking-widest hover:border-white/20 hover:bg-white/10 hover:text-white"
              disabled={authLoading || !password.trim()}
              onClick={handleAuth}
              variant="ghost"
            >
              {authLoading ? (
                "Verifying..."
              ) : (
                <>
                  Enter
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full overflow-hidden">
      {/* Upload panel */}
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-6">
        <div className="w-full max-w-md space-y-5">
          <div className="space-y-1">
            <h1 className="font-mono text-sm text-white/40 uppercase tracking-widest">
              Upload Samples
            </h1>
            {files.length > 0 && (
              <p className="font-mono text-white/20 text-xs">
                {files.length} file{files.length !== 1 ? "s" : ""}
                {doneCount > 0 ? ` \u00b7 ${doneCount} uploaded` : ""}
              </p>
            )}
          </div>

          {/* Drop zone */}
          <button
            className={cn(
              "group relative w-full cursor-pointer rounded-lg border border-dashed p-8 text-center transition-all duration-200",
              isDragOver
                ? "border-white/40 bg-white/[0.06]"
                : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]",
              uploading && "pointer-events-none opacity-50"
            )}
            onClick={() => fileInputRef.current?.click()}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            type="button"
          >
            <input
              accept=".mp3,.wav,.ogg"
              className="hidden"
              multiple
              onChange={handleFileSelect}
              ref={fileInputRef}
              type="file"
            />
            <div className="space-y-3">
              <CloudUpload
                className={cn(
                  "mx-auto size-8 transition-all duration-200",
                  isDragOver
                    ? "text-white/50"
                    : "text-white/20 group-hover:text-white/30"
                )}
                strokeWidth={1.5}
              />
              <div className="space-y-1">
                <p className="text-sm text-white/50">
                  {isDragOver ? "Drop files here" : "Drop audio files or click"}
                </p>
                <p className="font-mono text-white/20 text-xs">
                  .mp3 .wav .ogg &middot; 50 MB max
                </p>
              </div>
            </div>
          </button>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((entry, i) => (
                <FileRow
                  entry={entry}
                  key={`${entry.file.name}-${i}`}
                  onRemove={() => removeFile(i)}
                  uploading={uploading}
                />
              ))}
            </div>
          )}

          {/* Upload button */}
          {files.length > 0 && (
            <Button
              className={cn(
                "h-11 w-full font-mono text-xs uppercase tracking-widest transition-all",
                pendingCount > 0
                  ? "border border-white/15 bg-white/10 text-white hover:bg-white/15"
                  : "border border-white/5 bg-white/5 text-white/30"
              )}
              disabled={uploading || pendingCount === 0}
              onClick={handleUpload}
              variant="ghost"
            >
              {getUploadLabel(uploading, pendingCount)}
            </Button>
          )}
        </div>
      </div>

      {/* Sample library sidebar */}
      <div className="flex w-80 shrink-0 flex-col border-white/[0.06] border-l max-md:hidden">
        <div className="border-white/[0.06] border-b px-4 py-4">
          <h2 className="font-mono text-white/40 text-xs uppercase tracking-widest">
            Sample Library
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <SampleLibrary key={uploadGeneration} />
        </div>
      </div>
    </div>
  );
}
