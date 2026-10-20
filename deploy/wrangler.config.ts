import { defineWranglerConfig } from "wrangler/experimental-config";

/** Static files only — do not run the Wrangler CLI; `cf deploy` uses this. */
export default defineWranglerConfig({
  assetsDirectory: "../dist",
});
