const port = Number(process.env.PORT ?? 4317);

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("index.html"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/main.js") {
      const result = await Bun.build({
        entrypoints: ["./src/main.ts"],
        target: "browser",
        format: "esm",
      });
      if (!result.success) {
        const logs = result.logs.map((log) => log.message).join("\n");
        return new Response(logs, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      const output = result.outputs[0];
      if (!output) return new Response("Build produced no output", { status: 500 });
      return new Response(await output.text(), {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Kiln at ${server.url}`);
