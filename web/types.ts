// Author: Joao Machete
// Description: TypeScript type definitions and interfaces for GitHub API data structures, D3 diagram nodes, chat messages, and local storage caching. Used for type safety and data modeling across the application.

export interface GithubRepoInfo {
  owner: string;
  repo: string;
}

export interface GithubFile {
  path: string;
  type: 'blob' | 'tree' | string; // Allow other types if API returns them
  sha: string;
  size?: number; // Size is not always present for tree objects or if not requested
  url: string;
}

// For GitHub API response for repo details
export interface GitHubRepoDetails {
  default_branch: string;
  // other properties...
}

// For GitHub API response for file content
export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: string; // "file", "dir", etc.
  content?: string; // Base64 encoded content
  encoding?: string; // "base64"
  _links: {
    self: string;
    git: string;
    html: string;
  };
}

// For GitHub API response for tree
export interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GithubFile[];
  truncated: boolean;
}



// Types for D3 Diagram
export interface GithubTreeItem {
  path: string;
  type: 'blob' | 'tree'; // Or 'file' | 'directory' if normalized earlier
  size?: number;
  // Potentially other fields if needed by transformation logic
}

export interface RawDiagramNode {
  id: string; // Unique identifier for the node (e.g., path)
  name: string; // Display name (e.g., file or directory name)
  type: 'directory' | 'file';
  path: string; // Full path from the repository root
  children?: RawDiagramNode[]; // Used by D3 for hierarchy generation
  data?: GithubTreeItem; // Optional: original data item (like GithubFile)
  value?: number; // Optional: for sizing nodes in visualizations like treemaps
  // Removed D3 layout properties: x, y, x0, y0, depth, parent, _children
  // These are added by D3 to its wrapper nodes or managed by AppHierarchyPointNode.
}



// Interface for data cached in localStorage
export interface CachedRepoOutput {
  digest: string;
  processedRepoName: string;
  repoNameForFilename: string | null;
  defaultBranch: string | null;
  filesAnalyzedCount: number | null;
  filesToRenderInDiagram: GithubFile[];
  timestamp: number;
  // Skill fields (optional for backward compat with older cache entries)
  skill_md?: string;
  manifest_json?: SkillManifest;
  references?: SkillReferences;
  scan_report?: ScanReport;
  primary_languages?: string[];
  readme?: string;
  file_structure?: string;
  structure_overview?: string;
}

// SkillForge security scan report (deterministic, gates export)
export type ScanStatus = "PASS" | "WARN" | "FAIL";

export interface ScanFinding {
  rule: string;
  severity: string;
  file: string;
  line: number;
  source_path?: string | null;
  snippet: string;
  message: string;
}

export interface ScanReport {
  status: ScanStatus;
  findings: ScanFinding[];
}

// references/*.md content, keyed by package-relative path (e.g. "references/api.md")
export type SkillReferences = Record<string, string>;



// Framework Engineering Skill — 6-section canonical anatomy returned by /skill/framework
export interface FrameworkProcessStep {
  title: string;
  content: string;
}

export interface FrameworkRationalization {
  excuse: string;
  reality: string;
}

export interface FrameworkSkillContent {
  description?: string;
  overview?: string;
  when_to_use: string[];
  when_not_to_use?: string;
  core_process: FrameworkProcessStep[];
  common_rationalizations: FrameworkRationalization[];
  red_flags: string[];
  verification: string[];
}

export interface SkillManifest {
  schema_version: string;
  name: string;
  display_name: string;
  description: string;
  version: string;
  builder_version?: string;
  digest_hash?: string;
  files?: string[];
  provenance?: { chunk: string; source_paths: string[] }[];
  scan_status?: ScanStatus;
  framework_compatibility: string[];
  metadata: {
    source_repo: string;
    generated_by: string;
    generated_by_url?: string;
    generated_at: string;
    files_analyzed: number;
    primary_languages: string[];
    symbols_indexed?: number;
    modules_indexed?: number;
  };
}