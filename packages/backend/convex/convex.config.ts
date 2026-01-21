import migrations from "@convex-dev/migrations/convex.config";
import { defineApp } from "convex/server";
import instagram from "./components/instagram/convex.config";
import telegram from "./components/telegram/convex.config";

const app = defineApp();

// External components
app.use(migrations);

// Local components
app.use(instagram);
app.use(telegram);

export default app;
