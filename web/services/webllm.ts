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

// Qwen2-0.5B — ~350 MB model, cached in browser Cache API after first download
const MODEL_ID = "Qwen2-0.5B-Instruct-q4f16_1-MLC";

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

/**
 * Generate a rich, repo-specific SKILL.md description using Qwen2 0.5B.
 * Only loads the model on first call; subsequent calls are instant.
 *
 * @param repoName      "owner/repo"
 * @param languages     Top detected languages e.g. ["TypeScript", "Python"]
 * @param digestSnippet First ~1500 chars of DIGEST.md for grounding context
 * @param onProgress    Optional progress callback during model download/load
 */
export async function generateSkillDescription(
  repoName: string,
  languages: string[],
  digestSnippet: string,
  onProgress?: (report: ProgressReport) => void,
  /** Called with each incremental token as it streams in */
  onChunk?: (partial: string) => void
): Promise<string> {
  const engine = await getEngine(onProgress);

  const langStr = languages.join(", ") || "multiple languages";
  const snippet = digestSnippet.substring(0, 1500);

  const prompt = `You are writing the "description" field for an AI agent skill file (SKILL.md format).

Repository: ${repoName}
Languages: ${langStr}
Code context:
${snippet}

Write a single description paragraph of 2-3 sentences for the SKILL.md "description" field.
Requirements:
- Mention the repository name and primary language/framework
- Use active verbs (e.g. "Use when...", "Activate to...", "Covers...")
- State what tasks this skill helps with (debugging, adding features, understanding architecture)
- Be specific, not generic

Output ONLY the description text. No quotes, no extra formatting, no markdown.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await (engine as any).chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    max_tokens: 180,
    temperature: 0.4,
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

/** Dispose the engine to free GPU memory (optional, call on page unload if needed) */
export async function disposeEngine(): Promise<void> {
  if (engineInstance) {
    await engineInstance.unload?.();
    engineInstance = null;
    engineLoadPromise = null;
  }
}
