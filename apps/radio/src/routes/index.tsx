import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Radios } from "@/components/radio";

const STREAM_CANDIDATES = [
  ["s.ogg", "https://s.streampunk.cc/blackout.ogg"],
  ["blimp.ogg", "https://blimp.streampunk.cc/_stream/blackout.ogg"],
  ["zeppelin.ogg", "https://zeppelin.streampunk.cc/_stream/blackout.ogg"],
  ["official.ogg", "https://stream.radioblackout.org/blackout.ogg"],
  ["blimp.mp3", "https://blimp.streampunk.cc/_stream/blackout.mp3"],
] as const;

type DiagnosticResult = {
  elapsedMs: number;
  message: string;
  peak: number;
  status: "fail" | "pass" | "running";
};

async function testAudioGraph(url: string): Promise<Omit<DiagnosticResult, "status"> & { status: "fail" | "pass" }> {
  const context = new AudioContext();
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.src = url;
  const source = context.createMediaElementSource(audio);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  analyser.connect(context.destination);
  const samples = new Uint8Array(analyser.fftSize);
  const startedAt = performance.now();

  try {
    await context.resume();
    await audio.play();

    while (performance.now() - startedAt < 10_000) {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample - 128));
      }
      if (peak > 1) {
        return {
          elapsedMs: Math.round(performance.now() - startedAt),
          message: "non-zero Web Audio samples",
          peak,
          status: "pass",
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      elapsedMs: Math.round(performance.now() - startedAt),
      message: "loaded but produced no Web Audio samples",
      peak: 0,
      status: "fail",
    };
  } catch (error) {
    return {
      elapsedMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
      peak: 0,
      status: "fail",
    };
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    source.disconnect();
    analyser.disconnect();
    await context.close();
  }
}

function StreamDiagnostics() {
  const [results, setResults] = useState<Record<string, DiagnosticResult>>({});

  const run = async (name: string, url: string) => {
    setResults((current) => ({
      ...current,
      [name]: { elapsedMs: 0, message: "testing", peak: 0, status: "running" },
    }));
    const result = await testAudioGraph(url);
    setResults((current) => ({ ...current, [name]: result }));
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <h1 className="font-bold text-2xl">Radio BlackOut stream diagnostics</h1>
      {STREAM_CANDIDATES.map(([name, url]) => {
        const result = results[name];
        return (
          <section className="rounded border p-3" key={name}>
            <div className="flex items-center gap-3">
              <button
                className="rounded bg-primary px-3 py-2 text-primary-foreground"
                onClick={() => run(name, url)}
                type="button"
              >
                Test {name}
              </button>
              <strong>{result?.status ?? "idle"}</strong>
              {result && <span>{result.elapsedMs} ms · peak {result.peak}</span>}
            </div>
            <p>{url}</p>
            {result && <p>{result.message}</p>}
          </section>
        );
      })}
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
  ssr: false,
});

function Home() {
  if (window.location.search.includes("stream-diagnostics=1")) {
    return <StreamDiagnostics />;
  }
  return (
    <div className="flex h-full w-full flex-col">
      <Radios />
    </div>
  );
}
