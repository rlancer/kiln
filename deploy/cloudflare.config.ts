import { defineConfig } from "cf/config";

const accountId = "3315bb3e7d2e3556bfea6fb3947a890e";

export default defineConfig(({ mode }) => {
  const staging = mode === "staging";

  return {
    accountId,
    worker: {
      name: staging ? "kiln-staging" : "kiln",
      compatibilityDate: "2026-10-19",
      observability: { enabled: true },
      workersDev: true,
      assets: {
        htmlHandling: "auto-trailing-slash",
      },
      domains: staging
        ? ["staging.kiln.robertlancer.com"]
        : ["kiln.robertlancer.com"],
    },
  };
});
