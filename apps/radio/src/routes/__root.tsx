import appleIcon from "@avoid.quest/ui/assets/favicon/apple-icon.png";
import favicon from "@avoid.quest/ui/assets/favicon/favicon.ico";
import icon0 from "@avoid.quest/ui/assets/favicon/icon0.svg";
import icon1 from "@avoid.quest/ui/assets/favicon/icon1.png";
import globalsCss from "@avoid.quest/ui/globals.css?url";
import { createRootRoute } from "@tanstack/react-router";
import { NotFoundView, RootErrorView } from "@/components/root/root-error-view";
import { RootShell } from "@/components/root/root-shell";

export const Route = createRootRoute({
  ssr: false,
  errorComponent: RootErrorView,
  headers: () => ({
    // Required for SharedArrayBuffer support in AudioWorklet
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
  }),
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "radio - avoid.quest",
      },
      {
        name: "description",
        content: "Enhanced internet radio",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "radio.avoid.quest",
      },
      {
        name: "mobile-web-app-capable",
        content: "yes",
      },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black",
      },
      {
        name: "application-name",
        content: "Radio - avoid.quest",
      },
      {
        name: "theme-color",
        content: "#000000",
      },
      {
        name: "msapplication-TileColor",
        content: "#000000",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: globalsCss,
        precedence: "default",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "icon",
        type: "image/x-icon",
        href: favicon,
      },
      {
        rel: "apple-touch-icon",
        href: appleIcon,
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: icon0,
      },
      {
        rel: "icon",
        type: "image/png",
        href: icon1,
      },
    ],
  }),

  shellComponent: RootShell,
  notFoundComponent: NotFoundView,
});
