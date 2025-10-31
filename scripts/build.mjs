// scripts/build.mjs
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const MODE = process.argv[2] ?? "dev";        // dev | watch | prod | clean
const isProd = MODE === "prod";
const isWatch = MODE === "watch";

const outRoot = isProd ? "dist" : "build";            // static root (mirrors dev/prod)
const outJsDir = isProd ? path.join(outRoot, "build") : "build"; // compiled JS output

const logLevel = "info";
const sourcemap = !isProd;  // dev: true for debugging
const minify = isProd;

// Files at project root to copy into dist/ on prod
const STATIC_ROOT_FILES_PROD = [
    'manifest.json',
    'mui.skin.capture.css',
    'page_connector.js',
    'panel.html',
    'panel.js',
    'reminders.html',
    'sw.js',
  ];


// entriesESM — rename just these two keys
const entriesESM = {
    calendar: "src/calendar.tsx",
    pipeline: "src/pipeline.tsx",
    GoogleCalendarClient: "src/lib/gcal/GoogleCalendarClient.ts",
    CalendarStore: "src/lib/state/CalendarStore.ts",
    settings: "src/settings.tsx",
    reminders: "src/reminders_app.tsx",
    capture: "src/capture.tsx",
    capturedialog: "src/capturedialog.tsx",
    pipelinedrawer: "src/pipelinedrawer.tsx",
    workroommilestones: "src/workroommilestones.tsx",
    tiptapeditor: "src/tiptapeditor.tsx",
    aiclient: "src/aiclient.ts"
  };

function copyRootFilesProd(out) {
    for (const f of STATIC_ROOT_FILES_PROD) {
        const src = path.resolve(f);                 // from project root
        if (fs.existsSync(src)) {
        const dst = path.join(out, path.basename(f)); // into dist/
        copyFile(src, dst);
        }
    }
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function copyFile(src, dst) { ensureDir(path.dirname(dst)); fs.copyFileSync(src, dst); }
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(dst);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

async function buildAll() {
  if (MODE === "clean") { rmrf("dist"); rmrf("build"); return; }

  if (isProd) rmrf("dist"); else rmrf("build");
  ensureDir(outJsDir); // ensures outRoot exists too

  // ---- ESM bundles ----
  const esmOpts = {
    entryPoints: entriesESM,
    outdir: outJsDir,
    bundle: true,
    format: "esm",
    platform: "browser",
    sourcemap,
    minify,
    logLevel,
    jsx: "automatic",
    jsxImportSource: "react",
    entryNames: "[name].bundle"
  };

  // ---- IIFE content script (root of build/dist) ----
  const iifeOpts = {
    entryPoints: { content: "src/content.ts" },
    outfile: path.join(outRoot, "content.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    sourcemap,
    minify,
    logLevel
  };

  if (isWatch) {
    const esmCtx = await esbuild.context(esmOpts);
    const iifeCtx = await esbuild.context(iifeOpts);
    await esmCtx.watch();
    await iifeCtx.watch();
  } else {
    await Promise.all([esbuild.build(esmOpts), esbuild.build(iifeOpts)]);
  }

  // ---- Static copy rules ----
  if (isProd) {
    // copy the *entire* public directory into dist/public
    const src = "public";
    const dst = path.join(outRoot, "public");
    copyRootFilesProd(outRoot);
    if (!fs.existsSync(src)) {
      console.warn(`[build] public folder not found at ${path.resolve(src)} (skipping)`);
    } else {
      copyDir(src, dst);
      console.log(`[build] copied public → ${path.resolve(dst)}`);
    }
  }
  // dev: copy nothing from public

  if (!isWatch) {
    console.log(`Done: ${MODE} → static @ ${path.resolve(outRoot)}, compiled @ ${path.resolve(outJsDir)}`);
  }
}

buildAll().catch(e => { console.error(e); process.exit(1); });
