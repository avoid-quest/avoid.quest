---
"radio": minor
---

## Unified Audio Effects System

Added a comprehensive, unified audio effects system for the DJ player with support for multiple effect types, drag-and-drop reordering, and real-time parameter control.

### New Features

- **Effect Chain Management**: Added `EffectManager` class to manage audio effect chains with proper routing and bypass functionality
- **Six Effect Types**:
  - **Biquad Filter**: 8 filter types (lowpass, highpass, bandpass, lowshelf, highshelf, peaking, notch, allpass) with frequency, Q, and gain controls
  - **Reverb**: Convolution reverb with room size, decay time, and wet/dry mix controls
  - **Delay**: Echo/delay effect with delay time, feedback loop, and wet/dry mix
  - **Distortion**: Wave shaper distortion with amount and oversample controls
  - **Compressor**: Dynamic range compressor with threshold, ratio, attack, release, and knee controls
  - **Stereo Panner**: Stereo panning control with -1 to +1 range

### UI Components

- **EffectChain**: Main component for displaying and managing effect chains with drag-and-drop reordering
- **EffectItem**: Individual effect card with enable/disable toggle, expandable parameters, and remove button
- **EffectParams**: Type-specific parameter controls with real-time sliders and value displays
- **EffectPicker**: Searchable dialog for selecting and adding new effects to the chain

### Technical Improvements

- **True Bypass**: Disabled effects are completely removed from the audio chain, ensuring zero processing overhead
- **Wet/Dry Routing**: Proper signal routing for reverb and delay effects with separate wet and dry paths
- **Feedback Loops**: Delay effects support feedback loops for echo effects
- **Drag-and-Drop Reordering**: Effects can be reordered via drag-and-drop, automatically updating the processing chain
- **Real-time Updates**: All parameter changes are applied immediately with smooth audio transitions
- **Effect Registry**: Centralized effect metadata system with default configurations and parameter ranges

### Integration

- Integrated with `AudioManager` for seamless audio processing
- Added effect management hooks in `use-dj-audio` for state synchronization
- Replaced legacy filter/reverb tabs with unified "Effects" tab in DJ mixer
- Maintains backward compatibility with legacy filter and reverb systems

### Code Quality

- Fixed all lint issues in the audio folder
- Refactored complex methods to reduce cyclomatic complexity
- Added comprehensive TypeScript types for all effect configurations
- Improved error handling and cleanup for audio nodes
