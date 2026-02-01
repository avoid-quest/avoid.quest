# RFC: Advanced DJ Routing & External Inputs

## Overview

Implementare un sistema avanzato di routing audio per DJ mode con:
- External inputs (YouTube*, file locali, scheda audio)
- Selezione dispositivi I/O
- CUE channel per pre-ascolto
- Integrazione estesa con openDAW

## Architettura Attuale

```
┌─────────────────────────────────────────────────────────────────┐
│                        Current Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Html5AudioSource → GainNode → PannerNode → BiquadFilter        │
│                                      ↓                          │
│                              WorkletNode (DSP Effects)          │
│                                      ↓                          │
│                              MasterGainNode → Destination       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Già implementato:**
- `Html5AudioSource` - streaming da URL (Bandcamp, SoundCloud proxy)
- `MicSource` - input microfono (già presente, non esposto in UI)
- DSP effects via AudioWorklet (@opendaw/lib-dsp)
- 2 deck con crossfader

## Architettura Proposta

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Proposed Architecture                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                          INPUT SOURCES                                   │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │ │
│  │  │ Html5Source  │ │  FileSource  │ │ DeviceSource │ │ YouTube(?)   │   │ │
│  │  │ (streaming)  │ │ (local file) │ │ (audio card) │ │ (see notes)  │   │ │
│  │  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘   │ │
│  └─────────┼────────────────┼────────────────┼────────────────┼───────────┘ │
│            │                │                │                │             │
│            └────────────────┴────────────────┴────────────────┘             │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                           DECK (A or B)                                  │ │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────────────────────┐ │ │
│  │  │  Gain   │ → │   Pan   │ → │ Filter  │ → │  DSP Effects (Worklet)  │ │ │
│  │  └─────────┘   └─────────┘   └─────────┘   └────────────┬────────────┘ │ │
│  └─────────────────────────────────────────────────────────┼───────────────┘ │
│                                                            │                 │
│                              ┌─────────────────────────────┼─────────┐       │
│                              │                             │         │       │
│                              ▼                             ▼         │       │
│  ┌───────────────────────────────────────┐   ┌────────────────────┐ │       │
│  │           MASTER BUS                   │   │     CUE BUS        │ │       │
│  │  ┌─────────────┐   ┌───────────────┐  │   │  ┌──────────────┐  │ │       │
│  │  │  Crossfader │ → │ Master Effects│  │   │  │  CUE Volume  │  │ │       │
│  │  └─────────────┘   └───────────────┘  │   │  └──────────────┘  │ │       │
│  │         │                  │          │   │         │          │ │       │
│  │         ▼                  ▼          │   │         ▼          │ │       │
│  │  ┌────────────────────────────────┐   │   │  ┌──────────────┐  │ │       │
│  │  │     MAIN OUTPUT DEVICE         │   │   │  │ CUE OUTPUT   │  │ │       │
│  │  │     (Speaker/PA)               │   │   │  │ (Headphones) │  │ │       │
│  │  └────────────────────────────────┘   │   │  └──────────────┘  │ │       │
│  └───────────────────────────────────────┘   └────────────────────┘ │       │
│                                                                      │       │
│  ┌──────────────────────────────────────────────────────────────────┘       │
│  │  CUE MIX CONTROL (Headphone)                                             │
│  │  ┌────────────────────────────────────────────────────────────────┐      │
│  │  │  [CUE] ◄──────────────●──────────────► [MIX]                   │      │
│  │  │         Pre-listen only │ Both │ Main mix only                 │      │
│  │  └────────────────────────────────────────────────────────────────┘      │
│  │                                                                          │
└──┴──────────────────────────────────────────────────────────────────────────┘
```

## Componenti da Implementare

### 1. FileSource - Input da File Locali

```typescript
// lib/audio/playback/file-source.ts

export class FileSource {
  private audioElement: HTMLAudioElement;
  private source: MediaElementAudioSourceNode | null = null;
  private objectUrl: string | null = null;

  async loadFile(file: File): Promise<void> {
    // Cleanup previous
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
    }
    
    this.objectUrl = URL.createObjectURL(file);
    this.audioElement.src = this.objectUrl;
    
    // Create MediaElementSource
    this.source = this.context.createMediaElementSource(this.audioElement);
  }
  
  get output(): AudioNode | null {
    return this.source;
  }
  
  // Drag & drop UI in deck component
}
```

**Formati supportati:** MP3, WAV, FLAC, OGG, AAC, M4A (browser-dependent)

### 2. DeviceSource - Input da Scheda Audio

```typescript
// lib/audio/playback/device-source.ts

export type AudioDeviceInfo = {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
};

export class DeviceSource {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  /**
   * Enumerate available audio devices
   */
  static async getDevices(): Promise<AudioDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput')
      .map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Device ${d.deviceId.slice(0, 8)}`,
        kind: d.kind as 'audioinput' | 'audiooutput'
      }));
  }
  
  /**
   * Start capturing from specific device
   */
  async start(deviceId?: string): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Latenza minima
        latency: 0,
        sampleRate: 48000
      }
    });
    
    this.source = this.context.createMediaStreamSource(this.stream);
  }
}
```

### 3. Audio Output Routing

```typescript
// lib/audio/routing/output-router.ts

export class OutputRouter {
  private mainContext: AudioContext;
  private cueContext: AudioContext | null = null;
  
  private mainDeviceId: string = 'default';
  private cueDeviceId: string | null = null;
  
  /**
   * Set main output device
   */
  async setMainOutput(deviceId: string): Promise<void> {
    if ('setSinkId' in AudioContext.prototype) {
      await (this.mainContext as any).setSinkId(deviceId);
      this.mainDeviceId = deviceId;
    } else {
      console.warn('setSinkId not supported - using default output');
    }
  }
  
  /**
   * Set CUE/headphone output device
   * Creates separate AudioContext for independent routing
   */
  async setCueOutput(deviceId: string): Promise<void> {
    if (!this.cueContext) {
      this.cueContext = new AudioContext();
    }
    
    if ('setSinkId' in AudioContext.prototype) {
      await (this.cueContext as any).setSinkId(deviceId);
      this.cueDeviceId = deviceId;
    }
  }
}
```

### 4. CUE Bus System

```typescript
// lib/audio/routing/cue-bus.ts

export type CueMix = {
  cueLevel: number;  // 0-1 how much CUE (pre-fader) to hear
  mixLevel: number;  // 0-1 how much main mix to hear
};

export class CueBus {
  private cueGain: GainNode;
  private mixGain: GainNode;
  private merger: ChannelMergerNode;
  
  // Each deck has a CUE send
  private deckCueSends: Map<string, {
    enabled: boolean;
    gain: GainNode;
  }> = new Map();
  
  /**
   * Toggle CUE for a deck (pre-listen in headphones)
   */
  setCueEnabled(deckId: string, enabled: boolean): void {
    const send = this.deckCueSends.get(deckId);
    if (send) {
      send.enabled = enabled;
      send.gain.gain.value = enabled ? 1 : 0;
    }
  }
  
  /**
   * Set CUE/MIX blend for headphones
   * 0 = only CUE, 0.5 = both, 1 = only MIX
   */
  setCueMix(blend: number): void {
    this.cueLevel = 1 - blend;
    this.mixLevel = blend;
    
    this.cueGain.gain.setTargetAtTime(this.cueLevel, this.context.currentTime, 0.01);
    this.mixGain.gain.setTargetAtTime(this.mixLevel, this.context.currentTime, 0.01);
  }
}
```

## YouTube Integration - ⚠️ Limitazioni

### Problema
YouTube/YouTube Music **non permette** l'estrazione audio programmatica (violazione ToS).

### Opzioni

| Approccio | Pro | Contro | Legalità |
|-----------|-----|--------|----------|
| **iframe embed** | Semplice | No audio routing, no controllo | ✅ OK |
| **yt-dlp server-side** | Funziona | Server-side only, gray area | ⚠️ Gray |
| **Audio capture (hacky)** | Client-side | Complesso, unreliable | ❌ ToS violation |
| **YouTube Music Premium API** | Official | Richiede partnership | ✅ OK (se approvati) |

### Raccomandazione

**Non implementare YouTube per ora.** Invece:

1. **Espandere piattaforme esistenti:**
   - SoundCloud ✅ (già fatto)
   - Bandcamp ✅ (già fatto)
   - Mixcloud (API disponibile)
   - Internet Archive (pubblico)

2. **Focus su local files:** Più utile per DJ reali

3. **Future:** Se serve YouTube, valutare partnership ufficiale o self-hosted proxy (per uso personale)

## UI Components

### Device Selection Dialog

```tsx
// components/audio/device-selector.tsx

export function DeviceSelector() {
  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([]);
  
  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Audio Devices</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Input Device */}
          <div>
            <Label>Audio Input</Label>
            <Select onValueChange={setInputDevice}>
              {inputDevices.map(d => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          
          {/* Main Output */}
          <div>
            <Label>Main Output (Speakers/PA)</Label>
            <Select onValueChange={setMainOutput}>
              {outputDevices.map(d => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          
          {/* CUE Output */}
          <div>
            <Label>CUE/Headphones Output</Label>
            <Select onValueChange={setCueOutput}>
              <SelectItem value="none">Same as Main</SelectItem>
              {outputDevices.map(d => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### File Drop Zone per Deck

```tsx
// components/radio/dj/deck-drop-zone.tsx

export function DeckDropZone({ deckId, onFileLoad }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  
  const handleDrop = async (e: DragEvent) => {
    const file = e.dataTransfer?.files[0];
    if (file && isAudioFile(file)) {
      await onFileLoad(file);
    }
  };
  
  return (
    <div 
      className={cn(
        "border-2 border-dashed rounded-lg p-4 transition-colors",
        isDragging && "border-primary bg-primary/10"
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input 
        type="file" 
        accept="audio/*" 
        className="hidden"
        onChange={handleFileSelect}
      />
      <p className="text-muted-foreground text-center">
        Drop audio file here or click to browse
      </p>
    </div>
  );
}
```

### CUE Controls

```tsx
// components/radio/dj/cue-controls.tsx

export function CueControls() {
  const [deckACue, setDeckACue] = useState(false);
  const [deckBCue, setDeckBCue] = useState(false);
  const [cueMix, setCueMix] = useState(0.5); // 0=CUE, 1=MIX
  
  return (
    <div className="flex items-center gap-4 p-2 bg-muted rounded-lg">
      {/* Deck A CUE button */}
      <Button
        variant={deckACue ? "default" : "outline"}
        size="sm"
        onClick={() => toggleDeckCue('deck-a')}
      >
        <HeadphonesIcon className="size-4 mr-1" />
        A
      </Button>
      
      {/* Deck B CUE button */}
      <Button
        variant={deckBCue ? "default" : "outline"}
        size="sm"
        onClick={() => toggleDeckCue('deck-b')}
      >
        <HeadphonesIcon className="size-4 mr-1" />
        B
      </Button>
      
      {/* CUE/MIX blend */}
      <div className="flex items-center gap-2 flex-1">
        <span className="text-xs text-muted-foreground">CUE</span>
        <Slider
          value={[cueMix]}
          onValueChange={([v]) => setCueMix(v)}
          min={0}
          max={1}
          step={0.01}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground">MIX</span>
      </div>
    </div>
  );
}
```

## Integrazione openDAW Estesa

### Effetti Aggiuntivi da @opendaw/lib-dsp

Già disponibili nel pacchetto:
- `crusher` - Bit crusher ✅ (già usato)
- `delay` - Delay stereo ✅ (già usato)
- `reverb` (Dattorro) ✅ (già usato)
- `biquad-processor` - Filtri biquad
- `convolver` - Convolution reverb
- `fft` - FFT analysis
- `lfo` - LFO modulation
- `adsr` - Envelope generator
- `PulseOsc` - Pulse oscillator

### Nuovi Effetti da Aggiungere

```typescript
// Da implementare usando @opendaw/lib-dsp
const ADDITIONAL_EFFECTS = [
  'convolution-reverb',  // IR-based reverb
  'phaser',              // Phase modulation
  'flanger',             // Flanging effect  
  'chorus',              // Chorus effect
  'tremolo',             // Amplitude modulation
  'autopan',             // Automated panning
  'gate',                // Noise gate
];
```

## Fasi di Implementazione

### Phase 1: File Input (2-3h)
- [ ] `FileSource` class
- [ ] Drag & drop UI nel deck
- [ ] File browser/selector
- [ ] Waveform preview (opzionale)

### Phase 2: Device Selection (3-4h)
- [ ] `DeviceSource` class (estendere MicSource)
- [ ] Device enumeration utility
- [ ] `OutputRouter` class
- [ ] Device selector UI
- [ ] Persistenza preferenze dispositivi

### Phase 3: CUE System (4-5h)
- [ ] `CueBus` class
- [ ] Dual AudioContext per output separati
- [ ] CUE buttons per deck
- [ ] CUE/MIX blend control
- [ ] Split cue (mono L=CUE, R=MIX) come alternativa

### Phase 4: UI Polish (2-3h)
- [ ] Settings page per audio routing
- [ ] Indicatori visivi stato CUE
- [ ] Keyboard shortcuts (C per toggle CUE)
- [ ] Mobile-friendly controls

### Phase 5: Extended Effects (opzionale, 3-4h)
- [ ] Aggiungere effetti openDAW mancanti
- [ ] Effect presets
- [ ] Effect chain templates (e.g., "Lo-Fi", "Club", "Radio")

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Web Audio API | ✅ | ✅ | ✅ | ✅ |
| AudioWorklet | ✅ | ✅ | ✅ 15.4+ | ✅ |
| getUserMedia | ✅ | ✅ | ✅ | ✅ |
| enumerateDevices | ✅ | ✅ | ✅ | ✅ |
| setSinkId | ✅ | ❌* | ❌ | ✅ |
| MediaSession | ✅ | ✅ | ✅ | ✅ |

*Firefox: Behind flag `media.setsinkid.enabled`

**Fallback per setSinkId:** Se non supportato, usare selezione output a livello di sistema operativo.

## Stima Effort Totale

| Phase | Ore | Priorità |
|-------|-----|----------|
| Phase 1: File Input | 2-3h | 🔴 Alta |
| Phase 2: Device Selection | 3-4h | 🔴 Alta |
| Phase 3: CUE System | 4-5h | 🟡 Media |
| Phase 4: UI Polish | 2-3h | 🟡 Media |
| Phase 5: Extended Effects | 3-4h | 🟢 Bassa |
| **Totale** | **14-19h** | |

## Domande Aperte

1. **YouTube:** Vuoi comunque un iframe embed (solo visualizzazione, no mixing)?
2. **Mixcloud:** Aggiungere supporto streaming?
3. **Recording:** Aggiungere registrazione mix output?
4. **MIDI:** Supporto controller MIDI per DJ hardware?

---

*RFC v1.0 - 2026-02-01*
