import React, { useState, useCallback, useMemo } from "react";
import { SkillManifest } from "../types";
import type { ProgressReport, SkillSection } from "../services/webllm";
import { SKILL_SECTIONS, SKILL_SECTION_LABELS } from "../services/webllm";

const webGPUSupported = typeof navigator !== "undefined" && "gpu" in navigator;

interface SkillExportProps {
  skillMd: string;
  manifestJson: SkillManifest | null;
  repoUrl: string;
  repoNameForFilename: string | null;
  githubToken: string | null;
  digest: string;
  repoReadme: string;
  repoFileStructure: string;
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
  repoReadme,
  repoFileStructure,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");


  // WebLLM state
  const [skillMdOverride, setSkillMdOverride] = useState<string>("");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmProgress, setLlmProgress] = useState<ProgressReport | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  /** Which section index (0-4) is currently being generated, null when idle */
  const [activeStep, setActiveStep] = useState<number | null>(null);
  /** Sections that have been successfully completed */
  const [completedSteps, setCompletedSteps] = useState<Set<SkillSection>>(new Set());
  /** Live partial text of the section currently streaming */
  const [streamingSection, setStreamingSection] = useState<SkillSection | null>(null);
  const [streamingPartial, setStreamingPartial] = useState<string | null>(null);





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




  const applySectionToSkillMd = useCallback(
    (section: SkillSection, content: string, base: string): string => {
      if (section === "description") {
        // Replace YAML frontmatter description value
        const replaced = base.replace(
          /description: "[\s\S]*?"/,
          `description: "${content.replace(/"/g, '\\"').replace(/\n/g, " ")}"`
        );
        return replaced !== base ? replaced : base + `\n<!-- description: ${content} -->`;
      }

      // For markdown body sections — replace content after the matching ## header
      // until the next ## header or end of file
      const SECTION_HEADERS: Record<SkillSection, string> = {
        description: "",       // handled above
        overview: "## Overview",
        capabilities: "## Capabilities",
        structure: "## Architecture & Structure",
        usage: "## Usage Instructions",
        boundaries: "## Boundaries",
      };
      const header = SECTION_HEADERS[section];
      if (!header) return base;

      // Build regex with proper \\n escapes. Sections are separated by \n\n## in the
      // SKILL.md template, so the lookahead is \n\n## (blank line then header) or end-of-string.
      // Use a replacer function so any $ chars in AI content aren't misread by String.replace().
      const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionRegex = new RegExp(`(${escaped}\\n)[\\s\\S]*?(?=\\n\\n##|$)`);
      const replaced = base.replace(sectionRegex, (_m, hdr) => `${hdr}\n${content}\n`);
      return replaced !== base ? replaced : base;
    },
    []
  );

  /**
   * Pull the current text of a section out of the SKILL.md so the LLM can
   * rewrite it rather than hallucinate from the raw digest.
   */
  const extractSection = useCallback((skillMd: string, section: SkillSection): string => {
    if (section === "description") {
      const m = skillMd.match(/description: "([\s\S]*?)"/);
      return m ? m[1] : "";
    }
    const headers: Record<SkillSection, string> = {
      description: "",
      overview: "## Overview",
      capabilities: "## Capabilities",
      structure: "## Architecture & Structure",
      usage: "## Usage Instructions",
      boundaries: "## Boundaries",
    };
    const header = headers[section];
    if (!header) return "";
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \n\n## mirrors the blank-line separator in the SKILL.md template
    const m = skillMd.match(new RegExp(`${escaped}\\n([\\s\\S]*?)(?=\\n\\n##|$)`));
    const result = m ? m[1].trim() : "";
    console.debug(`[WebLLM] extractSection(${section}):`, result.length, "chars");
    return result;
  }, []);

  // ── displaySkillMd: declared here (after applySectionToSkillMd) to avoid TDZ ──
  // During streaming, apply the partial text into the SKILL.md live so ALL sections
  // show real-time output in the preview. A █ sentinel marks the cursor position.
  const displaySkillMd = useMemo(() => {
    const base = skillMdOverride || skillMd;
    if (!streamingSection || streamingPartial == null) return base;
    return applySectionToSkillMd(streamingSection, streamingPartial + "█", base);
  }, [skillMdOverride, skillMd, streamingSection, streamingPartial, applySectionToSkillMd]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displaySkillMd);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch (_) { }
  }, [displaySkillMd]);


  const handleGenerateSkill = useCallback(async () => {
    if (!webGPUSupported) return;
    setLlmLoading(true);
    setLlmError(null);
    setLlmProgress(null);
    setActiveStep(null);
    setCompletedSteps(new Set());
    setStreamingSection(null);
    setStreamingPartial(null);

    try {
      const { generateSkillSection } = await import("../services/webllm");
      const languages = manifestJson?.metadata?.primary_languages ?? [];
      const repoName = manifestJson?.display_name ?? repoNameForFilename ?? "this repo";

      // Start from the current displayed SKILL.md (or the prop)
      let working = displaySkillMd;

      for (let i = 0; i < SKILL_SECTIONS.length; i++) {
        const section = SKILL_SECTIONS[i];
        setActiveStep(i);
        setStreamingSection(section);
        setStreamingPartial("");

        // Extract the CURRENT section text from the SKILL.md so the model
        // rewrites existing correct content rather than hallucinating from
        // the raw digest (which starts with unrelated source files).
        const currentSectionText = extractSection(working, section);

        const content = await generateSkillSection(
          section,
          repoName,
          languages,
          currentSectionText,
          repoReadme,
          repoFileStructure,
          // Only show model-load progress on the first section
          i === 0 ? (report) => setLlmProgress(report) : undefined,
          (partial) => setStreamingPartial(partial)
        );

        setStreamingPartial(null);
        setStreamingSection(null);
        setLlmProgress(null);

        working = applySectionToSkillMd(section, content, working);
        setSkillMdOverride(working);

        setCompletedSteps((prev) => new Set([...prev, section]));
      }

      setActiveStep(null);
    } catch (err: any) {
      setStreamingPartial(null);
      setStreamingSection(null);
      setLlmError(err.message ?? "AI generation failed.");
    } finally {
      setLlmLoading(false);
      setLlmProgress(null);
      setActiveStep(null);
    }
  }, [manifestJson, repoNameForFilename, displaySkillMd, applySectionToSkillMd, extractSection]);



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
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 text-black text-sm font-semibold transition-all duration-150 shadow-md hover:shadow-amber-500/20 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed"
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
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 border ${copyState === "copied"
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

        {/* AI Skill button — subtle, tertiary */}
        {webGPUSupported && (
          <div className="relative group ml-auto">
            <button
              id="skill-ai-description-btn"
              onClick={handleGenerateSkill}
              disabled={llmLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-slate-700/50 hover:bg-slate-700 border border-slate-600 text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-1.5">
                {llmLoading ? (
                  <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Writing…</>
                ) : completedSteps.size === SKILL_SECTIONS.length ? (
                  <>✅ Rewrite again</>
                ) : (
                  <>✨ AI Rewriting</>
                )}
                {!llmLoading && (
                  <span className="ml-1 text-[9px] font-semibold tracking-wider uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">WebLLM</span>
                )}
              </span>
            </button>
            {/* Tooltip */}
            <div className="absolute bottom-full right-0 mb-2 w-64 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50">
              <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-[11px] text-slate-300 leading-relaxed shadow-xl">
                <p className="font-semibold text-slate-200 mb-0.5">AI-powered SKILL.md</p>
                Rewrites all 5 sections using a GPU-accelerated, on-device model via WebLLM—ensuring no data ever leaves your browser.
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
      {llmError && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 px-3 py-2 rounded-lg">{llmError}</p>}

      {/* Section stepper — shown while generating or after completion */}
      {(llmLoading || completedSteps.size > 0) && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-3 flex flex-col gap-2">
          {/* Model download progress (first section only) */}
          {llmLoading && llmProgress && llmProgress.progress < 1 && (
            <div className="flex flex-col gap-1 mb-1">
              <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-300"
                  style={{ width: `${Math.round((llmProgress.progress ?? 0) * 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-500 font-mono truncate">{llmProgress.text}</span>
            </div>
          )}

          {/* Step pills */}
          <div className="flex flex-wrap gap-1.5">
            {SKILL_SECTIONS.map((section, i) => {
              const isDone = completedSteps.has(section);
              const isActive = activeStep === i && llmLoading;
              return (
                <div
                  key={section}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border transition-all duration-300 ${isDone
                    ? "bg-emerald-900/30 border-emerald-600/40 text-emerald-400"
                    : isActive
                      ? "bg-amber-500/15 border-amber-500/50 text-amber-300 animate-pulse"
                      : "bg-slate-800/60 border-slate-700 text-slate-500"
                    }`}
                >
                  {isDone ? (
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  ) : isActive ? (
                    <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full border border-slate-600 inline-block" />
                  )}
                  {SKILL_SECTION_LABELS[section]}
                </div>
              );
            })}
          </div>

          {/* Done message */}
          {!llmLoading && completedSteps.size === SKILL_SECTIONS.length && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              All {SKILL_SECTIONS.length} sections rewritten. Copy SKILL.md or Download .zip to save.
            </p>
          )}
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
            activeSection={streamingSection}
            completedSections={completedSteps}
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

// SKILL.md section metadata — shown as inline annotations in the preview
const SKILL_SECTION_META: Record<string, { hint: string }> = {
  name: { hint: "Skill identifier used by agent frameworks" },
  description: { hint: "What this skill does — the agent reads this to decide when to use it" },
  usage: { hint: "How to invoke this skill in your agent prompt" },
  when_to_use: { hint: "Conditions and tasks this skill is best suited for" },
  directory_structure: { hint: "Repository layout — the agent uses this to navigate the codebase" },
  key_files: { hint: "Most important files — starting points for any task" },
  architecture: { hint: "High-level design patterns and component relationships" },
  dependencies: { hint: "External libraries and tools the repo relies on" },
};

// Map SkillSection → the markdown header text it produces in SKILL.md
const SECTION_HEADER_TEXT: Record<string, string> = {
  overview: "## Overview",
  capabilities: "## Capabilities",
  usage: "## Usage Instructions",
  boundaries: "## Boundaries",
};

const MarkdownPreview: React.FC<{
  content: string;
  activeSection?: string | null;
  completedSections?: Set<string>;
}> = ({ content, activeSection, completedSections }) => {
  if (!content) {
    return (
      <pre className="p-4 text-xs leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-words select-all">
        <span className="text-slate-600 italic">No SKILL.md content available.</span>
      </pre>
    );
  }

  // Determine the active header string (e.g. "## Overview") and whether
  // we're streaming the YAML description field.
  const activeHeader = activeSection ? SECTION_HEADER_TEXT[activeSection] ?? null : null;
  const isDescStreaming = activeSection === "description";
  const isDescDone = completedSections?.has("description") && !isDescStreaming;

  // Build a reverse-lookup: header text → SkillSection key
  const headerToSection: Record<string, string> = Object.fromEntries(
    Object.entries(SECTION_HEADER_TEXT).map(([k, v]) => [v, k])
  );

  const lines = content.split('\n');
  const rendered: React.ReactNode[] = [];

  // inActiveBlock: true while iterating lines inside the currently streaming section
  // inDoneBlock: true while iterating lines inside a completed section
  let inActiveBlock = isDescStreaming;
  let inDoneBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── YAML frontmatter key annotations ────────────────────────────────────
    const keyMatch = line.match(/^([a-z_]+):\s*(.*)$/);
    const meta = keyMatch ? SKILL_SECTION_META[keyMatch[1]] : null;

    // ── Section header detection ─────────────────────────────────────────────
    const isActiveSectionHeader = activeHeader && line.startsWith(activeHeader);
    const isAnyH2 = /^## /.test(line);

    if (isAnyH2) {
      const sectionKey = headerToSection[line.trim()];
      const isDoneSection = sectionKey ? (completedSections?.has(sectionKey) ?? false) : false;
      inActiveBlock = isActiveSectionHeader ? true : false;
      inDoneBlock = !inActiveBlock && isDoneSection;
    }

    // ── Detect cursor sentinel injected during streaming ─────────────────────
    const hasCursor = line.includes('█');
    const displayLine = hasCursor ? line.replace(/█/g, '') : line;

    const isDescLine = isDescStreaming && line.includes('description:');
    const isDescDoneLine = isDescDone && line.includes('description:');

    // Determine key label color: yellow when actively streaming desc, green when done, white otherwise
    const keyLabelColor = isDescLine
      ? '#fbbf24'
      : isDescDoneLine
        ? '#34d399'
        : inActiveBlock
          ? '#fbbf24'
          : inDoneBlock
            ? '#34d399'
            : '#cbd5e1';

    const hintColor = isDescLine
      ? '#fbbf24'
      : isDescDoneLine
        ? '#34d399'
        : inActiveBlock
          ? '#fbbf24'
          : inDoneBlock
            ? '#34d399'
            : '#64748b';

    const baseStyle: React.CSSProperties = inActiveBlock
      ? { display: 'block', background: 'rgba(251,191,36,0.07)' }
      : inDoneBlock
        ? { display: 'block', background: 'rgba(52,211,153,0.05)' }
        : { display: 'block' };

    rendered.push(
      <span key={i} style={baseStyle}>
        {meta ? (
          <span>
            <span style={{ color: keyLabelColor, fontWeight: 600 }}>{keyMatch![1]}</span>
            <span style={{ color: '#64748b' }}>:</span>
            {keyMatch![2] && (
              <span style={{
                color: isDescLine ? '#fde68a' : isDescDoneLine ? '#6ee7b7' : '#cbd5e1',
                background: isDescLine ? 'rgba(251,191,36,0.15)' : isDescDoneLine ? 'rgba(52,211,153,0.08)' : undefined,
                outline: isDescLine ? '1px solid rgba(251,191,36,0.40)' : isDescDoneLine ? '1px solid rgba(52,211,153,0.30)' : undefined,
                borderRadius: (isDescLine || isDescDoneLine) ? '3px' : undefined,
              }}> {displayLine.slice(keyMatch![1].length + 1).trimStart()}</span>
            )}
            <span style={{ marginLeft: '10px', fontSize: '9px', color: hintColor, opacity: 0.55, fontStyle: 'italic', letterSpacing: '0.02em' }}>
              → {meta.hint}
            </span>
          </span>
        ) : isActiveSectionHeader ? (
          <span style={{
            display: 'block', color: '#fbbf24', fontWeight: 700,
            background: 'rgba(251,191,36,0.12)', outline: '1px solid rgba(251,191,36,0.45)',
            borderLeft: '3px solid rgba(251,191,36,0.7)',
            borderRadius: '3px', paddingLeft: '6px', marginLeft: '-6px',
          }}>
            {displayLine}
          </span>
        ) : inDoneBlock && isAnyH2 ? (
          // Completed section header — subtle green glow
          <span style={{
            display: 'block', color: '#34d399', fontWeight: 700,
            background: 'rgba(52,211,153,0.08)', outline: '1px solid rgba(52,211,153,0.30)',
            borderLeft: '3px solid rgba(52,211,153,0.6)',
            borderRadius: '3px', paddingLeft: '6px', marginLeft: '-6px',
          }}>
            {displayLine}
          </span>
        ) : (
          <span style={{ color: inActiveBlock ? '#e2e8f0' : '#94a3b8' }}>
            {displayLine || '\u00a0'}
            {hasCursor && (
              <span style={{
                display: 'inline-block',
                width: '0.5em',
                height: '1em',
                background: 'rgba(251,191,36,0.9)',
                borderRadius: '1px',
                marginLeft: '1px',
                verticalAlign: 'text-bottom',
                animation: 'skillCursorBlink 0.7s steps(1) infinite',
              }} />
            )}
          </span>
        )}
      </span>
    );
  }

  return (
    <>
      <pre className="p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words select-all">
        {rendered}
      </pre>
      <style>{`@keyframes skillCursorBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }`}</style>
    </>
  );
};


