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

## Decisioni Finali

- ❌ **YouTube:** Skippato completamente (ToS, no audio routing)
- ❌ **Recording:** Non implementare
- ✅ **MIDI:** Supporto controller DJ hardware
- ✅ **Mixcloud:** Aggiungere come piattaforma streaming

---

## MIDI Controller Support

### Web MIDI API

```typescript
// lib/midi/midi-controller.ts

export type MidiMapping = {
  channel: number;
  control: number;
  action: MidiAction;
  deckId?: 'deck-a' | 'deck-b';
};

export type MidiAction = 
  | 'play' | 'pause' | 'cue' | 'sync'
  | 'volume' | 'crossfader' | 'pitch'
  | 'eq-low' | 'eq-mid' | 'eq-high'
  | 'filter' | 'effect-1' | 'effect-2';

export class MidiController {
  private midiAccess: MIDIAccess | null = null;
  private mappings: Map<string, MidiMapping> = new Map();
  
  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI not supported');
      return false;
    }
    
    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.setupInputListeners();
      return true;
    } catch (e) {
      console.error('MIDI access denied:', e);
      return false;
    }
  }
  
  private setupInputListeners(): void {
    if (!this.midiAccess) return;
    
    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = this.handleMidiMessage.bind(this);
    }
  }
  
  private handleMidiMessage(event: MIDIMessageEvent): void {
    const [status, control, value] = event.data;
    const channel = status & 0x0F;
    const messageType = status & 0xF0;
    
    // CC message (0xB0)
    if (messageType === 0xB0) {
      const key = `${channel}:${control}`;
      const mapping = this.mappings.get(key);
      if (mapping) {
        this.executeAction(mapping.action, value / 127, mapping.deckId);
      }
    }
    
    // Note On (0x90) - buttons
    if (messageType === 0x90 && value > 0) {
      const key = `note:${channel}:${control}`;
      const mapping = this.mappings.get(key);
      if (mapping) {
        this.executeAction(mapping.action, 1, mapping.deckId);
      }
    }
  }
  
  private executeAction(action: MidiAction, value: number, deckId?: string): void {
    // Dispatch to DJ actions
    switch (action) {
      case 'crossfader':
        setCrossfader(value);
        break;
      case 'volume':
        if (deckId) setDeckVolume(deckId, value);
        break;
      case 'play':
        if (deckId) togglePlay(deckId);
        break;
      // ... etc
    }
  }
  
  /**
   * MIDI Learn mode - next incoming CC gets mapped
   */
  startLearn(action: MidiAction, deckId?: string): void {
    this.learningAction = { action, deckId };
  }
}
```

### Common DJ Controller Mappings

```typescript
// Preset mappings per controller comuni
const CONTROLLER_PRESETS = {
  'Pioneer DDJ-200': {
    crossfader: { channel: 0, control: 8 },
    deckA: {
      play: { channel: 0, note: 11 },
      cue: { channel: 0, note: 12 },
      volume: { channel: 0, control: 19 },
      pitch: { channel: 0, control: 9 },
    },
    deckB: {
      play: { channel: 1, note: 11 },
      cue: { channel: 1, note: 12 },
      volume: { channel: 1, control: 19 },
      pitch: { channel: 1, control: 9 },
    }
  },
  'Numark DJ2GO2': { /* ... */ },
  'Native Instruments Traktor S2': { /* ... */ }
};
```

### MIDI Settings UI

```tsx
// components/settings/midi-settings.tsx

export function MidiSettings() {
  const [devices, setDevices] = useState<MIDIInput[]>([]);
  const [learning, setLearning] = useState<MidiAction | null>(null);
  
  return (
    <div className="space-y-4">
      <h3>MIDI Controller</h3>
      
      {/* Device list */}
      <div>
        <Label>Connected Devices</Label>
        {devices.map(d => (
          <div key={d.id} className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-green-500" />
            {d.name}
          </div>
        ))}
      </div>
      
      {/* Mappings */}
      <div>
        <Label>Mappings</Label>
        <Table>
          <TableBody>
            {MIDI_ACTIONS.map(action => (
              <TableRow key={action}>
                <TableCell>{action}</TableCell>
                <TableCell>{getMappingDisplay(action)}</TableCell>
                <TableCell>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => startLearn(action)}
                  >
                    {learning === action ? 'Waiting...' : 'Learn'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      {/* Presets */}
      <div>
        <Label>Controller Preset</Label>
        <Select onValueChange={loadPreset}>
          <SelectItem value="custom">Custom</SelectItem>
          <SelectItem value="ddj-200">Pioneer DDJ-200</SelectItem>
          <SelectItem value="dj2go2">Numark DJ2GO2</SelectItem>
        </Select>
      </div>
    </div>
  );
}
```

---

## Mixcloud Integration

### API Research

Mixcloud ha un'API pubblica ma con limitazioni:
- **Widget embed:** Disponibile, audio controllabile
- **Streaming diretto:** Richiede OAuth + partnership per stream URL
- **Workaround:** Usare widget embed + postMessage per controllo

```typescript
// packages/mixcloud/src/index.ts

export function isMixcloudUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?mixcloud\.com\//.test(url);
}

export type MixcloudMetadata = {
  platform: 'mixcloud';
  itemType: 'show' | 'playlist';
  slug: string;
  title: string;
  artist: string;
  duration: number;
  artworkUrl: string;
  embedUrl: string;
};

export async function getMixcloudMetadata(url: string): Promise<MixcloudMetadata> {
  // Parse URL to get username/show-slug
  const match = url.match(/mixcloud\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) throw new Error('Invalid Mixcloud URL');
  
  const [, username, slug] = match;
  
  // Use oEmbed API (no auth required)
  const oembedUrl = `https://www.mixcloud.com/oembed/?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl);
  const data = await res.json();
  
  return {
    platform: 'mixcloud',
    itemType: 'show',
    slug: `${username}/${slug}`,
    title: data.title,
    artist: data.author_name,
    duration: 0, // Not in oEmbed, need separate API call
    artworkUrl: data.thumbnail_url,
    embedUrl: `https://www.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(`/${username}/${slug}/`)}`,
  };
}
```

### Mixcloud Widget Integration

Per il DJ mode, Mixcloud è più complesso perché:
1. Non espone stream URL diretto
2. Widget ha controlli limitati via postMessage

**Approccio:** Usare Mixcloud in "single player mode" (non DJ mixing), o come source di discovery.

---

## Piano di Implementazione Finale

### Phase 1: Core Audio Infrastructure (4-5h)
- [ ] `FileSource` - caricamento file locali
- [ ] `DeviceSource` - input scheda audio con selezione device
- [ ] `OutputRouter` - selezione output device (main + cue)
- [ ] Unit tests per nuovi source types

### Phase 2: CUE System (4-5h)
- [ ] `CueBus` class con dual AudioContext
- [ ] CUE send per ogni deck
- [ ] CUE/MIX blend control
- [ ] Split cue fallback (L=CUE, R=MIX)

### Phase 3: UI Components (3-4h)
- [ ] Device selector dialog
- [ ] File drop zone per deck
- [ ] CUE buttons + blend slider
- [ ] Settings page section per audio routing

### Phase 4: MIDI Controller (4-5h)
- [ ] `MidiController` class
- [ ] MIDI Learn mode
- [ ] Preset mappings per controller comuni
- [ ] MIDI settings UI

### Phase 5: Mixcloud Package (2-3h)
- [ ] Creare `packages/mixcloud`
- [ ] URL detection + metadata fetching
- [ ] Integration in radio app (single mode only)

### Phase 6: Polish & Testing (2-3h)
- [ ] Keyboard shortcuts
- [ ] Mobile-friendly adjustments
- [ ] Error handling + fallbacks
- [ ] Documentation

---

## Ordine di Esecuzione

```
Phase 1 (FileSource + DeviceSource + OutputRouter)
    ↓
Phase 2 (CUE System)
    ↓
Phase 3 (UI Components)
    ↓
Phase 4 (MIDI) ←── può essere parallelo
    ↓
Phase 5 (Mixcloud) ←── può essere parallelo
    ↓
Phase 6 (Polish)
```

**Effort totale stimato: 19-25 ore**

---

*RFC v2.0 - 2026-02-01*
*Decisioni: Skip YouTube, No Recording, Yes MIDI, Yes Mixcloud*
