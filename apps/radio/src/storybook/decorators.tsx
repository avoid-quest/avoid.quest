import { markChangelogSeen } from "@avoid.quest/ui/lib/changelog";
import type { Decorator } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { AppFrame } from "@/components/root/app-frame";
import {
  type SettingsRecord,
  settingsCollection,
} from "@/lib/collections/settings";
import { CHANGELOG_STORAGE_KEY } from "@/lib/const";
import { RADIO_CHANGELOG_NEWEST_DATE } from "./changelog.fixture";
import { FIXTURE_SETTINGS } from "./fixtures";

/*
 * Radio-only Storybook state. Shared theming comes from the catalog preview;
 * these apply only to the Radio stories that list them.
 */

/** A fresh, offline query cache per story, cleared when the story unmounts. */
export const withRadioQueryClient: Decorator = (Story) => (
  <StoryQueryClient>
    <Story />
  </StoryQueryClient>
);

function StoryQueryClient({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { networkMode: "offlineFirst", retry: false },
        },
      })
  );
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const StoryContent = createContext<ReactNode>(null);
function StoryRoute() {
  return use(StoryContent);
}

/**
 * A memory router with one root route rendering the story, for components
 * that use router links. The app's generated route tree is never mounted.
 */
export const withRadioRouter: Decorator = (Story) => (
  <StoryContent value={<Story />}>
    <StoryRouter />
  </StoryContent>
);

function StoryRouter() {
  const [router] = useState(() =>
    createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: createRootRoute({ component: StoryRoute }),
    })
  );
  return <RouterProvider router={router} />;
}

/**
 * Seeds the settings collection the header reads, and marks the fixture
 * changelog seen, then restores both after the story. Goes through the live
 * collection instance, which loaded once with the module.
 */
export async function seedRadioSettings(
  settings: SettingsRecord = FIXTURE_SETTINGS
): Promise<() => Promise<void>> {
  await settingsCollection.stateWhenReady();
  const previous = settingsCollection.state.get(settings.id);
  const previousRecord = previous ? structuredClone(previous) : undefined;
  const previousSeen = localStorage.getItem(CHANGELOG_STORAGE_KEY);

  await replaceSettings(settings.id, structuredClone(settings));
  markChangelogSeen(CHANGELOG_STORAGE_KEY, RADIO_CHANGELOG_NEWEST_DATE);

  return async () => {
    await replaceSettings(settings.id, previousRecord);
    if (previousSeen === null) {
      localStorage.removeItem(CHANGELOG_STORAGE_KEY);
    } else {
      localStorage.setItem(CHANGELOG_STORAGE_KEY, previousSeen);
    }
  };
}

async function replaceSettings(id: string, next: SettingsRecord | undefined) {
  if (settingsCollection.state.has(id)) {
    await settingsCollection.delete(id).isPersisted.promise;
  }
  if (next) {
    await settingsCollection.insert(next).isPersisted.promise;
  }
}

/** Renders the story as a page inside the app's real frame. */
export const withAppFrame: Decorator = (Story) => (
  <AppFrame>
    <Story />
  </AppFrame>
);
