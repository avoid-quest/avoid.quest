// biome-ignore lint/style/noExportedImports: dfasdf
import { mainMenu } from "./main-menu";
import { postDetailMenu, postsMenu } from "./posts-menu";
import {
  settingsLoggingMenu,
  settingsMenu,
  settingsScraperMenu,
  settingsTelegramMenu,
} from "./settings-menu";
import { userDeleteConfirmMenu, userDetailMenu, usersMenu } from "./users-menu";

// Register menu hierarchy - must happen before export
mainMenu.register(usersMenu);
mainMenu.register(postsMenu);
mainMenu.register(settingsMenu);

usersMenu.register(userDetailMenu);
usersMenu.register(userDeleteConfirmMenu);

postsMenu.register(postDetailMenu);

settingsMenu.register(settingsTelegramMenu);
settingsMenu.register(settingsScraperMenu);
settingsMenu.register(settingsLoggingMenu);

// Re-export all menus and update functions
// Export the registered mainMenu directly
export { mainMenu };
export { postsMenu, updatePostsMenuMessage } from "./posts-menu";
export {
  settingsLoggingMenu,
  settingsMenu,
  settingsScraperMenu,
  settingsTelegramMenu,
} from "./settings-menu";
export {
  updateUsersMenuMessage,
  userDeleteConfirmMenu,
  usersMenu,
} from "./users-menu";
