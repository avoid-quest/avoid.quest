import migrations from "@convex-dev/migrations/convex.config";
import { defineApp } from "convex/server";
import instarip from "./components/instarip/convex.config";
import telegram from "./components/telegram/convex.config";

const app = defineApp();

// External components
app.use(migrations);

// Local components
app.use(instarip);
app.use(telegram);

export default app;
