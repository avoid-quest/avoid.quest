export type WerkstattPreset = {
  id:
    | "pass-through"
    | "hard-clipper"
    | "ring-modulator"
    | "simple-delay"
    | "biquad-lowpass"
    | "alienator"
    | "beautifier";
  label: string;
  description: string;
  source: string;
};

const PASS_THROUGH = `// @label Pass Through

class Processor {
  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      outL[i] = srcL[i]
      outR[i] = srcR[i]
    }
  }
}`;

// These six sources are the official examples from the openDAW source snapshot
// pinned in OPENDAW_WERKSTATT_RESEARCH.md.
const HARD_CLIPPER = `// @label Hard Clipper
// @param threshold 0.5 0.1 1.0 linear
// @param soft false

class Processor {
    threshold = 0.5
    soft = 0
    paramChanged(label, value) {
        if (label === "threshold") this.threshold = value
        if (label === "soft") this.soft = value
    }
    process({src, out}, {s0, s1}) {
        const [srcL, srcR] = src
        const [outL, outR] = out
        const t = this.threshold
        if (this.soft) {
            for (let i = s0; i < s1; i++) {
                outL[i] = Math.tanh(srcL[i] / t) * t
                outR[i] = Math.tanh(srcR[i] / t) * t
            }
        } else {
            for (let i = s0; i < s1; i++) {
                outL[i] = Math.max(-t, Math.min(t, srcL[i]))
                outR[i] = Math.max(-t, Math.min(t, srcR[i]))
            }
        }
    }
}`;

const RING_MODULATOR = `// @label Ring Modulator
// @param frequency 440 20 2000 exp Hz

class Processor {
    phase = 0
    frequency = 440
    paramChanged(label, value) {
        if (label === "frequency") this.frequency = value
    }
    process({src, out}, {s0, s1}) {
        const [srcL, srcR] = src
        const [outL, outR] = out
        const inc = this.frequency / sampleRate
        for (let i = s0; i < s1; i++) {
            const mod = Math.sin(this.phase * Math.PI * 2)
            this.phase += inc
            if (this.phase >= 1) this.phase -= 1
            outL[i] = srcL[i] * mod
            outR[i] = srcR[i] * mod
        }
    }
}`;

const SIMPLE_DELAY = `// @label Simple Delay
// @param time 0.5 0.001 2.0 exp s
// @param feedback 0.5 0 0.95 linear

class Processor {
    bufferL = new Float32Array(sampleRate * 2)
    bufferR = new Float32Array(sampleRate * 2)
    writeHead = 0
    delaySamples = sampleRate * 0.5
    feedback = 0.5
    paramChanged(label, value) {
        if (label === "time") this.delaySamples = Math.round(value * sampleRate)
        if (label === "feedback") this.feedback = value
    }
    process({src, out}, {s0, s1}) {
        const [srcL, srcR] = src
        const [outL, outR] = out
        for (let i = s0; i < s1; i++) {
            const readHead = (this.writeHead - this.delaySamples + this.bufferL.length) % this.bufferL.length
            const delayedL = this.bufferL[readHead]
            const delayedR = this.bufferR[readHead]
            this.bufferL[this.writeHead] = srcL[i] + delayedL * this.feedback
            this.bufferR[this.writeHead] = srcR[i] + delayedR * this.feedback
            this.writeHead = (this.writeHead + 1) % this.bufferL.length
            outL[i] = srcL[i] + delayedL
            outR[i] = srcR[i] + delayedR
        }
    }
}`;

const BIQUAD_LOWPASS = `// @label Biquad Lowpass
// @param cutoff 1000 20 20000 exp Hz
// @param resonance 0.707 0.1 10 linear

class Processor {
    x1L = 0; x2L = 0; y1L = 0; y2L = 0
    x1R = 0; x2R = 0; y1R = 0; y2R = 0
    b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0
    cutoff = 1000; resonance = 0.707
    paramChanged(label, value) {
        if (label === "cutoff") this.cutoff = value
        if (label === "resonance") this.resonance = value
        this.recalcCoefficients(this.cutoff, this.resonance)
    }
    recalcCoefficients(cutoff, resonance) {
        const w0 = 2 * Math.PI * cutoff / sampleRate
        const alpha = Math.sin(w0) / (2 * resonance)
        const cosw0 = Math.cos(w0)
        const a0 = 1 + alpha
        this.b0 = ((1 - cosw0) / 2) / a0
        this.b1 = (1 - cosw0) / a0
        this.b2 = this.b0
        this.a1 = (-2 * cosw0) / a0
        this.a2 = (1 - alpha) / a0
    }
    process({src, out}, {s0, s1}) {
        const [srcL, srcR] = src
        const [outL, outR] = out
        for (let i = s0; i < s1; i++) {
            const oL = this.b0 * srcL[i] + this.b1 * this.x1L + this.b2 * this.x2L
                - this.a1 * this.y1L - this.a2 * this.y2L
            this.x2L = this.x1L; this.x1L = srcL[i]
            this.y2L = this.y1L; this.y1L = oL
            outL[i] = oL
            const oR = this.b0 * srcR[i] + this.b1 * this.x1R + this.b2 * this.x2R
                - this.a1 * this.y1R - this.a2 * this.y2R
            this.x2R = this.x1R; this.x1R = srcR[i]
            this.y2R = this.y1R; this.y1R = oR
            outR[i] = oR
        }
    }
}`;

const ALIENATOR = `// @label Alienator
// by Chaosmeister - https://github.com/Chaosmeister
// @param chaos    0.0   0.0   1.0
// @param drift    0.0   0.0   1.0
// @param fold     0.0   0.0   1.0
// @param crush    16.0   1.0   16.0 int Bits
// @param decimate 0.0   0.0   1.0 linear %
// @param release  1.0   0.0   1.0
// @param ring     0.0   0.0   1.0
// @param ringHz   220   10    4000  exp  Hz
// @param dry/wet  0.0   -1.0   1.0

const ALIEN_DELAY = 65536
const ALIEN_MASK = ALIEN_DELAY - 1

class Processor {
    fold = 0.0
    crush = 16.0
    decimate = 0.0
    ring = 0.0
    ringHz = 220
    chaos = 0.0
    drift = 0.0
    release = 1.0
    wet = 0.0
    ringPhL = 0.0
    ringPhR = 0.0
    TWO_PI = Math.PI * 2
    decimHoldL = 0.0
    decimHoldR = 0.0
    decimCntL = 0
    decimCntR = 0
    delayL = new Float32Array(ALIEN_DELAY)
    delayR = new Float32Array(ALIEN_DELAY)
    delayWr = 0

    paramChanged(label, value) {
        if (label === 'chaos') this.chaos = value
        if (label === 'drift') this.drift = value
        if (label === 'fold') this.fold = value
        if (label === 'crush') this.crush = value
        if (label === 'decimate') this.decimate = value
        if (label === 'ring') this.ring = value
        if (label === 'ringHz') this.ringHz = value
        if (label === 'release') this.release = value
        if (label === 'dry/wet') this.wet = value
    }

    _fold(x) {
        x = x % 4.0
        if (x > 2.0) x = x - 4.0
        if (x < -2.0) x = x + 4.0
        if (x > 1.0) x = 2.0 - x
        if (x < -1.0) x = -2.0 - x
        return x
    }

    process({ src, out }, { s0, s1, flags }) {
        const srcL = src[0], srcR = src[1]
        const outL = out[0], outR = out[1]
        const ringInc = this.ringHz / sampleRate * this.TWO_PI
        const ringDetune = ringInc * 1.00073
        const foldDrive = 1.0 + this.fold * 18.0
        const hasFold = this.fold > 0.001
        const hasCrush = this.crush !== 16
        const hasDecim = this.decimate > 0.001
        const hasRing = this.ring > 0.001
        const chaosAmt = this.chaos
        const wetAmt = Math.min(Math.max(this.wet / 2 + 0.5, 0), 1)
        const dryAmt = Math.abs(Math.min(Math.max(this.wet / 2 - 0.5, -1), 0))
        const bits = this.crush
        const crushLevels = Math.pow(2.0, bits)
        const crushInv = 1.0 / crushLevels
        const decimStep = 1 + Math.floor(this.decimate * 63.0)
        const chaosBase = Math.floor(0.008 * sampleRate)
        const chaosSwing = Math.floor(0.004 * sampleRate)
        const chaosFB = chaosAmt * 0.65

        if (flags & 2) {
            this.ringPhL = 0.0
            this.ringPhR = 0.0
            this.decimHoldL = 0.0
            this.decimHoldR = 0.0
            this.decimCntL = 0
            this.decimCntR = 0
        } else if (!hasDecim) {
            this.decimHoldL = 0.0
            this.decimHoldR = 0.0
            this.decimCntL = 0
            this.decimCntR = 0
        }

        for (let i = s0; i < s1; i++) {
            let xL = srcL[i]
            let xR = srcR[i]
            const dryL = xL
            const dryR = xR

            if (chaosAmt > 0.001) {
                const swing = xL < -1.0 ? -1.0 : xL > 1.0 ? 1.0 : xL
                const offset = chaosBase + Math.floor(swing * chaosSwing)
                const rdL = ((1 - this.drift) * this.delayWr - offset + ALIEN_DELAY) & ALIEN_MASK
                const rdR = ((1 - this.drift) * this.delayWr - offset - 7 + ALIEN_DELAY) & ALIEN_MASK
                xL += this.delayL[rdL] * chaosFB
                xR += this.delayR[rdR] * chaosFB
            }
            if (hasFold) {
                xL = this._fold(xL * foldDrive)
                xR = this._fold(xR * foldDrive)
            }
            if (hasCrush) {
                xL = Math.round(xL * crushLevels) * crushInv
                xR = Math.round(xR * crushLevels) * crushInv
            }
            if (hasDecim) {
                if (this.decimCntL <= 0) {
                    this.decimHoldL = xL
                    this.decimCntL = decimStep
                }
                if (this.decimCntR <= 0) {
                    this.decimHoldR = xR
                    this.decimCntR = decimStep
                }
                this.decimCntL--
                this.decimCntR--
                xL = this.decimHoldL
                xR = this.decimHoldR
            }
            if (hasRing) {
                const rl = Math.sin(this.ringPhL)
                const rr = Math.sin(this.ringPhR)
                xL = xL * (1.0 - this.ring) + xL * rl * this.ring
                xR = xR * (1.0 - this.ring) + xR * rr * this.ring
                this.ringPhL += ringInc
                if (this.ringPhL > this.TWO_PI) this.ringPhL -= this.TWO_PI
                this.ringPhR += ringDetune
                if (this.ringPhR > this.TWO_PI) this.ringPhR -= this.TWO_PI
            }

            this.delayL[this.delayWr] = xL * this.release
            this.delayR[this.delayWr] = xR * this.release
            this.delayWr = (this.delayWr + 1) & ALIEN_MASK
            xL = Math.tanh(xL)
            xR = Math.tanh(xR)
            outL[i] = dryL * dryAmt + xL * wetAmt
            outR[i] = dryR * dryAmt + xR * wetAmt
        }
    }
}`;

const BEAUTIFIER = `// @label Beautifier
// by Chaosmeister - https://github.com/Chaosmeister
// @param warmth  0.3   0.0  1.0
// @param air     0.3   0.0  1.0
// @param width   0.3   0.0  1.0
// @param punch   0.3   0.0  1.0
// @param output  1.0   0.5  1.5  linear

class Processor {
    warmth = 0.3
    air = 0.3
    width = 0.3
    punch = 0.3
    output = 1.0
    warmHpL = 0.0
    warmHpR = 0.0
    airHpL = 0.0
    airHpR = 0.0
    punchEnvFastL = 0.0
    punchEnvFastR = 0.0
    punchEnvSlowL = 0.0
    punchEnvSlowR = 0.0
    warmHpCoef = 0.0
    airHpCoef = 0.0
    warmPrevL = 0.0
    warmPrevR = 0.0
    airPrevL = 0.0
    airPrevR = 0.0
    punchAttFast = 0.0
    punchAttSlow = 0.0
    punchRel = 0.0

    constructor() {
        const T = 1.0 / sampleRate
        const hpCoef = (fc) => {
            const tau = 1.0 / (2.0 * Math.PI * fc)
            return tau / (tau + T)
        }
        this.warmHpCoef = hpCoef(300)
        this.airHpCoef = hpCoef(6000)
        const envCoef = (ms) => 1.0 - Math.exp(-1.0 / (sampleRate * ms * 0.001))
        this.punchAttFast = envCoef(1)
        this.punchAttSlow = envCoef(30)
        this.punchRel = envCoef(150)
    }

    paramChanged(label, value) {
        if (label === 'warmth') this.warmth = value
        if (label === 'air') this.air = value
        if (label === 'width') this.width = value
        if (label === 'punch') this.punch = value
        if (label === 'output') this.output = value
    }

    _soft(x) {
        return x / (1.0 + (x < 0 ? -x : x))
    }

    process({ src, out }, { s0, s1 }) {
        const srcL = src[0], srcR = src[1]
        const outL = out[0], outR = out[1]
        const doWarmth = this.warmth > 0.001
        const doAir = this.air > 0.001
        const doPunch = this.punch > 0.001
        const doWidth = this.width > 0.001
        const warmMix = this.warmth * 0.35
        const warmHp = this.warmHpCoef
        const airMix = this.air * 0.4
        const airHp = this.airHpCoef
        const punchMix = this.punch * 0.6
        const attFast = this.punchAttFast
        const attSlow = this.punchAttSlow
        const rel = this.punchRel
        const sideGain = 1.0 + this.width * 1.5
        const midGain = 1.0 - this.width * 0.12
        const outputGain = this.output

        for (let i = s0; i < s1; i++) {
            let xL = srcL[i]
            let xR = srcR[i]
            if (doWarmth) {
                const satL = this._soft(xL)
                const satR = this._soft(xR)
                const newPrevL = satL
                const newPrevR = satR
                const warmExcL = warmHp * (this.warmHpL + satL - this.warmPrevL)
                const warmExcR = warmHp * (this.warmHpR + satR - this.warmPrevR)
                this.warmHpL = warmExcL
                this.warmHpR = warmExcR
                this.warmPrevL = newPrevL
                this.warmPrevR = newPrevR
                xL += warmExcL * warmMix
                xR += warmExcR * warmMix
            }
            if (doAir) {
                const airExcL = airHp * (this.airHpL + xL - this.airPrevL)
                const airExcR = airHp * (this.airHpR + xR - this.airPrevR)
                this.airHpL = airExcL
                this.airHpR = airExcR
                this.airPrevL = xL
                this.airPrevR = xR
                xL += this._soft(airExcL) * airMix
                xR += this._soft(airExcR) * airMix
            }
            if (doPunch) {
                const absL = xL < 0 ? -xL : xL
                const absR = xR < 0 ? -xR : xR
                const dfL = absL - this.punchEnvFastL
                const dfR = absR - this.punchEnvFastR
                this.punchEnvFastL += dfL > 0 ? dfL * attFast : dfL * rel
                this.punchEnvFastR += dfR > 0 ? dfR * attFast : dfR * rel
                const dsL = absL - this.punchEnvSlowL
                const dsR = absR - this.punchEnvSlowR
                this.punchEnvSlowL += dsL > 0 ? dsL * attSlow : dsL * rel
                this.punchEnvSlowR += dsR > 0 ? dsR * attSlow : dsR * rel
                let transL = this.punchEnvFastL - this.punchEnvSlowL
                let transR = this.punchEnvFastR - this.punchEnvSlowR
                if (transL < 0) transL = 0
                if (transR < 0) transR = 0
                xL += (xL < 0 ? -transL : transL) * punchMix
                xR += (xR < 0 ? -transR : transR) * punchMix
            }
            if (doWidth) {
                const mid = (xL + xR) * 0.5
                const side = (xL - xR) * 0.5
                xL = mid * midGain + side * sideGain
                xR = mid * midGain - side * sideGain
            }
            outL[i] = xL * outputGain
            outR[i] = xR * outputGain
        }
    }
}`;

export const WERKSTATT_PRESETS: readonly WerkstattPreset[] = [
  {
    description: "Neutral baseline and safe recovery source.",
    id: "pass-through",
    label: "Pass Through",
    source: PASS_THROUGH,
  },
  {
    description: "Official threshold clipper with hard and soft modes.",
    id: "hard-clipper",
    label: "Hard Clipper",
    source: HARD_CLIPPER,
  },
  {
    description: "Official stateful oscillator example.",
    id: "ring-modulator",
    label: "Ring Modulator",
    source: RING_MODULATOR,
  },
  {
    description: "Official two-second feedback delay.",
    id: "simple-delay",
    label: "Simple Delay",
    source: SIMPLE_DELAY,
  },
  {
    description: "Official resonant low-pass filter.",
    id: "biquad-lowpass",
    label: "Biquad Lowpass",
    source: BIQUAD_LOWPASS,
  },
  {
    description: "Official multi-stage experimental mangler.",
    id: "alienator",
    label: "Alienator",
    source: ALIENATOR,
  },
  {
    description: "Official mastering enhancer for full-program audio.",
    id: "beautifier",
    label: "Beautifier",
    source: BEAUTIFIER,
  },
];

export const DEFAULT_WERKSTATT_SOURCE = PASS_THROUGH;
