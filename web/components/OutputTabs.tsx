import React from 'react';
import { DigestOutput } from './DigestOutput';
import { Diagram } from './Diagram';
import { SkillExport } from './SkillExport';
import { RawDiagramNode, SkillManifest } from '../types';

interface OutputTabsProps {
  digest: string;
  isLoadingDigest: boolean;

  diagramData: RawDiagramNode | null;
  repoName: string;
  repoNameForFilename: string | null;
  defaultBranch: string | null;

  onOpenDiagramFullscreenModal: (data: RawDiagramNode, repoName: string, defaultBranch: string | null) => void;

  skillMd?: string;
  manifestJson?: SkillManifest | null;
  repoUrl?: string;
  githubToken?: string | null;
  repoReadme?: string;
  repoFileStructure?: string;
}

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  accentClass: string;
  dotClass: string;
}> = ({ icon, title, accentClass, dotClass }) => (
  <div className="flex items-center gap-3 mb-5">
    <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${dotClass} shrink-0`}>
      {icon}
    </span>
    <h2 className={`text-base font-semibold tracking-tight ${accentClass}`}>{title}</h2>
    <div className="flex-1 h-px bg-slate-700/60" />
  </div>
);

const CodeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
  </svg>
);

const DiagramIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
  </svg>
);

const SkillIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
  </svg>
);

export const OutputTabs: React.FC<OutputTabsProps> = ({
  digest,
  isLoadingDigest,
  diagramData,
  repoName,
  repoNameForFilename,
  defaultBranch,
  onOpenDiagramFullscreenModal,
  skillMd,
  manifestJson,
  repoUrl,
  githubToken,
  repoReadme,
  repoFileStructure,
}) => {
  return (
    <div className="mt-8 flex flex-col gap-8">

      {/* ── Code Digest + Code Visualization (responsive row) ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

        {/* Code Digest */}
        <section
          id="section-code-digest"
          className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-lg shadow-xl border border-slate-700 h-full"
        >
          <SectionHeader
            icon={<CodeIcon />}
            title="Code Digest"
            accentClass="text-violet-400"
            dotClass="bg-violet-500/15 text-violet-400"
          />
          <DigestOutput
            digest={digest}
            isLoading={isLoadingDigest}
            repoNameForFilename={repoNameForFilename}
          />
        </section>

        {/* Code Visualization */}
        <section
          id="section-code-visualization"
          className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-lg shadow-xl border border-slate-700 h-full"
        >
          <SectionHeader
            icon={<DiagramIcon />}
            title="Code Visualization"
            accentClass="text-green-400"
            dotClass="bg-green-500/15 text-green-400"
          />
          <div className="h-[500px] lg:h-[calc(100%-3.5rem)] min-h-[400px] w-full">
            {diagramData && repoName && defaultBranch ? (
              <Diagram
                data={diagramData}
                repoName={repoName}
                defaultBranch={defaultBranch}
                onOpenFullscreenModal={onOpenDiagramFullscreenModal}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                Visualization data not available or still loading.
              </div>
            )}
          </div>
        </section>

      </div>

      {/* ── Skill Export ──────────────────────────────────────────────── */}
      <section
        id="section-skill-export"
        className="bg-slate-800/80 backdrop-blur-sm p-6 rounded-lg shadow-xl border border-slate-700"
      >
        <SectionHeader
          icon={<SkillIcon />}
          title="Agent Skill"
          accentClass="text-amber-400"
          dotClass="bg-amber-500/15 text-amber-400"
        />
        {skillMd ? (
          <SkillExport
            skillMd={skillMd}
            manifestJson={manifestJson ?? null}
            repoUrl={repoUrl ?? ""}
            repoNameForFilename={repoNameForFilename}
            githubToken={githubToken ?? null}
            digest={digest}
            repoReadme={repoReadme ?? ""}
            repoFileStructure={repoFileStructure ?? ""}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
            <span className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/10 text-amber-500/60">
              <SkillIcon />
            </span>
            <p className="text-sm">Generate a digest first to preview the Agent Skill.</p>
          </div>
        )}
      </section>

    </div>
  );
};
