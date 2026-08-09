import type { SearchPlatform } from "@avoid.quest/platforms";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ExternalSearch } from "@/components/radio/dj/external-search";

type ExternalSearchTestWindow = Window & {
  __externalSearchReady: boolean;
  __setExternalSearchPlatform: (platform: SearchPlatform) => void;
};

const container = document.querySelector("#root");
if (!(container instanceof HTMLElement)) {
  throw new Error("Testbed root is missing");
}

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: { retry: false },
  },
});
const root = createRoot(container);
const testWindow = window as ExternalSearchTestWindow;

function render(platform: SearchPlatform) {
  root.render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ExternalSearch, {
        initialPlatform: platform,
        onLoad: () => undefined,
      })
    )
  );
}

testWindow.__externalSearchReady = true;
testWindow.__setExternalSearchPlatform = render;
render("bandcamp");
