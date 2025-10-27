# Modern Monorepo Template

A production-ready monorepo template built with modern web technologies, featuring Next.js, TypeScript, Tailwind CSS, and optimized for Cloudflare deployment.

## 🚀 Features

### **Core Technologies**

- **Next.js 16** with App Router and React 19
- **TypeScript** with strict configuration
- **Tailwind CSS v4** with modern CSS features
- **Bun** as the package manager and runtime
- **Turbo** for monorepo build orchestration

### **UI & Styling**

- **shadcn/ui** components with Radix UI primitives
- **Lucide React** icons
- **next-themes** for dark/light mode support
- **Sonner** for toast notifications
- **tw-animate-css** for animations
- Modern CSS with OKLCH color space

### **Development Experience**

- **Biome** for linting and formatting (via Ultracite)
- **Ultracite** for code formatting
- **TypeScript** strict mode with comprehensive type checking
- **Hot reload** with Turbo mode
- **Path aliases** for clean imports

### **Deployment & Infrastructure**

- **Cloudflare Pages** deployment ready
- **Alchemy** for infrastructure management
- **OpenNext** for Cloudflare optimization
- **PWA** support with web app manifest
- **Favicon** generation and management

### **Monorepo Architecture**

- **Workspace-based** package management
- **Shared TypeScript** configurations
- **Shared UI components** package
- **Independent app** deployments
- **Centralized** dependency management

## 📁 Project Structure

```
├── apps/
│   └── web/                    # Next.js web application
│       ├── src/
│       │   ├── app/           # App Router pages
│       │   ├── components/    # App-specific components
│       │   └── hooks/         # Custom hooks
│       ├── public/            # Static assets
│       └── alchemy.run.ts     # Deployment configuration
├── packages/
│   ├── ui/                    # Shared UI components
│   │   ├── src/
│   │   │   ├── components/    # Reusable components
│   │   │   ├── hooks/        # Shared hooks
│   │   │   └── styles/       # Global styles
│   │   └── components.json    # shadcn/ui configuration
│   └── typescript-config/     # Shared TS configurations
│       ├── base.json         # Base TS config
│       ├── nextjs.json       # Next.js TS config
│       └── react-library.json # React library TS config
├── turbo.json                 # Turbo build configuration
├── biome.json                 # Biome linting/formatting config
└── bunfig.toml               # Bun configuration
```

## 🛠️ Getting Started

### Prerequisites

- **Bun** 1.3.1+ ([Install Bun](https://bun.sh/docs/installation))
- **Node.js** 18+ (for compatibility)

### Installation

1. **Clone and setup:**

```bash
git clone <your-repo-url>
cd avoid.quest
bun install
```

2. **Start development:**

```bash
bun run dev
```

3. **Open your browser:**
   - Web app: http://localhost:3000

### Available Scripts

| Command           | Description                                |
| ----------------- | ------------------------------------------ |
| `bun run dev`     | Start all apps in development mode         |
| `bun run dev:web` | Start only the web app                     |
| `bun run build`   | Build all packages and apps                |
| `bun run check`   | Run linting and type checking              |
| `bun run fix`     | Auto-fix linting issues                    |
| `bun run ui`      | Open shadcn/ui component CLI               |
| `bun run cleanup` | Clean all build artifacts and dependencies |

## 🎨 UI Components

This template includes a comprehensive UI system:

### **Component Library**

- Built with **shadcn/ui** and **Radix UI**
- **Class Variance Authority** for variant management
- **Tailwind CSS** for styling
- **TypeScript** with full type safety

### **Available Components**

- `Button` - Multiple variants (default, destructive, outline, secondary, ghost, link)
- More components can be added via `bun run ui`

### **Adding New Components**

```bash
# Add shadcn/ui components
bun run ui add button
bun run ui add card
bun run ui add input
```

## 🌙 Theme System

- **Dark/Light mode** support with `next-themes`
- **System preference** detection
- **OKLCH color space** for better color consistency
- **CSS custom properties** for theming
- **Smooth transitions** between themes

## 🚀 Deployment

### **Cloudflare Pages**

1. **Deploy with Alchemy:**

```bash
cd apps/web
bun run deploy
```

2. **Manual deployment:**

```bash
bun run build
# Deploy the .next folder to Cloudflare Pages
```

### **Environment Variables**

Create `.env` files as needed:

```bash
# apps/web/.env
NEXT_PUBLIC_APP_URL=https://your-app.pages.dev
```

## 🔧 Configuration

### **TypeScript**

- **Strict mode** enabled
- **Path mapping** for clean imports
- **Shared configurations** across packages
- **Type checking** in CI/CD

### **Linting & Formatting**

- **Biome** for fast linting and formatting
- **Ultracite** for AI-ready code formatting
- **Consistent** code style across the monorepo
- **Auto-fix** capabilities

### **Build System**

- **Turbo** for efficient builds
- **Incremental** builds with caching
- **Parallel** task execution
- **Dependency-aware** builds

## 📦 Package Management

### **Workspace Structure**

- **Root workspace** manages all dependencies
- **Package-specific** dependencies in each package
- **Shared dependencies** hoisted to root
- **Peer dependencies** properly configured

### **Adding Dependencies**

```bash
# Add to root (shared)
bun add <package>

# Add to specific package
bun add <package> --filter @workspace/ui
bun add <package> --filter web
```

## 🎯 Best Practices

### **Code Organization**

- **Feature-based** folder structure
- **Shared components** in `@workspace/ui`
- **App-specific** logic in respective apps
- **Type definitions** centralized

### **Import Aliases**

```typescript
// Use workspace aliases
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";

// Use app aliases
import { MyComponent } from "@/components/my-component";
```

### **Component Development**

- **TypeScript** for all components
- **Proper prop types** with VariantProps
- **Accessibility** considerations
- **Responsive design** with Tailwind

## 🔍 Troubleshooting

### **Common Issues**

1. **Build failures:**

```bash
bun run cleanup
bun install
bun run build
```

2. **Type errors:**

```bash
bun run check-types
```

3. **Linting issues:**

```bash
bun run fix
```

### **Performance**

- **Turbo** caching for faster builds
- **Incremental** TypeScript compilation
- **Tree shaking** for smaller bundles
- **Code splitting** with Next.js

## 📚 Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Turbo Documentation](https://turbo.build/repo/docs)
- [Bun Documentation](https://bun.sh/docs)
- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `bun run check` to ensure quality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**Happy coding! 🎉**
