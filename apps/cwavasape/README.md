# cwavasape

Pinterest visual gallery with AI effects and GPU shaders.

## Features

- **Virtual Gallery**: Infinite scrolling Pinterest board viewer
- **AI Segmentation**: Real-time image segmentation with Transformers.js
- **GPU Effects**: WebGL shader effects (blur, edge detection, region painting)
- **Effect Pipeline**: Composable effect chains with scroll-based parameters
- **Settings Panel**: Quality, scroll sensitivity, effect configuration
- **Local Storage**: Persistent settings with TanStack DB

## Tech Stack

- TanStack Start (file-based routing)
- TanStack Router, React Query, DB
- Transformers.js (AI/ML in browser)
- WebGL (GPU shader effects)
- React 19, TypeScript, Vite
- Tailwind CSS v4
- Cloudflare Workers (deploy)

## Routes

- `/` - Main gallery view with effects
- `/api/pinterest` - Pinterest board data proxy
- `/api/image-proxy` - Image proxy for CORS

## Features Detail

### AI Analysis
- Background/foreground segmentation
- Face detection
- Depth estimation
- Real-time processing via Web Worker

### GPU Effects
- Gaussian blur with configurable radius
- Sobel edge detection
- Region-based color painting
- Scroll-reactive intensity

## Environment Variables

```bash
# Pinterest username to display
VITE_PINTEREST_USERNAME=your_username
```

## Development

```bash
# From monorepo root
bun run dev --filter=@avoid.quest/cwavasape
```

## Connections

- **@avoid.quest/pinterest**: Pinterest board/pin data extraction
- **@avoid.quest/ui**: Shared components (sliders, selects, tabs)
