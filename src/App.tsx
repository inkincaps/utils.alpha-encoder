import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Lottie from "lottie-react";
import { AlertTriangle, Check, FileDown, FolderOpen, RotateCcw } from "lucide-react";

import "./App.css";
import loading from "./assets/loading.json";
import PixelCard from "./components/PixelCard/PixelCard";
import SplashCursor from "./components/SplashCursor/SplashCursor";
import SuccessAnimation from "./components/success";
import { generalLoadingMessages } from "./utils/progress-copy";

/** Must match `Preset` in src-tauri/src/lib.rs. */
type Preset = "safari" | "chrome";
const PRESETS: Preset[] = ["safari", "chrome"];

type JobStatus = "queued" | "running" | "done" | "error";

interface Job {
  path: string;
  name: string;
  status: JobStatus;
  /** Preset currently encoding (while running). */
  preset?: Preset;
  /** 0–100 across both presets. */
  percent: number;
  outputs: string[];
  error?: string;
}

interface ProgressPayload {
  inputPath: string;
  preset: Preset;
  percent: number | null;
}

type Phase = "idle" | "processing" | "finished";

const baseName = (p: string) => p.split(/[/\\]/).pop() || p;
const randomCopy = () =>
  generalLoadingMessages[Math.floor(Math.random() * generalLoadingMessages.length)];

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hovering, setHovering] = useState(false);
  const [copy, setCopy] = useState(randomCopy);
  // The drop listener is registered once, so it reads the phase through a ref
  // rather than a stale closure.
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const update = (path: string, patch: Partial<Job>) =>
    setJobs((js) => js.map((j) => (j.path === path ? { ...j, ...patch } : j)));

  /** Encode every file with every preset, one FFmpeg process at a time. */
  const runQueue = async (paths: string[]) => {
    setPhase("processing");
    setJobs(paths.map((path) => ({ path, name: baseName(path), status: "queued", percent: 0, outputs: [] })));

    for (const path of paths) {
      const outputs: string[] = [];
      try {
        for (const preset of PRESETS) {
          update(path, { status: "running", preset });
          outputs.push(await invoke<string>("encode", { inputPath: path, preset }));
        }
        update(path, { status: "done", percent: 100, outputs, preset: undefined });
      } catch (e) {
        update(path, { status: "error", outputs, preset: undefined, error: String(e) });
      }
    }
    setPhase("finished");
  };

  // Native drag & drop (gives real file paths). Registered once, cleaned up on unmount.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") {
        setHovering(phaseRef.current !== "processing");
      } else if (p.type === "leave") {
        setHovering(false);
      } else if (p.type === "drop") {
        setHovering(false);
        // Ignore drops while busy; finished/idle screens accept a new batch.
        if (phaseRef.current !== "processing" && p.paths.length > 0) runQueue(p.paths);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-preset progress from Rust → overall percent for that file.
  useEffect(() => {
    const unlisten = listen<ProgressPayload>("encode-progress", ({ payload }) => {
      if (payload.percent == null) return;
      const offset = PRESETS.indexOf(payload.preset) * (100 / PRESETS.length);
      const overall = offset + payload.percent / PRESETS.length;
      update(payload.inputPath, { percent: Math.min(99, Math.round(overall)) });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Rotate the loading copy while busy.
  useEffect(() => {
    if (phase !== "processing") return;
    const id = setInterval(() => setCopy(randomCopy()), 5000);
    return () => clearInterval(id);
  }, [phase]);

  const failed = jobs.filter((j) => j.status === "error");
  const succeeded = jobs.filter((j) => j.status === "done");
  const allFailed = phase === "finished" && succeeded.length === 0;

  return (
    <main className="min-h-screen p-0 text-white">
      {phase === "idle" && <SplashCursor />}
      <PixelCard
        variant="pink"
        gap={70}
        className="h-screen w-screen rounded-none"
        active={phase === "processing" || hovering}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
          {/* Status icon */}
          {phase === "processing" && (
            <Lottie id="loading-anim" animationData={loading} style={{ width: 60, height: 60 }} />
          )}
          {phase === "finished" && !allFailed && <SuccessAnimation />}
          {phase === "finished" && allFailed && <AlertTriangle className="h-12 w-12 text-red-400" />}
          {phase === "idle" && <FileDown className={`h-12 w-12 transition-transform ${hovering ? "scale-125" : ""}`} />}

          {/* Headline */}
          <div className="text-center text-lg">
            {phase === "idle" && (hovering ? "Let go to encode" : "Drop your videos here")}
            {phase === "processing" && "Processing media"}
            {phase === "finished" &&
              (failed.length === 0
                ? `Done: ${succeeded.length} file${succeeded.length === 1 ? "" : "s"} encoded`
                : `${succeeded.length} done, ${failed.length} failed`)}
          </div>
          {phase === "idle" && (
            <p className="-mt-2 text-center text-xs opacity-60">
              ProRes 4444 or any alpha video → Safari .mp4 + Chrome .webm, saved next to the original
            </p>
          )}

          {/* Job list */}
          {jobs.length > 0 && (
            <ul className="mt-1 max-h-40 w-full max-w-sm space-y-1.5 overflow-auto text-sm">
              {jobs.map((j) => (
                <li key={j.path} className="rounded-md bg-black/40 px-3 py-1.5 backdrop-blur" title={j.error ?? j.path}>
                  <div className="flex items-center gap-2">
                    <StatusDot status={j.status} />
                    <span className="min-w-0 flex-1 truncate">{j.name}</span>
                    <span className="shrink-0 text-xs tabular-nums opacity-70">
                      {j.status === "running" && `${j.preset === "safari" ? "Safari" : "Chrome"} · ${j.percent}%`}
                      {j.status === "queued" && "Queued"}
                      {j.status === "done" && "2 files"}
                      {j.status === "error" && "Failed"}
                    </span>
                    {j.status === "done" && (
                      <button
                        className="shrink-0 opacity-70 hover:opacity-100"
                        title="Show in folder"
                        onClick={() => revealItemInDir(j.outputs[0])}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {j.status === "running" && (
                    <div className="mt-1 h-1 overflow-hidden rounded bg-white/15">
                      <div className="h-full bg-pink-400 transition-[width] duration-300" style={{ width: `${j.percent}%` }} />
                    </div>
                  )}
                  {j.status === "error" && (
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-all font-mono text-[10px] text-red-300">
                      {lastUsefulLine(j.error)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {phase === "processing" && <p className="text-center text-sm text-yellow-500 opacity-75">{copy}</p>}

          {phase === "finished" && (
            <button
              onClick={() => {
                setJobs([]);
                setPhase("idle");
              }}
              className="mt-1 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Encode more (or just drop files)
            </button>
          )}
        </div>
      </PixelCard>
    </main>
  );
}

function StatusDot({ status }: { status: JobStatus }) {
  if (status === "done") return <Check className="h-4 w-4 shrink-0 text-emerald-400" />;
  if (status === "error") return <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />;
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${status === "running" ? "animate-pulse bg-pink-400" : "bg-white/30"}`}
    />
  );
}

/** FFmpeg's real reason is usually the last non-summary line of the log. */
function lastUsefulLine(err?: string) {
  if (!err) return "";
  const lines = err.split("\n").map((l) => l.trim()).filter(Boolean);
  const meaningful = lines.filter((l) => !/^(Conversion failed|Exiting normally|FFmpeg exited)/.test(l));
  return meaningful[meaningful.length - 1] ?? lines[0];
}

export default App;
