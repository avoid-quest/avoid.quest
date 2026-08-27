// A deterministic scheduling model, not a phone reproduction. It runs the
// installed openDAW Autotune WASM side-module with its production 128-frame
// descriptor. The default stress factor calibrates p95 just beyond the crackle
// edge. Pass an explicit slowdown measured for the target phone when comparing
// devices. Larger buffer windows group adjacent render quanta.
const SAMPLE_RATE = 48_000;
const QUANTUM_FRAMES = 128;
const QUANTUM_BUDGET_US = (QUANTUM_FRAMES / SAMPLE_RATE) * 1_000_000;
const AUTOTUNE_ALGORITHMIC_LATENCY_FRAMES = 1280;
const WARMUP_QUANTA = 2000;
const MEASURED_QUANTA = 12_000;
const TARGET_MOBILE_P95_LOAD = 1.04;

const MEMORY_BASE = 1_048_576;
const STACK_TOP = 2_097_152;
const STATE_PTR = 3_145_728;
const INPUT_LEFT_PTR = 4_194_304;
const INPUT_RIGHT_PTR = 4_198_400;
const OUTPUT_LEFT_PTR = 4_202_496;
const OUTPUT_RIGHT_PTR = 4_206_592;
const OUTPUT_OFFSETS_PTR = 4_210_688;
const BLOCK_PTR = 4_214_784;
const DESCRIPTOR_PTR = 4_218_880;

type AutotuneExports = {
  init: (statePtr: number, sampleRate: number) => void;
  parameter_changed: (
    statePtr: number,
    id: number,
    kind: number,
    value: number,
    modulation: number
  ) => void;
  process: (descriptorPtr: number) => void;
  state_size: (sampleRate: number) => number;
};

type OfficialAutotuneFixture = {
  prepareInput: () => void;
  process: () => void;
};

type Scenario = {
  modeledBufferFramesPerDirection: number;
  modeledAutotuneMonitoringMs: number;
  modeledBypassMonitoringMs: number;
  modeledMissedBufferWindows: number;
  modeledMissedQuanta: number;
  windowCount: number;
};

function percentile(sampleTimes: readonly number[], fraction: number): number {
  return (
    sampleTimes[
      Math.min(
        sampleTimes.length - 1,
        Math.floor(sampleTimes.length * fraction)
      )
    ] ?? 0
  );
}

async function createOfficialAutotune(): Promise<OfficialAutotuneFixture> {
  const url = import.meta.resolve(
    "@opendaw/studio-core-wasm/wasm/plugins/device_autotune.wasm"
  );
  const module = await WebAssembly.compile(
    await Bun.file(new URL(url)).bytes()
  );
  const memory = new WebAssembly.Memory({ initial: 256 });
  const view = new DataView(memory.buffer);
  let nextParameterId = 1;
  const instance = new WebAssembly.Instance(module, {
    env: {
      __memory_base: new WebAssembly.Global(
        { mutable: false, value: "i32" },
        MEMORY_BASE
      ),
      __stack_pointer: new WebAssembly.Global(
        { mutable: true, value: "i32" },
        STACK_TOP
      ),
      host_bind_broadcast: () => 1,
      host_bind_parameter: () => {
        const id = nextParameterId;
        nextParameterId += 1;
        return id;
      },
      host_broadcast_ptr: () => 0,
      host_first_update_position: () => Number.POSITIVE_INFINITY,
      host_next_update_position: () => Number.POSITIVE_INFINITY,
      host_pulse_to_offset: () => 0,
      host_resolve_input: (_id: number, outPtr: number) => {
        view.setUint32(outPtr, INPUT_LEFT_PTR, true);
        view.setUint32(outPtr + 4, INPUT_RIGHT_PTR, true);
        view.setUint32(outPtr + 8, QUANTUM_FRAMES, true);
        return 1;
      },
      host_update_parameters: () => 0,
      memory,
    },
  });
  const exports = instance.exports as unknown as AutotuneExports;
  if (exports.state_size(SAMPLE_RATE) > INPUT_LEFT_PTR - STATE_PTR) {
    throw new Error("openDAW Autotune state exceeds the benchmark allocation");
  }

  const inputLeft = new Float32Array(
    memory.buffer,
    INPUT_LEFT_PTR,
    QUANTUM_FRAMES
  );
  const inputRight = new Float32Array(
    memory.buffer,
    INPUT_RIGHT_PTR,
    QUANTUM_FRAMES
  );
  let phase = 0;
  const phaseStep = (2 * Math.PI * 220) / SAMPLE_RATE;
  const prepareInput = () => {
    for (let index = 0; index < QUANTUM_FRAMES; index += 1) {
      const sample = Math.sin(phase) * 0.7;
      inputLeft[index] = sample;
      inputRight[index] = sample;
      phase += phaseStep;
      if (phase >= 2 * Math.PI) {
        phase -= 2 * Math.PI;
      }
    }
  };

  view.setUint32(OUTPUT_OFFSETS_PTR, OUTPUT_LEFT_PTR, true);
  view.setUint32(OUTPUT_OFFSETS_PTR + 4, OUTPUT_RIGHT_PTR, true);
  view.setUint32(BLOCK_PTR, 0, true);
  view.setUint32(BLOCK_PTR + 4, 0, true);
  view.setFloat64(BLOCK_PTR + 8, 0, true);
  view.setFloat64(BLOCK_PTR + 16, 1, true);
  view.setUint32(BLOCK_PTR + 24, 0, true);
  view.setUint32(BLOCK_PTR + 28, QUANTUM_FRAMES, true);
  view.setFloat32(BLOCK_PTR + 32, 120, true);

  const descriptor = new Uint32Array(memory.buffer, DESCRIPTOR_PTR, 15);
  descriptor.set([
    QUANTUM_FRAMES,
    0,
    0,
    2,
    OUTPUT_OFFSETS_PTR,
    0,
    0,
    STATE_PTR,
    0,
    0,
    0,
    0,
    1,
    BLOCK_PTR,
    new Uint32Array(new Float32Array([SAMPLE_RATE]).buffer)[0] ?? 0,
  ]);

  exports.init(STATE_PTR, SAMPLE_RATE);
  const floatKind = 2;
  const intKind = 1;
  const noModulation = Number.NaN;
  exports.parameter_changed(STATE_PTR, 1, intKind, 0, noModulation);
  exports.parameter_changed(STATE_PTR, 2, intKind, 0, noModulation);
  exports.parameter_changed(STATE_PTR, 3, floatKind, 1, noModulation);
  exports.parameter_changed(STATE_PTR, 4, floatKind, 0.5, noModulation);
  exports.parameter_changed(STATE_PTR, 5, floatKind, 0, noModulation);
  exports.parameter_changed(STATE_PTR, 6, floatKind, 0.6, noModulation);
  return { prepareInput, process: () => exports.process(DESCRIPTOR_PTR) };
}

function simulateBuffer(
  renderTimesUs: readonly number[],
  modeledBufferFrames: number,
  slowdown: number
): Scenario {
  const quantaPerBuffer = modeledBufferFrames / QUANTUM_FRAMES;
  const bufferBudgetUs = quantaPerBuffer * QUANTUM_BUDGET_US;
  let modeledMissedBufferWindows = 0;
  for (
    let start = 0;
    start + quantaPerBuffer <= renderTimesUs.length;
    start += quantaPerBuffer
  ) {
    let renderUs = 0;
    for (let offset = 0; offset < quantaPerBuffer; offset += 1) {
      renderUs += renderTimesUs[start + offset] ?? 0;
    }
    if (renderUs * slowdown >= bufferBudgetUs) {
      modeledMissedBufferWindows += 1;
    }
  }
  const modeledBypassMonitoringMs =
    ((modeledBufferFrames * 2) / SAMPLE_RATE) * 1000;
  return {
    modeledAutotuneMonitoringMs: Number(
      (
        modeledBypassMonitoringMs +
        (AUTOTUNE_ALGORITHMIC_LATENCY_FRAMES / SAMPLE_RATE) * 1000
      ).toFixed(2)
    ),
    modeledBufferFramesPerDirection: modeledBufferFrames,
    modeledBypassMonitoringMs: Number(modeledBypassMonitoringMs.toFixed(2)),
    modeledMissedBufferWindows,
    modeledMissedQuanta: renderTimesUs.filter(
      (time) => time * slowdown >= QUANTUM_BUDGET_US
    ).length,
    windowCount: Math.floor(renderTimesUs.length / quantaPerBuffer),
  };
}

const slowdownArgument = Bun.argv.find((argument) =>
  argument.startsWith("--mobile-slowdown=")
);
const slowdownOverride = slowdownArgument
  ? Number(slowdownArgument.split("=")[1])
  : null;
if (slowdownOverride !== null && !(slowdownOverride > 0)) {
  throw new Error("--mobile-slowdown must be a positive number");
}

const autotune = await createOfficialAutotune();
for (let index = 0; index < WARMUP_QUANTA; index += 1) {
  autotune.prepareInput();
  autotune.process();
}
const quantumTimesUs: number[] = [];
for (let index = 0; index < MEASURED_QUANTA; index += 1) {
  autotune.prepareInput();
  const before = performance.now();
  autotune.process();
  quantumTimesUs.push((performance.now() - before) * 1000);
}
const sortedQuantumTimesUs = [...quantumTimesUs].sort(
  (left, right) => left - right
);
const hostP95Us = percentile(sortedQuantumTimesUs, 0.95);
const mobileSlowdown =
  slowdownOverride ?? (QUANTUM_BUDGET_US * TARGET_MOBILE_P95_LOAD) / hostP95Us;
const scenarios = [128, 256, 512, 1024].map((modeledBufferFrames) =>
  simulateBuffer(quantumTimesUs, modeledBufferFrames, mobileSlowdown)
);
const [direct] = scenarios;
const buffered = scenarios.find(
  (scenario) => scenario.modeledMissedBufferWindows === 0
);
const result = {
  benchmark: "official-opendaw-mobile-autotune-buffer-model",
  comparisonGuidance:
    "For phone comparison, pass --mobile-slowdown=(phone effects.timing.p95Ms * 1000) / host.p95Us from a captured phone trace; default calibration is synthetic.",
  host: {
    maxUs: Number((sortedQuantumTimesUs.at(-1) ?? 0).toFixed(2)),
    p50Us: Number(percentile(sortedQuantumTimesUs, 0.5).toFixed(2)),
    p95Us: Number(hostP95Us.toFixed(2)),
    p99Us: Number(percentile(sortedQuantumTimesUs, 0.99).toFixed(2)),
  },
  mobileSlowdown: Number(mobileSlowdown.toFixed(2)),
  modeledLatencyAssumption:
    "one modeledBufferFramesPerDirection input buffer plus one equal-sized output buffer, then Autotune adds its fixed 1280-frame PSOLA delay",
  modelLimitations: [
    "This models render scheduling from the real Autotune WASM timings; it does not run on or reproduce a phone.",
    "The latency estimate assumes equal input and output device buffers; real phone buffers can differ.",
  ],
  quantumBudgetUs: Number(QUANTUM_BUDGET_US.toFixed(2)),
  scenarios,
  slowdownSource:
    slowdownOverride === null
      ? `synthetic calibration to ${TARGET_MOBILE_P95_LOAD * 100}% p95 render load`
      : "explicit phone-comparison override",
  verdict:
    direct.modeledMissedBufferWindows > 0 && buffered !== undefined
      ? "MODEL RED: small buffer misses deadlines; a larger buffer window trades modeled latency for headroom"
      : "MODEL GREEN: configured slowdown did not model the buffer tradeoff",
};
console.log(JSON.stringify(result, null, 2));
if (result.verdict.startsWith("MODEL RED")) {
  process.exitCode = 1;
}
