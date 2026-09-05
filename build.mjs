import * as esbuild from "esbuild";

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["firefox109", "chrome109"],
  logLevel: "info",
};

await esbuild.build({
  ...shared,
  entryPoints: ["src/dashboard.js"],
  outfile: "dist/dashboard.js",
});

await esbuild.build({
  ...shared,
  entryPoints: ["src/background.js"],
  outfile: "dist/background.js",
});
