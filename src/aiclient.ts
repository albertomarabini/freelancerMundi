// aiClient.ts — On-device ONLY (Chrome Built-in AI / WebMachineLearning APIs)
// Phase 1 (constructor): availability checks only (no downloads)
// Phase 2 (beginDownloadsNow(): call on user gesture): fire create() immediately (gesture-safe)
// then await completion via waitForDownloads()

import './utils/stickyStatus';

// --- Ambient declarations for stickyStatus helpers (if the module adds globals) ---
declare function setStickyStatus(text: string, ms?: number): void;
declare function showBackdrop(text?: string): void;
declare function hideBackdrop(): void;
declare function askPrompt(
  message: string,
  cb: (action: 'ok' | 'cancel') => void,
  okText?: string,
  cancelText?: string
): void;
declare function hidePrompt(): void;

// ---- Types ----
export type WriterTone = "formal" | "neutral" | "casual";
export type RewriterTone = "more-formal" | "as-is" | "more-casual";
export type LangCode = "en" | "de" | "fr" | "es" | "it" | "en-US" | "de-DE" | "fr-FR" | "es-ES" | "it-IT";
type AIAvailability = "available" | "unavailable" | "downloadable" | "downloading" | "unknown";

function mapWriterTone(x: unknown, fallback: WriterTone = "neutral"): WriterTone {
  const v = String(x || "").toLowerCase();
  if (v === "formal" || v === "neutral" || v === "casual") return v as WriterTone;
  // Legacy mapping from old Tone
  if (v === "concise") return "neutral";
  if (v === "warm") return "casual";
  if (v === "formal") return "formal";
  return fallback;
}

function mapRewriterTone(x: unknown, fallback: RewriterTone = "as-is"): RewriterTone {
  const v = String(x || "").toLowerCase();
  if (v === "more-formal" || v === "as-is" || v === "more-casual") return v as RewriterTone;
  // Legacy mapping from old Tone
  if (v === "concise") return "as-is";
  if (v === "warm") return "more-casual";
  if (v === "formal") return "more-formal";
  return fallback;
}

function toBaseLang(tag: string): string { return tag.split("-")[0].toLowerCase(); }

// Parse supported langs hint from Summarizer error text (Chrome may include them)
function parseSupportedLangsFromErrorMessage(msg: string): string[] | null {
  const m = msg && msg.match(/\[\s*([a-zA-Z0-9\-\s,]+)\s*\]/);
  if (!m) return null;
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}

type PromptSession = {
  prompt(q: string, opts?: { responseConstraint?: any }): Promise<string>;
  promptStreaming?(q: string, opts?: { responseConstraint?: any }): AsyncIterable<string>;
};

// ---- Ambient (Web APIs) ----
declare global {
  interface Window {
    LanguageModel?: { availability(): Promise<"available" | "unavailable">; create(): Promise<PromptSession>; };
    Summarizer?: {
      availability?(opts?: any): Promise<"available" | "unavailable" | "downloadable" | "downloading">;
      create(opts?: {
        sharedContext?: string;
        type?: "headline" | "tl-dr" | "key-points" | "teaser" | "custom";
        length?: "short" | "medium" | "long";
        format?: "plain-text" | "markdown" | "bullets";
        expectedInputLanguages?: string[];
        outputLanguage?: string;
        signal?: AbortSignal;
      }): Promise<{ summarize(text: string, opts?: { context?: string }): Promise<string>; destroy?(): void; }>;
    };
    Writer?: {
      availability?(): Promise<"available" | "unavailable" | "downloadable" | "downloading">;
      create(opts?: { tone?: string; sharedContext?: string }):
        Promise<{ write(task: string, opts?: { context?: string }): Promise<string>; destroy?(): void; }>;
    };
    Rewriter?: {
      availability?(): Promise<"available" | "unavailable" | "downloadable" | "downloading">;
      create(opts?: { sharedContext?: string; tone?: string }):
        Promise<{ rewrite(text: string, opts?: { context?: string }): Promise<string>; destroy?(): void; }>;
    };
    Proofreader?: {
      availability?(): Promise<"available" | "unavailable" | "downloadable" | "downloading">;
      create(opts?: { includeCorrectionTypes?: boolean; includeCorrectionExplanations?: boolean; }):
        Promise<{ proofread(text: string): Promise<string | { correctedText: string }>; destroy?(): void; }>;
    };
        LanguageDetector?: {
      availability?(opts?: any): Promise<"available" | "unavailable" | "downloadable" | "downloading">;
      create(opts?: { expectedInputLanguages?: string[]; monitor?: (m: any) => void; signal?: AbortSignal; }):
        Promise<{ detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>; destroy?(): void; }>;
    };
    Translator?: {
      availability(opts: { sourceLanguage: string; targetLanguage: string; }): Promise<"available" | "unavailable" | "downloadable" | "downloading">;
      create(opts: { sourceLanguage: string; targetLanguage: string; monitor?: (m: any) => void; signal?: AbortSignal; }):
        Promise<{ translate(text: string): Promise<string>; inputQuota?: number; measureInputUsage?(t: string): Promise<number>; destroy?(): void; }>;
    };
  }
}

// ---- Options ----
export interface AIClientOptions {
  preloadTargets?: Array<LangCode | string>;     // translators to preload (source="auto")
  defaultWriterTone?: WriterTone;
  defaultRewriterTone?: RewriterTone;
  writerSharedContext?: string;
  rewriterSharedContext?: string;
  summarizerSharedContext?: string;
  summarizerLanguages?: string[];                // preferred summarizer languages; will auto-downgrade if unsupported
}

// ---- Class ----
export class AIClient {
  // Phase signals
  public needsUserAction = false;                 // true if some components must be downloaded via user gesture
  public missing: { summarizer?: string; translators?: string[]; detector?: string; writer?: string; rewriter?: string; proofreader?: string } = {};
  public readonly ready: Promise<void>;           // resolves after availability checks; call ensureReadyWithPrompt() to handle downloads

  // Cached instances
  private static _promptSession: PromptSession | null = null;
  private summarizer: { summarize(text: string, opts?: { context?: string }): Promise<string>; destroy?(): void } | null = null;
  private proofreader: { proofread(text: string): Promise<string | { correctedText: string }>; destroy?(): void } | null = null;
  private writer: { write(task: string, opts?: { context?: string }): Promise<string>; destroy?(): void } | null = null;
  private rewriter: { rewrite(text: string, opts?: { context?: string }): Promise<string>; destroy?(): void } | null = null;
  private detector: { detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>; destroy?(): void } | null = null;
  private summarizerLangsFinal: string[] = ["en"];
  private translators: Map<string, { translate(text: string): Promise<string>; inputQuota?: number; measureInputUsage?(t: string): Promise<number>; destroy?(): void }> = new Map();

  private sourceLangBase = "en";

  // Internal state for downloads
  private toDownload = {
    summarizer: false,
    detector: false,
    translators: new Set<string>(),
    writer: false,
    rewriter: false,
    proofreader: false,
  };
  private _dlPlan: Array<{ label: string; run: () => Promise<void> }> = [];
  private _dlIdx = 0;
  private _dlDeferred?: any;


  // Promise representing the combined downloads kicked off under a user gesture
  private _downloadsPromise: Promise<void> | null = null;

  // ---- Status → sticky badge ----
  private status(msg: string, autoHideMs = 1600) {
    try { setStickyStatus(msg, autoHideMs); } catch { /* no-op */ }
    try { console.log(msg); } catch { /* no-op */ }
  }

  public constructor(private opts: AIClientOptions = {}) {
    try {
      const ui = (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function")
        ? chrome.i18n.getUILanguage()
        : (navigator.language || "en");
      this.sourceLangBase = toBaseLang(ui);
    } catch {
      this.sourceLangBase = "en";
    }
    // defaults
    if (!this.opts.preloadTargets) this.opts.preloadTargets = ["en", "de", "fr", "es", "it"];
    if (!this.opts.defaultWriterTone) this.opts.defaultWriterTone = "neutral";
    if (!this.opts.defaultRewriterTone) this.opts.defaultRewriterTone = "as-is";
    if (!this.opts.summarizerLanguages || this.opts.summarizerLanguages.length == 0) this.opts.summarizerLanguages = [this.sourceLangBase];

    // Phase 1: availability checks only (no create() that would need a gesture)
    this.ready = this.phase1_checkAvailability();
    // run post-phase1 effects after availability has been gathered
    this.ready.then(() => this.postPhase1()).catch((e) => { try { console.log(e); } catch {}; });
  }


  // ---------------- PHASE 1: availability checks  ----------------
  private async phase1_checkAvailability(): Promise<void> {
    this.status("AI: checking availability…");

    // Prompt API
    if (!window.LanguageModel) throw new Error("Prompt API unavailable in this context.");
    const lm = await window.LanguageModel.availability();
    if (lm === "unavailable") throw new Error("Local model unavailable.");
    AIClient._promptSession = AIClient._promptSession || await window.LanguageModel.create();
    this.status("AI: Prompt API OK.");

    // Summarizer availability
    const desiredSummLangs = Array.isArray(this.opts.summarizerLanguages) && this.opts.summarizerLanguages.length
      ? this.opts.summarizerLanguages.slice()
      : ["en"];

    let summarizerAvail: AIAvailability = "unknown";
    if (window.Summarizer?.availability) {
      try {
        summarizerAvail = await window.Summarizer.availability({
          sharedContext: this.opts.summarizerSharedContext,
          type: "headline",
          length: "short",
          format: "plain-text",
          expectedInputLanguages: desiredSummLangs,
          outputLanguage: desiredSummLangs.includes("en") ? "en" : desiredSummLangs[0],
        });
      } catch { summarizerAvail = "unknown"; }
    }
    if (summarizerAvail === "available") {
      this.status("AI: Summarizer available.");
    } else {
      this.needsUserAction = true;
      if(summarizerAvail && summarizerAvail !== "unavailable") this.toDownload.summarizer = true;
      this.missing.summarizer = summarizerAvail || "unknown";
      this.status(`AI: Summarizer needs user action (${summarizerAvail}).`);
    }

    // Detector availability
    let detectorAvail: AIAvailability = "unknown";
    if (window.LanguageDetector?.availability) {
      try { detectorAvail = await window.LanguageDetector.availability({ expectedInputLanguages: desiredSummLangs }); }
      catch { detectorAvail = "unknown"; }
    }
    if (detectorAvail === "available") {
      this.status("AI: Language Detector available.");
    } else {
      this.needsUserAction = true;
      if(detectorAvail && detectorAvail !== "unavailable") this.toDownload.detector = true;
      this.missing.detector = detectorAvail || "unknown";
      this.status(`AI: Language Detector needs user action (${detectorAvail}).`);
    }

    // Writer availability
    let writerAvail: AIAvailability = "unknown";
    if (window.Writer?.availability) {
      try { writerAvail = await window.Writer.availability(); } catch { writerAvail = "unknown"; }
    }
    if (writerAvail === "available") {
      this.status("AI: Writer available.");
    } else {
      this.needsUserAction = true;
      if(writerAvail && writerAvail !== "unavailable") this.toDownload.writer = true;
      this.missing.writer = writerAvail || "unknown";
      this.status(`AI: Writer needs user action (${writerAvail}).`);
    }

    // Rewriter availability
    let rewriterAvail: AIAvailability = "unknown";
    if (window.Rewriter?.availability) {
      try { rewriterAvail = await window.Rewriter.availability(); } catch { rewriterAvail = "unknown"; }
    }
    if (rewriterAvail === "available") {
      this.status("AI: Rewriter available.");
    } else {
      this.needsUserAction = true;
      if(rewriterAvail && rewriterAvail !== "unavailable") this.toDownload.rewriter = true;
      this.missing.rewriter = rewriterAvail || "unknown";
      this.status(`AI: Rewriter needs user action (${rewriterAvail}).`);
    }

    // Proofreader availability
    let proofreaderAvail: AIAvailability = "unknown";
    if (window.Proofreader?.availability) {
      try { proofreaderAvail = await window.Proofreader.availability(); } catch { proofreaderAvail = "unknown"; }
    }
    if (proofreaderAvail === "available") {
      this.status("AI: Proofreader available.");
    } else {
      this.needsUserAction = true;
      if(proofreaderAvail && proofreaderAvail !== "unavailable") this.toDownload.proofreader = true;
      this.missing.proofreader = proofreaderAvail || "unknown";
      this.status(`AI: Proofreader needs user action (${proofreaderAvail}).`);
    }


    // Translators availability for preload targets
    if (window.Translator) {
      const targets = (this.opts.preloadTargets || []).map(t => toBaseLang(String(t)));
      const needs: string[] = [];
      for (const tgt of targets) {
        try {
          if (tgt === this.sourceLangBase) {
            this.status(`AI: Translator[${this.sourceLangBase}→${tgt}] skipped (same language).`);
            continue;
          }
          const avail = await window.Translator.availability({ sourceLanguage: this.sourceLangBase, targetLanguage: tgt });
          if (avail === "available") {
            this.status(`AI: Translator[auto→${tgt}] available.`);
          } else if (avail === "downloadable" || avail === "downloading") {
            this.toDownload.translators.add(tgt);
            needs.push(tgt);
            this.needsUserAction = true;
          } else if (avail === "unavailable") {
            this.status(`AI: Translator[auto→${tgt}] unavailable (skipping).`);
          }
        } catch {
          this.toDownload.translators.add(tgt);
          needs.push(tgt);
          this.needsUserAction = true;
        }
      }
      if (needs.length) {
        this.missing.translators = needs;
        this.status(`AI: Translators require user action for → [${needs.join(", ")}].`);
      }
    }
  }

  // ---------------- PHASE 2A: warm-up when no download is needed ----------------
  private async phase2_warmUpWithoutDownloads(): Promise<void> {
    await this.initSummarizer_withRetries();
    await this.initProofreader_noGesture();
    await this.initWriter_noGesture();
    await this.initRewriter_noGesture();
    await this.initLanguageDetector_noGesture();
    await this.preloadTranslators_createReady();
  }

  // ---------------- PHASE 2B: BEGIN DOWNLOADS (call from user gesture) ----------------
  private prepareDownloadPlan(): void {
    this._dlPlan = [];
    this._dlIdx = 0;

    const langs = (this.opts.summarizerLanguages as string[] | undefined) || ["en"];
    if (this.toDownload.summarizer)  this._dlPlan.push({ label: "Summarizer",          run: () => this.createSummarizerCore(langs) });
    if (this.toDownload.detector)    this._dlPlan.push({ label: "Language Detector",   run: () => this.createLanguageDetectorCore(true) });
    if (this.toDownload.writer)      this._dlPlan.push({ label: "Writer",              run: () => this.createWriterCore() });
    if (this.toDownload.rewriter)    this._dlPlan.push({ label: "Rewriter",            run: () => this.createRewriterCore() });
    if (this.toDownload.proofreader) this._dlPlan.push({ label: "Proofreader",         run: () => this.createProofreaderCore() });
    for (const tgt of this.toDownload.translators) {
      this._dlPlan.push({ label: `Translator:${this.sourceLangBase}→${tgt}`, run: () => this.createTranslatorCore(this.sourceLangBase, tgt) });
    }
  }

  private postPhase1(): void {
    if (this.needsUserAction) {
      this.prepareDownloadPlan();
      this.ensureReadyWithPrompt();
    } else {
      this.phase2_warmUpWithoutDownloads()
        .then(() => this.status("AI: warm-up complete (no downloads needed)."))
        .catch((e) => { try { console.log(e); } catch {}; this.status("AI: warm-up failed."); });
    }
  }

  // ---------------- Public helper to ensure user gesture ----------------
  public async ensureReadyWithPrompt(): Promise<void> {
    askPrompt("Local AI models are required. Download now?", (action) => {
      if (action !== "ok") { this.status("AI: setup canceled."); return; }
      this.showNextDownloadPrompt();
      return true;
    }, "Download & enable", "Cancel");
  }

  private showNextDownloadPrompt(): void {
    if (this._dlIdx >= this._dlPlan.length) {
      this.needsUserAction = false;
      this.missing = {};
      this.toDownload.translators.clear();
      this.status("AI: downloads complete.");
      hideBackdrop();
      hidePrompt();
      this._dlDeferred = undefined;
      return;
    }

    const { label, run } = this._dlPlan[this._dlIdx];
    this._dlDeferred = run;
    askPrompt(`Authorize download for ${label}?`, (action) => {
      if (action !== "ok") {
        this.status(`AI: ${label} skipped by user.`);
        this._dlIdx++;
        // immediately ask for the next step; next click will advance
        this.showNextDownloadPrompt();
        return;
      }
      setTimeout(()=>{showBackdrop("")},0);
      this._dlDeferred();
      hideBackdrop()
      this._dlDeferred = undefined;
      this._dlIdx++;
      setTimeout(()=>{this.showNextDownloadPrompt();}, 0);
      return true;
    }, "OK", "Cancel");
  }

  /** Await this after calling beginDownloadsNow() if you want to wait for completion. */
  public async waitForDownloads(): Promise<void> {
    if (this._downloadsPromise) await this._downloadsPromise;
  }

  // ---------- Prompt ----------
  private async ensurePrompt(): Promise<PromptSession> {
    if (AIClient._promptSession) return AIClient._promptSession;
    if (!window.LanguageModel) throw new Error("Prompt API unavailable in this context.");
    const avail = await window.LanguageModel.availability();
    if (avail === "unavailable") throw new Error("Local model unavailable.");
    AIClient._promptSession = await window.LanguageModel.create();
    return AIClient._promptSession;
  }
  public async promptRaw(q: string): Promise<string> { const s = await this.ensurePrompt(); return s.prompt(q); }
  public async promptStructured(input: { text?: string; schema: any; instructions?: string }): Promise<any> {
    const s = await this.ensurePrompt();
    const prompt = (input.instructions ? input.instructions + "\n\n" : "") + (input.text || "");
    const raw = await s.prompt(prompt, { responseConstraint: input.schema });
    try { return JSON.parse(raw); } catch { return raw; }
  }

  // ---------- Summarizer (single core + wrappers) ----------
  private async createSummarizerCore(desired?: string[]): Promise<void> {
    if (!window.Summarizer) throw new Error("Summarizer API not available");

    const wanted = Array.isArray(desired) && desired.length
      ? desired.slice()
      : (Array.isArray(this.opts.summarizerLanguages) && this.opts.summarizerLanguages.length
          ? this.opts.summarizerLanguages.slice()
          : ["en"]);

    const tryCreate = async (languageList: string[]) => {
      const inst = await window.Summarizer!.create({
        sharedContext: this.opts.summarizerSharedContext,
        type: "headline",
        length: "short",
        format: "plain-text",
        expectedInputLanguages: languageList,
        outputLanguage: languageList.includes("en") ? "en" : languageList[0],
      });
      this.summarizer = inst;
      this.summarizerLangsFinal = languageList.slice();
      this.status(`AI: Summarizer ready (langs=[${this.summarizerLangsFinal.join(", ")}]).`);
    };

    try {
      await tryCreate(wanted);
    } catch (err: any) {
      const msg = String(err?.message || err);
      const supported = parseSupportedLangsFromErrorMessage(msg);
      if (supported?.length) {
        this.status(`AI: Summarizer retry with supported langs: [${supported.join(", ")}]`);
        try { await tryCreate(supported); return; } catch {}
      }
      this.status("AI: Summarizer fallback to ['en'].");
      await tryCreate(["en"]);
    }
  }

  private startSummarizerGesture(desiredLangs: string[]): Promise<void> {
    return this.runWithGesture("Summarizer", () => this.createSummarizerCore(desiredLangs));
  }

  private async initSummarizer_withRetries(): Promise<void> {
    await this.createSummarizerCore(this.opts.summarizerLanguages);
  }

  // ---------- Writer / Rewriter / Proofreader (no download gating typically) ----------
  private async initProofreader(): Promise<void> {
    if (!window.Proofreader) return;
    this.proofreader = await window.Proofreader.create({
      includeCorrectionTypes: true,
      includeCorrectionExplanations: true,
    });
  }
  private async initWriter(): Promise<void> {
    if (!window.Writer) return;
    this.writer = await window.Writer.create({
      tone: mapWriterTone(this.opts.defaultWriterTone, "neutral"),
      sharedContext: this.opts.writerSharedContext,
    });
  }
  private async initRewriter(): Promise<void> {
    if (!window.Rewriter) return;
    this.rewriter = await window.Rewriter.create({
      tone: mapRewriterTone(this.opts.defaultRewriterTone, "as-is"),
      sharedContext: this.opts.rewriterSharedContext || "",
    });
  }
  // ---- Writer
  private async createWriterCore(): Promise<void> {
    if (!window.Writer) throw new Error("Writer API not available");
    const inst = await window.Writer.create({
      tone: mapWriterTone(this.opts.defaultWriterTone, "neutral"),
      sharedContext: this.opts.writerSharedContext,
    });
    this.writer = inst;
    this.status("AI: Writer ready.");
  }
  private startWriterGesture(): Promise<void> {
    return this.runWithGesture("Writer", () => this.createWriterCore());
  }
  private initWriter_noGesture(): Promise<void> {
    return this.createWriterCore();
  }

  // ---- Rewriter
  private async createRewriterCore(): Promise<void> {
    if (!window.Rewriter) throw new Error("Rewriter API not available");
    const inst = await window.Rewriter.create({
      tone: mapRewriterTone(this.opts.defaultRewriterTone, "as-is"),
      sharedContext: this.opts.rewriterSharedContext || "",
    });
    this.rewriter = inst;
    this.status("AI: Rewriter ready.");
  }
  private startRewriterGesture(): Promise<void> {
    return this.runWithGesture("Rewriter", () => this.createRewriterCore());
  }
  private initRewriter_noGesture(): Promise<void> {
    return this.createRewriterCore();
  }

  // ---- Proofreader
  private async createProofreaderCore(): Promise<void> {
    if (!window.Proofreader) throw new Error("Proofreader API not available");
    const inst = await window.Proofreader.create({
      includeCorrectionTypes: true,
      includeCorrectionExplanations: true,
    });
    this.proofreader = inst;
    this.status("AI: Proofreader ready.");
  }
  private startProofreaderGesture(): Promise<void> {
    return this.runWithGesture("Proofreader", () => this.createProofreaderCore());
  }
  private initProofreader_noGesture(): Promise<void> {
    return this.createProofreaderCore();
  }

  // ---------- Language Detector ----------
  private async createLanguageDetectorCore(withMonitor = false): Promise<void> {
    if (!window.LanguageDetector) throw new Error("LanguageDetector API not available");
    const langs = this.summarizerLangsFinal.length ? this.summarizerLangsFinal : ["en"];
    this.detector = await window.LanguageDetector.create({
      expectedInputLanguages: langs,
      monitor: withMonitor ? (m: any) => {
        m.addEventListener?.("downloadprogress", (e: any) => {
          const pct = typeof e.progress === "number" ? e.progress : e.loaded;
          this.status(`AI: Language Detector downloading… ${Math.round((pct || 0) * 100)}%`);
        });
      } : undefined
    });
    this.status("AI: Language Detector ready.");
  }

  private startLanguageDetectorGesture(): Promise<void> {
    return this.runWithGesture("Language Detector", () => this.createLanguageDetectorCore(true));
  }

  private initLanguageDetector_noGesture(): Promise<void> {
    return this.createLanguageDetectorCore(false);
  }

  // ---------- Translators ----------
  private async preloadTranslators_createReady(): Promise<void> {
    if (!window.Translator) return;
    const targets = (this.opts.preloadTargets || []).map((t) => toBaseLang(String(t)));
    for (const tgt of targets) {
      if (tgt === this.sourceLangBase) continue;
      const avail = await window.Translator.availability({ sourceLanguage: this.sourceLangBase, targetLanguage: tgt });
      if (avail !== "available") continue; // only ready translators
      const tr = await window.Translator.create({ sourceLanguage: this.sourceLangBase, targetLanguage: tgt });
      this.translators.set(tgt, tr);
      this.status(`AI: Translator[auto→${tgt}] ready (cached).`);
    }
  }

  private async createTranslatorCore(src: string, tgt: string): Promise<void> {
    if (!window.Translator) throw new Error("Translator API not available");
    const avail = await window.Translator.availability({
      sourceLanguage: src,
      targetLanguage: tgt,
    });
    this.status(`AI: Translator[${src}→${tgt}] availability = ${avail}`);

    try {
      const tr = await window.Translator.create({
        sourceLanguage: src, // never "auto"; use BCP-47
        targetLanguage: tgt,
        monitor(m) {
          m.addEventListener("downloadprogress", (e: any) => {
            const pct = Math.round(((e?.loaded ?? 0) as number) * 100);
            // Note: MDN documents e.loaded; some builds exposed e.progress. We prefer loaded.
            try { this.status?.(`AI: Translator[${src}→${tgt}] ${pct}%`); } catch {}
          });
        },
      });

      this.translators.set(tgt, tr);
      this.status(`AI: Translator[${src}→${tgt}] ready.`);
    } catch (err: any) {
      // annotate the thrown error with the pair + last-known availability
      const msg = err?.message || err;
      this.status(`AI: Translator[${src}→${tgt}] failed (${avail}): ${msg}`);
      throw err;
    }
  }


  // private startTranslatorGesture(tgt: string): Promise<void> {
  //   const src = this.sourceLangBase;
  //   return this.runWithGesture(`Translator:${src}→${tgt}`, () => this.createTranslatorCore(src, tgt));
  // }

  // private initTranslator_noGesture(tgt: string): Promise<void> {
  //   return this.createTranslatorCore(this.sourceLangBase, tgt);
  // }

  // ---------- Public ops ----------
  public destroy(): void {
    for (const tr of this.translators.values()) (tr as any)?.destroy?.();
    this.translators.clear();
    (this.detector as any)?.destroy?.();
    (this.summarizer as any)?.destroy?.();
    (this.writer as any)?.destroy?.();
    (this.rewriter as any)?.destroy?.();
    (this.proofreader as any)?.destroy?.();
    (AIClient as any)._promptSession = null;
    this.status("AI: all instances destroyed.");
  }

  // ---------- Runtime convenience ----------
  public async summarize(text: string): Promise<string> {
    if (!this.summarizer) throw new Error("Summarizer not initialized. Run ensureReadyWithPrompt() and confirm the download.");
    return this.summarizer.summarize(text);
  }
  public async proofread(text: string): Promise<string> {
    if (!this.proofreader) throw new Error("Proofreader not initialized. Run ensureReadyWithPrompt() and confirm the download.");
    const res = await this.proofreader.proofread(text);
    return typeof res === "string" ? res : (res.correctedText || text);
  }
  public async detectLanguage(text: string): Promise<{ detectedLanguage: string; confidence: number } | null> {
    if (!this.detector) throw new Error("LanguageDetector not initialized. Run ensureReadyWithPrompt() and confirm the download.");
    const arr = await this.detector.detect(text);
    return (Array.isArray(arr) && arr[0]) ? arr[0] : null;
  }
  public async translate(text: string, target: LangCode): Promise<string> {
    if (!window.Translator) throw new Error("Translator API not available.");

    const tgt = toBaseLang(String(target));

    // Detect source if possible
    let src = this.sourceLangBase;
    if (this.detector) {
      try {
        const arr = await this.detector.detect(text);
        if (Array.isArray(arr) && arr[0]?.detectedLanguage) {
          src = toBaseLang(arr[0].detectedLanguage);
        }
      } catch {}
    }
    if (src === tgt) return text;

    // If we already preloaded the (sourceLangBase → tgt) translator, reuse it.
    // Otherwise, create a new translator for the actual detected 'src'.
    let translator = this.translators.get(tgt);
    if (!translator || src !== this.sourceLangBase) {
      const avail = await window.Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
      if (avail === "unavailable") throw new Error(`Translator unavailable: ${src}→${tgt}`);
      // If downloadable / requires gesture, you should route via your gesture flow.
      translator = await window.Translator.create({ sourceLanguage: src, targetLanguage: tgt });
    }

    if (typeof translator.measureInputUsage === "function" && typeof translator.inputQuota === "number") {
      const usage = await translator.measureInputUsage(text);
      if (usage > (translator.inputQuota as number)) throw new Error("Insufficient translation quota.");
    }
    return translator.translate(text);
  }
  private _writerTone?: WriterTone;
  private _rewriterTone?: RewriterTone;

  private async ensureWriter(tone?: string): Promise<void> {
    const t = tone ?? this.opts.defaultWriterTone ?? "neutral";
    if (!this.writer || this._writerTone !== t) {
      this.opts.defaultWriterTone = mapWriterTone(t);
      await this.createWriterCore(); // already sets this.writer
      this._writerTone = mapWriterTone(t);
    }
  }

  private async ensureRewriter(tone?: RewriterTone): Promise<void> {
    const t = tone ?? this.opts.defaultRewriterTone ?? "as-is";
    if (!this.rewriter || this._rewriterTone !== t) {
      this.opts.defaultRewriterTone = mapRewriterTone(t);
      await this.createRewriterCore(); // already sets this.rewriter
      this._rewriterTone = mapRewriterTone(t);
    }
  }

  // You can pass either kind or tone (or both). If both omitted, neutral/as-is + default task.
  public async write(text: string, tone?: string, context?: string ): Promise<string> {
    await this.ensureWriter(tone);

    const task = (tone === "proposal" ? "Write a concise client proposal using the provided details."
      : tone === "reminder" ? "Write a polite payment reminder email."
      : tone === "change_request" ? "Write a change-request note summarizing scope changes, new price, and dates."
      : "Write the requested text based on the provided context.");

    return this.writer!.write(task, { context:text });
  }

  public async rewrite(text: string, tone?: RewriterTone, context?: string ): Promise<string> {
    await this.ensureRewriter(tone);
    return this.rewriter!.rewrite(text, { context: context ?? "" });
  }


  // ---------- Gesture runner ----------
  private runWithGesture(label: string, exec: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const run = () => {
        if (!(navigator as any).userActivation?.isActive) {
          this.status(`AI: no user activation for ${label}`);
          reject(new Error(`No user activation for ${label}`));
          return;
        }
        exec().then(resolve, reject);
      };

      if ((navigator as any).userActivation?.isActive) {
        run();
      } else {
        askPrompt(`Authorize download for ${label}?`, (action) => {
          if (action !== "ok") return reject(new Error(`${label} canceled`));
          run();
        }, "OK", "Cancel");
      }
    });
  }
}
