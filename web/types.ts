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
  primary_languages?: string[];
  readme?: string;
  file_structure?: string;
}

export interface SkillManifest {
  schema_version: string;
  name: string;
  display_name: string;
  description: string;
  version: string;
  capabilities: string[];
  framework_compatibility: string[];
  files: {
    instructions: string;
    knowledge_base: string;
  };
  metadata: {
    source_repo: string;
    generated_by: string;
    generated_by_url: string;
    generated_at: string;
    files_analyzed: number;
    primary_languages: string[];
  };
}