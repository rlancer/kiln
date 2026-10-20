export {};

const result = await Bun.build({
  entrypoints: ["./src/main.ts"],
  outdir: "./dist",
  target: "browser",
  format: "esm",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log.message);
  process.exit(1);
}

const output = result.outputs.find((file) => file.path.endsWith("main.js"));
if (!output) {
  console.error("Build produced no main.js");
  process.exit(1);
}

await Bun.write("dist/index.html", Bun.file("index.html"));
await Bun.write("dist/music/hearth.wav", Bun.file("public/music/hearth.wav"));
await Bun.write("dist/music/chamber.wav", Bun.file("public/music/chamber.wav"));
console.log(`Built ${output.path}`);
