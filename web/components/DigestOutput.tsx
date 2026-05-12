import React, { useState, useEffect, useMemo } from 'react';
import { LoadingSpinner } from './LoadingSpinner';

interface DigestOutputProps {
  digest: string;
  isLoading: boolean;
  repoNameForFilename: string | null;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v3.75c0 .621-.504 1.125-1.125 1.125h-4.5c-.621 0-1.125-.504-1.125-1.125V5.25c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.25c0-1.108.806-2.057 1.907-2.25a48.208 48.208 0 011.927-.184" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const FileIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

const LinesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
  </svg>
);

const SizeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 6c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
  </svg>
);

const FormatIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
  </svg>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildFilename(repoNameForFilename: string | null): string {
  let filenamePart = 'digest';
  if (repoNameForFilename) {
    let name = repoNameForFilename;
    name = name.replace(/-/g, '_');
    name = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
    name = name.replace(/([a-z\d])([A-Z])/g, '$1_$2');
    name = name.toLowerCase();
    filenamePart = name;
  }
  return `git_scape_${filenamePart}_digest.txt`;
}

interface DigestStats {
  filesAnalyzed: number | null;
  lineCount: number;
  sizeBytes: number;
}

function parseStats(digest: string): DigestStats {
  const header = digest.slice(0, 500);
  const match = header.match(/Files analyzed:\s*(\d+)/i);
  return {
    filesAnalyzed: match ? parseInt(match[1], 10) : null,
    lineCount: (digest.match(/\n/g) ?? []).length + 1,
    sizeBytes: new TextEncoder().encode(digest).length,
  };
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
}> = ({ icon, label, value }) => (
  <div className="flex flex-col gap-1.5 bg-slate-900/50 border border-slate-700/60 rounded-lg px-4 py-3">
    <div className="flex items-center gap-1.5 text-slate-500">
      {icon}
      <span className="text-[10px] font-semibold uppercase tracking-widest">{label}</span>
    </div>
    <span className="text-xl font-bold text-slate-100 tabular-nums">{value}</span>
  </div>
);

// ─── Component ────────────────────────────────────────────────────────────────

const DigestOutputComponent: React.FC<DigestOutputProps> = ({
  digest,
  isLoading,
  repoNameForFilename,
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const stats = useMemo<DigestStats | null>(
    () => (digest ? parseStats(digest) : null),
    [digest]
  );

  const filename = useMemo(() => buildFilename(repoNameForFilename), [repoNameForFilename]);

  const handleCopy = () => {
    if (!digest) return;
    navigator.clipboard.writeText(digest).then(() => setCopied(true)).catch(console.error);
  };

  const handleDownload = () => {
    if (!digest) return;
    const blob = new Blob([digest], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-500">
        <LoadingSpinner className="h-8 w-8 text-violet-400" />
        <p className="text-sm">Generating digest…</p>
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (!digest) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-500 border border-dashed border-slate-700 rounded-xl">
        <span className="flex items-center justify-center w-10 h-10 rounded-full bg-violet-500/10 text-violet-500/60">
          <FileIcon />
        </span>
        <p className="text-sm">No digest generated yet.</p>
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  // Preview: first ~40 lines, trimmed
  const previewLines = digest.split('\n').slice(0, 40);

  return (
    <div className="flex flex-col gap-5">

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {stats?.filesAnalyzed != null && (
          <StatTile icon={<FileIcon />} label="Files analyzed" value={stats.filesAnalyzed.toLocaleString()} />
        )}
        <StatTile icon={<LinesIcon />} label="Lines" value={stats?.lineCount.toLocaleString() ?? '—'} />
        <StatTile icon={<SizeIcon />} label="Size" value={stats ? formatBytes(stats.sizeBytes) : '—'} />
        <StatTile icon={<FormatIcon />} label="Format" value="Plain text" />
      </div>

      {/* Preview pane */}
      <div className="rounded-xl overflow-hidden border border-slate-700/60 bg-slate-950">
        {/* Pane toolbar */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 border-b border-slate-700/50">
          <div className="flex items-center gap-2 text-slate-500">
            <FileIcon />
            <span className="text-xs font-mono">{filename}</span>
          </div>
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/50" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-52 relative">
          <table className="w-full border-collapse text-xs font-mono leading-relaxed">
            <tbody>
              {previewLines.map((line, i) => (
                <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                  <td className="select-none text-right pr-4 pl-3 py-0.5 text-slate-600 w-10 border-r border-slate-800">
                    {i + 1}
                  </td>
                  <td className="pl-4 pr-3 py-0.5 text-slate-300 whitespace-pre">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Fade-out gradient */}
          <div className="sticky bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          id="digest-download-btn"
          onClick={handleDownload}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-all duration-150 shadow-md hover:shadow-violet-500/20 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900"
        >
          <DownloadIcon />
          Download
        </button>

        <button
          id="digest-copy-btn"
          onClick={handleCopy}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 border ${
            copied
              ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400 focus:ring-emerald-500'
              : 'bg-slate-700/50 hover:bg-slate-700 border-slate-600 text-slate-300 hover:text-slate-100 focus:ring-violet-500'
          }`}
        >
          {copied ? <><CheckIcon />Copied!</> : <><CopyIcon />Copy</>}
        </button>

        <span className="ml-auto text-[11px] text-slate-600 font-mono hidden sm:block">
          {stats?.lineCount.toLocaleString()} lines · {stats ? formatBytes(stats.sizeBytes) : '—'}
        </span>
      </div>

    </div>
  );
};

export const DigestOutput = React.memo(DigestOutputComponent);