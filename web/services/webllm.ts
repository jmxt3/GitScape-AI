/**
 * WebLLM service for client-side AI inference via WebGPU.
 * Uses Qwen2 0.5B — ultra-low cost, no server, no API key required.
 *
 * IMPORTANT: This module uses a dynamic import() for @mlc-ai/web-llm so the
 * ~10 MB SDK is NEVER parsed at startup. It is only fetched when the user
 * explicitly triggers AI generation.
 *
 * Author: João Machete
 */

// Llama-3.2-1B-Instruct — ~700 MB, cached in browser Cache API after first download.
// Significantly better instruction following than Qwen 0.5B, eliminating most
// prompt-leak artifacts ("Output: []", code fences, preamble lines).
const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

// We use `any` here to avoid pulling in the webllm types at compile time.
// The dynamic import resolves the real types at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engineInstance: any | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engineLoadPromise: Promise<any> | null = null;

export type ProgressReport = {
  progress: number; // 0–1
  text: string;
};

// ─── Section types ────────────────────────────────────────────────────────────

/**
 * The 5 sections we generate one at a time.
 * Order matters — each section streams and updates the preview live.
 */
export type SkillSection =
  | "description"
  | "overview"
  | "capabilities"
  | "usage"
  | "boundaries";

export const SKILL_SECTIONS: SkillSection[] = [
  "description",
  "overview",
  "capabilities",
  "usage",
  "boundaries",
];

export const SKILL_SECTION_LABELS: Record<SkillSection, string> = {
  description: "Description",
  overview:    "Overview",
  capabilities: "Capabilities",
  usage:       "Usage Instructions",
  boundaries:  "Boundaries",
};

/** Returns true if WebGPU is available in this browser. Pure check — no imports. */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Lazily import @mlc-ai/web-llm and return the module.
 * The dynamic import() is only executed once; subsequent calls reuse the cached module.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _webllmModule: any | null = null;
async function getWebLLMModule() {
  if (!_webllmModule) {
    // Dynamic import — only fetches and parses the bundle on first call
    _webllmModule = await import("@mlc-ai/web-llm");
  }
  return _webllmModule;
}

/**
 * Get (or lazily initialize) the shared MLCEngine instance.
 * Safe to call multiple times — returns the cached engine after first load.
 */
export async function getEngine(
  onProgress?: (report: ProgressReport) => void
): Promise<unknown> {
  if (engineInstance) return engineInstance;

  if (!engineLoadPromise) {
    engineLoadPromise = (async () => {
      const webllm = await getWebLLMModule();
      const engine = await webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (report: { progress: number; text: string }) => {
          onProgress?.({ progress: report.progress, text: report.text });
        },
      });
      engineInstance = engine;
      return engine;
    })().catch((err) => {
      engineLoadPromise = null; // allow retry on failure
      throw err;
    });
  }

  return engineLoadPromise;
}

// ─── Section-specific prompts ─────────────────────────────────────────────────
// Llama-3.2-1B follows system prompts well, so we use a system message to lock
// output format and a focused user message with the content to rewrite.

const SYSTEM_PROMPT =
  "You are a technical writer specialising in AI agent skill documentation. " +
  "Follow the user's formatting rules exactly. Output ONLY the requested content — " +
  "no preamble, no code fences, no explanations, no labels like 'Output:'.";

function buildMessages(
  section: SkillSection,
  repoName: string,
  langStr: string,
  currentContent: string
): { messages: { role: string; content: string }[]; max_tokens: number } {
  const sys = { role: "system", content: SYSTEM_PROMPT };

  switch (section) {
    case "description":
      return {
        max_tokens: 120,
        messages: [sys, { role: "user", content:
`Improve this AI skill description for the ${repoName} repository (${langStr}).

Current description:
${currentContent.substring(0, 400)}

Write 2-3 sentences. Start with "Use when working with". Keep factual details. No quotes.` }],
      };

    case "overview":
      return {
        max_tokens: 180,
        messages: [sys, { role: "user", content:
`Rewrite the Overview section for the ${repoName} skill.

Current text:
${currentContent.substring(0, 500)}

Write 3 plain-prose sentences. First: what the repo does. Second: key components. Third: who uses it. No bullet points.` }],
      };

    case "capabilities":
      return {
        max_tokens: 240,
        messages: [sys, { role: "user", content:
`Rewrite the Capabilities list for the ${repoName} skill.

Current list:
${currentContent.substring(0, 500)}

Write exactly 5-6 bullet points. Each starts with "- ". Be specific to ${repoName}. Improve wording only.` }],
      };

    case "usage":
      return {
        max_tokens: 180,
        messages: [sys, { role: "user", content:
`Rewrite the Usage Instructions for the ${repoName} skill.

Current:
${currentContent.substring(0, 400)}

Write a numbered list: 1. 2. 3. 4. Each item under 20 words. Tell the agent exactly what to do.` }],
      };

    case "boundaries":
      return {
        max_tokens: 160,
        messages: [sys, { role: "user", content:
`Rewrite the Boundaries section for the ${repoName} skill.

Current:
${currentContent.substring(0, 400)}

Write a bullet list. Each item starts with "- ". State what the agent must NOT do or must acknowledge. Under 20 words each.` }],
      };
  }
}

// ─── Output sanitizer ────────────────────────────────────────────────────────
// Strip common LLM artifacts that leak into output even with good prompts.
export function cleanOutput(raw: string): string {
  return raw
    .replace(/```[\w]*\n?/g, "")          // remove opening code fences
    .replace(/```\s*$/gm, "")              // remove closing code fences
    .replace(/^Output:\s*\[?\]?\s*$/gim, "")  // remove "Output: []" lines
    .replace(/^Numbered list:\s*$/gim, "")    // remove "Numbered list:" preamble
    .replace(/^Bullet list:\s*$/gim, "")      // remove "Bullet list:" preamble
    .replace(/^Here (are|is) .*?:\s*$/gim, "") // remove "Here are the X:" preambles
    .replace(/^Rewritten .*?:\s*$/gim, "")     // remove "Rewritten description:" labels
    .replace(/\n{3,}/g, "\n\n")           // collapse excess blank lines
    .trim();
}

// ─── Core streaming helper ────────────────────────────────────────────────────

async function streamCompletion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: any,
  messages: { role: string; content: string }[],
  max_tokens: number,
  onChunk?: (partial: string) => void
): Promise<string> {
  const stream = await engine.chat.completions.create({
    messages,
    max_tokens,
    temperature: 0.3,
    top_p: 0.9,
    stream: true,
  });

  let full = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of stream as AsyncIterable<any>) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      full += delta;
      onChunk?.(full);
    }
  }

  return full.trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate one SKILL.md section at a time.
 * The engine is loaded once and reused across all subsequent calls in the
 * same session — model download only happens on the very first invocation.
 */
export async function generateSkillSection(
  section: SkillSection,
  repoName: string,
  languages: string[],
  digestSnippet: string,
  onProgress?: (report: ProgressReport) => void,
  onChunk?: (partial: string) => void
): Promise<string> {
  const engine = await getEngine(onProgress);
  const langStr = languages.join(", ") || "multiple languages";
  const { messages, max_tokens } = buildMessages(section, repoName, langStr, digestSnippet);
  const raw = await streamCompletion(engine, messages, max_tokens, onChunk);
  return cleanOutput(raw);
}

/**
 * Legacy single-call description generator.
 * Kept for backward compatibility — prefer generateSkillSection("description").
 */
export async function generateSkillDescription(
  repoName: string,
  languages: string[],
  digestSnippet: string,
  onProgress?: (report: ProgressReport) => void,
  onChunk?: (partial: string) => void
): Promise<string> {
  return generateSkillSection("description", repoName, languages, digestSnippet, onProgress, onChunk);
}

/** Dispose the engine to free GPU memory (optional, call on page unload if needed) */
export async function disposeEngine(): Promise<void> {
  if (engineInstance) {
    await engineInstance.unload?.();
    engineInstance = null;
    engineLoadPromise = null;
  }
}

/**
 * Silently warm-up the engine in the background on page load.
 * - If the model is already cached by the browser, this resolves in seconds.
 * - If not cached, it downloads ~700 MB in the background via the Cache API.
 * - Never throws and never updates any UI — fully fire-and-forget.
 * - When the user later clicks "Rewrite Skill", getEngine() returns the
 *   already-loaded instance instantly instead of making them wait.
 *
 * Call this once on app mount, guarded by isWebGPUSupported().
 */
export function preloadEngine(): void {
  if (!isWebGPUSupported()) return;
  if (engineInstance || engineLoadPromise) return; // already loaded or loading

  // Use a short idle delay so the main thread is free for the initial render
  const kick = () => {
    getEngine().catch(() => {
      // Silent failure — the user will get a proper error when they click the button
    });
  };

  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(kick, { timeout: 3000 });
  } else {
    setTimeout(kick, 1500);
  }
}
