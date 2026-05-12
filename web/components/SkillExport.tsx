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

const API_HOST = "api.gitscape.ai";


export const SkillExport: React.FC<SkillExportProps> = ({
  skillMd,
  manifestJson,
  repoUrl,
  repoNameForFilename,
  githubToken,
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
    if (!repoUrl) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const apiUrl = new URL(`https://${API_HOST}/skill-zip`);
      apiUrl.searchParams.append("repo_url", encodeURIComponent(repoUrl));
      if (githubToken) apiUrl.searchParams.append("github_token", encodeURIComponent(githubToken));
      const response = await fetch(apiUrl.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${repoNameForFilename ?? "repo"}-skill.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      setDownloadError(err.message ?? "Download failed.");
    } finally {
      setIsDownloading(false);
    }
  }, [repoUrl, repoNameForFilename, githubToken]);

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


      {/* Metadata pills */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full font-mono">{generatedAt}</span>
        <span className="flex items-center gap-1.5 bg-violet-500/10 text-violet-300 border border-violet-500/30 px-2.5 py-1 rounded-full">{filesAnalyzed} files</span>
        {languageList !== "—" && (
          <span className="flex items-center gap-1.5 bg-blue-500/10 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-full">{languageList}</span>
        )}
        <span className="flex items-center gap-1.5 bg-green-500/10 text-green-300 border border-green-500/30 px-2.5 py-1 rounded-full font-mono text-[10px] tracking-wide">agentskills.io v1.0</span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          id="skill-copy-btn"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 hover:border-slate-500 transition-all duration-150"
        >
          {copyState === "copied" ? (
            <><svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-green-400">Copied</span></>
          ) : (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>Copy SKILL.md</>
          )}
        </button>
        <button
          id="skill-download-zip-btn"
          onClick={handleDownloadZip}
          disabled={isDownloading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 text-black transition-all duration-150 shadow-md hover:shadow-amber-500/25 disabled:cursor-not-allowed"
        >
          {isDownloading ? (
            <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Packaging…</>
          ) : (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>Download .zip</>
          )}
        </button>

        {/* AI Description button */}
        {webGPUSupported && (
          <div className="relative group">
            <button
              id="skill-ai-description-btn"
              onClick={handleGenerateDescription}
              disabled={llmLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 text-white transition-all duration-150 shadow-md disabled:cursor-not-allowed"
            >
              {llmLoading ? (
                <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Generating…</>
              ) : (
                <>✨ Regenerate Description (with AI)</>
              )}
            </button>
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
              <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-[11px] text-slate-300 leading-relaxed shadow-xl">
                <p className="font-semibold text-violet-300 mb-0.5">✨ AI-generated description</p>
                Rewrites the <code className="text-amber-300 bg-slate-900/60 px-0.5 rounded">description:</code> field in your SKILL.md using an on-device language model — no data leaves your browser.
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-600" />
              </div>
            </div>
          </div>
        )}
      </div>

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


