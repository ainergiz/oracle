/**
 * NotebookLM Browser Automation Types
 */

import type { BrowserLogger, BrowserAttachment, BrowserRunResult, CookieParam } from '../browser/types.js';
import type { BrowserRuntimeMetadata } from '../sessionStore.js';

export type { BrowserLogger, BrowserAttachment, CookieParam };

// Artifact types
export type ArtifactType = 'slides' | 'audio' | 'video' | 'infographic';

// Slide options
export type SlideAudience = 'technical' | 'investor' | 'customer' | 'executive' | 'beginner';
export type SlideFormat = 'detailed' | 'presenter';
export type SlideLength = 'short' | 'default' | 'long';

export interface SlideOptions {
  /** Target audience for the slides */
  audience?: SlideAudience;
  /** Slide format type */
  format?: SlideFormat;
  /** Slide deck length */
  length?: SlideLength;
  /** Custom prompt (overrides audience preset) */
  customPrompt?: string;
}

// Audio options
export type AudioFormat = 'deep-dive' | 'brief' | 'critique' | 'debate';

export interface AudioOptions {
  /** Podcast format style */
  format?: AudioFormat;
  /** Language code (e.g., 'en-US', 'es-ES', 'ja-JP') */
  language?: string;
  /** Custom instructions for audio generation */
  customPrompt?: string;
}

// Video options
export type VideoFormat = 'brief' | 'explainer';
export type VideoTheme = 'retro-90s' | 'futuristic' | 'corporate' | 'minimal';

export interface VideoOptions {
  /** Video format/length */
  format?: VideoFormat;
  /** Visual theme preset */
  theme?: VideoTheme;
  /** Custom theme description (overrides preset) */
  customTheme?: string;
  /** Custom instructions for video generation */
  customPrompt?: string;
}

// Infographic options
export type InfographicOrientation = 'square' | 'portrait' | 'landscape';
export type InfographicDetail = 'concise' | 'standard' | 'detailed';

export interface InfographicOptions {
  /** Aspect ratio orientation */
  orientation?: InfographicOrientation;
  /** Information density level */
  detail?: InfographicDetail;
  /** Custom instructions for infographic generation */
  customPrompt?: string;
}

// Unified generation options (pass one based on artifact type)
export interface NotebookLMGenerationOptions {
  slides?: SlideOptions;
  audio?: AudioOptions;
  video?: VideoOptions;
  infographic?: InfographicOptions;
}

// Browser configuration (mirrors GeminiBrowserConfig pattern)
export interface NotebookLMBrowserConfig {
  /** Chrome profile name or path */
  chromeProfile?: string | null;
  /** Path to Chrome executable */
  chromePath?: string | null;
  /** Path to Chrome cookies database */
  chromeCookiePath?: string | null;
  /** Target URL (defaults to notebooklm.google.com) */
  url?: string;
  /** Overall timeout in ms */
  timeoutMs?: number;
  /** Chrome DevTools debugging port */
  debugPort?: number | null;
  /** Timeout for page ready state */
  inputTimeoutMs?: number;
  /** Whether to sync cookies from Chrome profile */
  cookieSync?: boolean;
  /** Specific cookie names to sync */
  cookieNames?: string[] | null;
  /** Inline cookies to use instead of Chrome profile */
  inlineCookies?: CookieParam[] | null;
  /** Source description for inline cookies */
  inlineCookiesSource?: string | null;
  /** Run browser in headless mode */
  headless?: boolean;
  /** Keep browser open after completion */
  keepBrowser?: boolean;
  /** Hide browser window (macOS) */
  hideWindow?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** Allow cookie sync errors without failing */
  allowCookieErrors?: boolean;
  /** Remote Chrome connection */
  remoteChrome?: { host: string; port: number } | null;
  /** Manual login mode (keep browser visible for user to sign in) */
  manualLogin?: boolean;
  /** Directory for manual login Chrome profile */
  manualLoginProfileDir?: string | null;
  /** Sync cookies even in manual login mode */
  manualLoginCookieSync?: boolean;
  /** Output directory for downloaded artifacts */
  outputDir?: string;
}

// Notebook mode
export type NotebookMode = 'existing' | 'createNew';

// Run options
export interface NotebookLMRunOptions {
  /** Mode: use existing notebook or create new one */
  mode?: NotebookMode;
  /** NotebookLM notebook URL (required if mode='existing') */
  notebookUrl?: string;
  /** Type of artifact to generate */
  artifactType: ArtifactType;
  /** Generation options for the specific artifact type */
  options?: NotebookLMGenerationOptions;
  /** Source files to upload to notebook (for createNew mode or to add to existing) */
  sourceFiles?: string[];
  /** Browser configuration */
  config?: NotebookLMBrowserConfig;
  /** Logger function */
  log?: BrowserLogger;
  /** Callback to persist runtime info */
  runtimeHintCb?: (hint: BrowserRuntimeMetadata) => void | Promise<void>;
}

// Artifact download result
export interface ArtifactDownloadResult {
  /** Final filename on disk */
  filename: string;
  /** Full path to downloaded file */
  path: string;
  /** Original suggested filename from download */
  suggestedFilename: string;
  /** Type of artifact that was downloaded */
  artifactType: ArtifactType;
}

// Artifact status for monitoring
export interface ArtifactStatus {
  /** Total count of artifacts of this type */
  totalCount: number;
  /** Count still loading (shimmer animation active) */
  loadingCount: number;
  /** Count ready (generation complete) */
  readyCount: number;
}

// Run result
export interface NotebookLMRunResult extends BrowserRunResult {
  /** Downloaded artifact information */
  artifact?: ArtifactDownloadResult;
  /** Type of artifact that was generated */
  artifactType: ArtifactType;
  /** Time taken for generation in ms */
  generationTimeMs: number;
  /** Whether the notebook was ready before generation */
  notebookReady: boolean;
  /** Error message if generation failed */
  error?: string;
}

// Login probe result
export interface NotebookLMLoginProbeResult {
  /** Whether user is logged in */
  ok: boolean;
  /** Current page URL */
  pageUrl?: string | null;
  /** Whether on Google auth page */
  onAuthPage?: boolean;
  /** Error message if any */
  error?: string | null;
}
