import React, { useState, useCallback } from "react";
import { SkillManifest } from "../types";
import type { ProgressReport } from "../services/webllm";

const webGPUSupported = typeof navigator !== "undefined" && "gpu" in navigator;

interface SkillExportProps {
  skillMd: string;
  manifestJson: SkillManifest | null;
  repoUrl: string;
  repoNameForFilename: string | null;
  githubToken: string | null;
  digest: string;
}

declare const __API_HOST__: string;
const API_HOST: string = __API_HOST__;



export const SkillExport: React.FC<SkillExportProps> = ({
  skillMd,
  manifestJson,
  repoUrl,
  repoNameForFilename,
  githubToken: _githubToken,
  digest,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");


  // WebLLM state
  const [skillMdOverride, setSkillMdOverride] = useState<string>("");
  const [prevDescription, setPrevDescription] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmProgress, setLlmProgress] = useState<ProgressReport | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [descHighlight, setDescHighlight] = useState(false);
  /** Live partial text being streamed — shown with a cursor in the preview */
  const [streamingPartial, setStreamingPartial] = useState<string | null>(null);



  const displaySkillMd = skillMdOverride || skillMd;

  const languageList = manifestJson?.metadata?.primary_languages?.join(", ") ?? "—";
  const filesAnalyzed = manifestJson?.metadata?.files_analyzed ?? "—";
  const generatedAt = manifestJson?.metadata?.generated_at
    ? new Date(manifestJson.metadata.generated_at).toLocaleString()
    : "—";



  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleDownloadZip = useCallback(async () => {
    if (!repoUrl || !digest) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      // Parse owner/repo from the GitHub URL
      const urlParts = repoUrl.replace(/\.git$/, "").split("/").filter(Boolean);
      const owner = urlParts[urlParts.length - 2] ?? "";
      const repo = urlParts[urlParts.length - 1] ?? (repoNameForFilename ?? "repo");

      const isLocal = API_HOST.startsWith("localhost") || API_HOST.startsWith("127.");
      // Use http:// directly for local dev — the Vite proxy drops large POST bodies
      // (ERR_CONNECTION_RESET). Calling the API directly on port 8888 avoids this.
      const skillZipUrl = isLocal
        ? `http://${API_HOST}/skill-zip`
        : `https://${API_HOST}/skill-zip`;
      const response = await fetch(skillZipUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: repoUrl,
          owner,
          repo,
          digest_md: digest,
          languages: manifestJson?.metadata?.primary_languages ?? [],
          files_analyzed: manifestJson?.metadata?.files_analyzed ?? 0,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${repo}-skill.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      setDownloadError(err.message ?? "Download failed.");
    } finally {
      setIsDownloading(false);
    }
  }, [repoUrl, repoNameForFilename, digest, manifestJson]);


  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displaySkillMd);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch (_) { }
  }, [displaySkillMd]);



  const handleGenerateDescription = useCallback(async () => {
    if (!webGPUSupported) return;
    setLlmLoading(true);
    setLlmError(null);
    setLlmProgress(null);
    setPrevDescription("");
    setNewDescription("");
    setStreamingPartial(null);
    try {
      const { generateSkillDescription } = await import("../services/webllm");
      const languages = manifestJson?.metadata?.primary_languages ?? [];
      const repoName = manifestJson?.display_name ?? repoNameForFilename ?? "this repo";

      // Capture the old description before replacing
      const oldDescMatch = displaySkillMd.match(/description: "(.*?)"/);
      const oldDesc = oldDescMatch ? oldDescMatch[1] : "(none)";

      const description = await generateSkillDescription(
        repoName,
        languages,
        digest,
        (report) => setLlmProgress(report),
        // Live chunk callback — update the preview with each new token
        (partial) => setStreamingPartial(partial)
      );

      // Generation done — clear streaming state and write final result
      setStreamingPartial(null);
      const updated = displaySkillMd.replace(
        /description: ".*?"/s,
        `description: "${description.replace(/"/g, '\\"')}"`
      );
      setSkillMdOverride(updated);
      setPrevDescription(oldDesc);
      setNewDescription(description);

      // Flash the description line in the preview
      setDescHighlight(true);
      setTimeout(() => setDescHighlight(false), 2500);
    } catch (err: any) {
      setStreamingPartial(null);
      setLlmError(err.message ?? "AI generation failed.");
    } finally {
      setLlmLoading(false);
      setLlmProgress(null);
    }
  }, [manifestJson, repoNameForFilename, digest, displaySkillMd]);



  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 h-full">


      {/* Metadata pills — unified neutral style */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 bg-slate-700/50 text-slate-400 border border-slate-600/50 px-2.5 py-1 rounded-full font-mono">{generatedAt}</span>
        <span className="flex items-center gap-1.5 bg-slate-700/50 text-slate-400 border border-slate-600/50 px-2.5 py-1 rounded-full">{filesAnalyzed} files</span>
        {languageList !== "—" && (
          <span className="flex items-center gap-1.5 bg-slate-700/50 text-slate-400 border border-slate-600/50 px-2.5 py-1 rounded-full">{languageList}</span>
        )}
        <span className="flex items-center gap-1.5 bg-slate-700/50 text-slate-400 border border-slate-600/50 px-2.5 py-1 rounded-full font-mono text-[10px] tracking-wide">agentskills.io v1.0</span>
      </div>

      {/* Action buttons — consistent with DigestOutput */}
      <div className="flex items-center gap-3">
        <button
          id="skill-download-zip-btn"
          onClick={handleDownloadZip}
          disabled={isDownloading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/50 text-white text-sm font-semibold transition-all duration-150 shadow-md hover:shadow-violet-500/20 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed"
        >
          {isDownloading ? (
            <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Packaging…</>
          ) : (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>Download .zip</>
          )}
        </button>

        <button
          onClick={handleCopy}
          id="skill-copy-btn"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 border ${
            copyState === "copied"
              ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-400 focus:ring-emerald-500"
              : "bg-slate-700/50 hover:bg-slate-700 border-slate-600 text-slate-300 hover:text-slate-100 focus:ring-violet-500"
          }`}
        >
          {copyState === "copied" ? (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" /></svg>Copied!</>
          ) : (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v3.75c0 .621-.504 1.125-1.125 1.125h-4.5c-.621 0-1.125-.504-1.125-1.125V5.25c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.25c0-1.108.806-2.057 1.907-2.25a48.208 48.208 0 011.927-.184" /></svg>Copy SKILL.md</>
          )}
        </button>

        {/* AI Description button — subtle, tertiary */}
        {webGPUSupported && (
          <div className="relative group ml-auto">
            <button
              id="skill-ai-description-btn"
              onClick={handleGenerateDescription}
              disabled={llmLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-slate-700/50 hover:bg-slate-700 border border-slate-600 text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-1.5">
              {llmLoading ? (
                <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Generating…</>
              ) : (
                <>✨ AI Description</>
              )}
              {!llmLoading && (
                <span className="ml-1 text-[9px] font-semibold tracking-wider uppercase bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 rounded">WebGPU</span>
              )}
              </span>
            </button>
            {/* Tooltip */}
            <div className="absolute bottom-full right-0 mb-2 w-60 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
              <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-[11px] text-slate-300 leading-relaxed shadow-xl">
                <p className="font-semibold text-slate-200 mb-0.5">AI-generated description</p>
                Rewrites the <code className="text-slate-300 bg-slate-900/60 px-0.5 rounded">description:</code> field in your SKILL.md using an on-device language model — no data leaves your browser.
                <div className="absolute top-full right-4 border-4 border-transparent border-t-slate-600" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Zip content hint */}
      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <svg className="w-3 h-3 shrink-0 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        The <span className="text-slate-400 font-medium">.zip</span> includes both the <span className="text-slate-400 font-medium">SKILL.md</span> and the full <span className="text-slate-400 font-medium">Code Digest</span> — everything your agents need in one file.
      </p>

      {downloadError && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 px-3 py-2 rounded-lg">{downloadError}</p>
      )}
      {llmLoading && llmProgress && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden w-48">
            <div className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-300" style={{ width: `${Math.round((llmProgress.progress ?? 0) * 100)}%` }} />
          </div>
          <span className="text-[10px] text-slate-400 font-mono">{llmProgress.text}</span>
        </div>
      )}
      {llmError && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 px-3 py-2 rounded-lg">{llmError}</p>}

      {/* AI Description result callout */}
      {skillMdOverride && !llmLoading && newDescription && (
        <div className="rounded-lg border border-violet-500/40 bg-violet-500/8 px-3 py-2.5 flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-300">
          <p className="text-[11px] font-semibold text-violet-300 flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            SKILL.md description updated by AI
          </p>
          {prevDescription && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-slate-500 font-mono line-through truncate">− {prevDescription}</p>
              <p className="text-[10px] text-emerald-300 font-mono truncate">+ {newDescription}</p>
            </div>
          )}
          <p className="text-[10px] text-slate-500">The <code className="text-amber-300">description:</code> field below has been rewritten. Copy SKILL.md to save the change.</p>
        </div>
      )}

      {/* SKILL.md pane */}
      <div className="flex-1 relative rounded-xl overflow-hidden border border-slate-700 bg-slate-950 min-h-[360px]">
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 bg-slate-900/80 border-b border-slate-700/60 z-10 backdrop-blur-sm">
          <span className="font-mono text-xs text-slate-400">SKILL.md</span>
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
        </div>
        <div className="pt-10 h-full overflow-auto">
          <MarkdownPreview
            content={displaySkillMd}
            highlightDescription={descHighlight}
            streamingPartial={streamingPartial}
          />
        </div>
      </div>



      {/* Footer */}
      <p className="text-xs text-slate-500 text-center">
        Compatible with{" "}
        <a href="https://agentskills.io" target="_blank" rel="noopener noreferrer" className="text-amber-400/80 hover:text-amber-300 underline underline-offset-2">agentskills.io</a>
        {" "}· Claude Skills · Google ADK · Agno · OpenAI Agents
      </p>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * MarkdownPreview renders SKILL.md with optional:
 *  - streaming: live partial description being typed in (with blinking cursor)
 *  - highlightDescription: purple flash after generation completes
 */
const MarkdownPreview: React.FC<{
  content: string;
  highlightDescription?: boolean;
  streamingPartial?: string | null;
}> = ({ content, highlightDescription, streamingPartial }) => {
  if (!content) {
    return (
      <pre className="p-4 text-xs leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-words select-all">
        <span className="text-slate-600 italic">No SKILL.md content available.</span>
      </pre>
    );
  }

  // While streaming: replace the description value live
  const isStreaming = streamingPartial != null;
  const descPattern = /description: "(.*?)"/s;
  const descMatch = content.match(descPattern);

  if (isStreaming && descMatch) {
    const liveDesc = `description: "${streamingPartial}"`;
    const [before, ...afterParts] = content.split(descMatch[0]);
    const after = afterParts.join(descMatch[0]);
    return (
      <pre className="p-4 text-xs leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-words select-all">
        {before}
        <span
          style={{
            background: 'rgba(139,92,246,0.18)',
            outline: '1px solid rgba(139,92,246,0.45)',
            borderRadius: '3px',
          }}
        >
          {liveDesc}
          {/* Blinking cursor */}
          <span
            style={{
              display: 'inline-block',
              width: '0.55em',
              height: '1.1em',
              background: 'rgba(167,139,250,0.9)',
              borderRadius: '1px',
              marginLeft: '1px',
              verticalAlign: 'text-bottom',
              animation: 'skillCursorBlink 0.7s steps(1) infinite',
            }}
          />
        </span>
        {after}
        <style>{`
          @keyframes skillCursorBlink {
            0%, 49% { opacity: 1; }
            50%, 100% { opacity: 0; }
          }
        `}</style>
      </pre>
    );
  }

  // Post-generation highlight
  if (highlightDescription && descMatch) {
    const [before, ...afterParts] = content.split(descMatch[0]);
    const after = afterParts.join(descMatch[0]);
    return (
      <pre className="p-4 text-xs leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-words select-all">
        {before}
        <span
          style={{
            background: 'rgba(139,92,246,0.25)',
            outline: '1px solid rgba(139,92,246,0.5)',
            borderRadius: '3px',
            transition: 'background 2s ease, outline 2s ease',
          }}
        >
          {descMatch[0]}
        </span>
        {after}
      </pre>
    );
  }

  return (
    <pre className="p-4 text-xs leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-words select-all">
      {content}
    </pre>
  );
};


