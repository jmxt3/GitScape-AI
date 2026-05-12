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
type Framework = "adk" | "agno";

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
  const [copyCmdState, setCopyCmdState] = useState<"idle" | "copied">("idle");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedPane, setAdvancedPane] = useState<"manifest" | "adk" | "agno">("manifest");

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

  // Framework export state
  const [frameworkCode, setFrameworkCode] = useState<string>("");
  const [frameworkLoading, setFrameworkLoading] = useState(false);
  const [frameworkError, setFrameworkError] = useState<string | null>(null);
  const [loadedFramework, setLoadedFramework] = useState<Framework | null>(null);

  const displaySkillMd = skillMdOverride || skillMd;
  const manifestStr = manifestJson ? JSON.stringify(manifestJson, null, 2) : "{}";
  const languageList = manifestJson?.metadata?.primary_languages?.join(", ") ?? "—";
  const filesAnalyzed = manifestJson?.metadata?.files_analyzed ?? "—";
  const generatedAt = manifestJson?.metadata?.generated_at
    ? new Date(manifestJson.metadata.generated_at).toLocaleString()
    : "—";

  const installCmd = repoUrl
    ? `npx skills add ${repoUrl}`
    : "npx skills add <repo-url>";

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
    } catch (_) {}
  }, [displaySkillMd]);

  const handleCopyCmd = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installCmd);
      setCopyCmdState("copied");
      setTimeout(() => setCopyCmdState("idle"), 2000);
    } catch (_) {}
  }, [installCmd]);

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

  const handleLoadFramework = useCallback(async (fw: Framework) => {
    setAdvancedPane(fw);
    if (loadedFramework === fw && frameworkCode) return;
    setFrameworkLoading(true);
    setFrameworkError(null);
    setFrameworkCode("");
    setLoadedFramework(null);
    try {
      const apiUrl = new URL(`https://${API_HOST}/export/${fw}`);
      apiUrl.searchParams.append("repo_url", encodeURIComponent(repoUrl));
      const response = await fetch(apiUrl.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      setFrameworkCode(text);
      setLoadedFramework(fw);
    } catch (err: any) {
      setFrameworkError(err.message ?? "Failed to load framework export.");
    } finally {
      setFrameworkLoading(false);
    }
  }, [repoUrl, loadedFramework, frameworkCode]);

  const handleDownloadFramework = useCallback(() => {
    if (!frameworkCode || !loadedFramework) return;
    const blob = new Blob([frameworkCode], { type: "text/x-python" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${repoNameForFilename ?? "repo"}-${loadedFramework}-skill.py`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }, [frameworkCode, repoNameForFilename, loadedFramework]);

  const advancedContent = () => {
    if (advancedPane === "manifest") return <JsonPreview content={manifestStr} />;
    if (frameworkLoading) return (
      <div className="flex items-center justify-center h-48 gap-3 text-slate-400">
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
        <span className="text-sm">Generating {advancedPane.toUpperCase()} export…</span>
      </div>
    );
    if (frameworkError) return <div className="p-4 text-xs text-red-400">{frameworkError}</div>;
    if (frameworkCode) return <PythonPreview content={frameworkCode} />;
    return <div className="flex items-center justify-center h-48 text-slate-500 text-sm">Click a framework button to generate.</div>;
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* Install banner */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 p-1.5 rounded-lg bg-amber-500/15">
            <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-4M9 3l6 6M9 3v6h6" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-200 mb-0.5">Install this skill</p>
            <p className="text-xs text-slate-400">
              Run one command — works with Cursor, Claude Code, Copilot &amp; more.
            </p>
            <p className="text-[10px] text-slate-500 mt-1">
              ⚠️ Requires the SKILL.md to be committed to the repo first.{" "}
              <span className="text-slate-400">Download the .zip below and push it to your repo to enable this command.</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-700 rounded-lg px-3 py-2.5">
          <span className="text-slate-500 text-xs font-mono select-none">$</span>
          <code className="flex-1 text-xs font-mono text-amber-300 truncate select-all">{installCmd}</code>
          <button
            id="skill-copy-install-cmd-btn"
            onClick={handleCopyCmd}
            className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 transition-all duration-150"
          >
            {copyCmdState === "copied" ? (
              <><svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-green-400">Copied</span></>
            ) : (
              <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>Copy</>
            )}
          </button>
        </div>
      </div>

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
                <>✨ AI Description</>
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

      {/* Advanced collapsible */}
      <div className="rounded-xl border border-slate-700/60 overflow-hidden">
        <button
          id="skill-advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-900/60 hover:bg-slate-800/60 transition-colors text-xs text-slate-400 hover:text-slate-300"
        >
          <span className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Advanced exports
            <span className="text-[10px] text-slate-600">manifest.json · Google ADK · Agno</span>
          </span>
          <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>

        {showAdvanced && (
          <div className="border-t border-slate-700/60">
            {/* Advanced sub-tabs */}
            <div className="flex gap-1 bg-slate-900/40 px-3 pt-2 pb-0">
              {(["manifest", "adk", "agno"] as const).map((p) => (
                <button
                  key={p}
                  id={`skill-adv-tab-${p}`}
                  onClick={() => {
                    if (p === "adk" || p === "agno") handleLoadFramework(p);
                    else setAdvancedPane("manifest");
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-t-md transition-all duration-150 border-b-2 ${
                    advancedPane === p
                      ? "bg-slate-800 text-slate-200 border-amber-500/60"
                      : "text-slate-500 hover:text-slate-300 border-transparent"
                  }`}
                >
                  {p === "manifest" ? "manifest.json" : p === "adk" ? "Google ADK" : "Agno"}
                </button>
              ))}
              {(advancedPane === "adk" || advancedPane === "agno") && frameworkCode && (
                <button
                  id="skill-download-py-btn"
                  onClick={handleDownloadFramework}
                  className="ml-auto mb-1 flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all duration-150"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download .py
                </button>
              )}
            </div>
            <div className="bg-slate-950 max-h-80 overflow-auto border-t border-slate-700/60">
              {advancedContent()}
            </div>
          </div>
        )}
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

const JsonPreview: React.FC<{ content: string }> = ({ content }) => (
  <pre
    className="p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words select-all"
    dangerouslySetInnerHTML={{ __html: colorizeJson(content) }}
  />
);

const PythonPreview: React.FC<{ content: string }> = ({ content }) => (
  <pre
    className="p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words select-all"
    dangerouslySetInnerHTML={{ __html: colorizePython(content) }}
  />
);

function colorizeJson(json: string): string {
  return json
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = "color:#6ee7b7";
        if (/^"/.test(match)) cls = /:$/.test(match) ? "color:#93c5fd" : "color:#fde68a";
        else if (/true|false/.test(match)) cls = "color:#c084fc";
        else if (/null/.test(match)) cls = "color:#94a3b8";
        return `<span style="${cls}">${match}</span>`;
      }
    );
}

function colorizePython(code: string): string {
  const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"]*"|'[^']*')/g, `<span style="color:#fde68a">$1</span>`)
    .replace(/\b(from|import|def|class|return|if|else|elif|for|in|not|and|or|True|False|None|async|await|with|as|raise|try|except|finally|pass|lambda|yield|global|nonlocal)\b/g, `<span style="color:#93c5fd">$1</span>`)
    .replace(/(#[^\n]*)/g, `<span style="color:#6b7280">$1</span>`);
}
