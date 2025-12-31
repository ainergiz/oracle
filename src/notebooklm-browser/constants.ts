/**
 * NotebookLM Browser Automation Constants
 * Selectors and configuration for automating notebooklm.google.com
 */

import type { SlideAudience, ArtifactType } from './types.js';

// URLs
export const NOTEBOOKLM_URL = 'https://notebooklm.google.com';
export const NOTEBOOKLM_BASE_URL = 'https://notebooklm.google.com';

// Cookie URLs for Google authentication (shared with Gemini)
export const NOTEBOOKLM_COOKIE_URLS = [
  'https://notebooklm.google.com',
  'https://accounts.google.com',
  'https://www.google.com',
];

// Timeouts (in milliseconds)
export const NOTEBOOKLM_TIMEOUTS = {
  navigation: 45_000,
  login: 120_000,
  pageReady: 30_000,
  slidesGeneration: 180_000,        // 3 min for slides
  infographicGeneration: 180_000,   // 3 min for infographics
  audioGeneration: 600_000,         // 10 min for podcasts
  videoGeneration: 900_000,         // 15 min for videos
  downloadReady: 60_000,
  artifactPoll: 2_000,              // Poll interval for checking artifact status
  uploadModal: 30_000,              // Wait for upload modal to close
};

// Get timeout for artifact type
export function getArtifactTimeout(artifactType: ArtifactType): number {
  switch (artifactType) {
    case 'slides':
      return NOTEBOOKLM_TIMEOUTS.slidesGeneration;
    case 'audio':
      return NOTEBOOKLM_TIMEOUTS.audioGeneration;
    case 'video':
      return NOTEBOOKLM_TIMEOUTS.videoGeneration;
    case 'infographic':
      return NOTEBOOKLM_TIMEOUTS.infographicGeneration;
    default:
      return NOTEBOOKLM_TIMEOUTS.slidesGeneration;
  }
}

// Artifact button selectors (to find existing artifacts)
export const ARTIFACT_SELECTORS: Record<ArtifactType, string> = {
  slides: "button[aria-description='Slides']",
  audio: "button[aria-description='Audio Overview']",
  infographic: "button[aria-description='Infographic']",
  video: "button[aria-description='Video']",
};

// Edit button selectors (to open customization dialog)
// Multiple fallbacks for UI variations
export const ARTIFACT_EDIT_SELECTORS: Record<ArtifactType, string[]> = {
  slides: [
    "button[aria-label='Customise slide deck']",
    "button[aria-label='Customize slide deck']",
    "button.edit-button[data-edit-button-type='8']",
    ".create-artifact-button-container[aria-label='Slide deck'] button.edit-button",
    "button.edit-button:has-text('Slides')",
  ],
  audio: [
    "button[aria-label='Customise audio overview']",
    "button[aria-label='Customize audio overview']",
    ".create-artifact-button-container[aria-label='Audio Overview'] button.edit-button",
    "button.edit-button:has-text('Audio')",
  ],
  video: [
    "button[aria-label='Customise video overview']",
    "button[aria-label='Customize video overview']",
    ".create-artifact-button-container[aria-label='Video'] button.edit-button",
    "button.edit-button:has-text('Video')",
  ],
  infographic: [
    "button[aria-label='Customise infographic']",
    "button[aria-label='Customize infographic']",
    ".create-artifact-button-container[aria-label='Infographic'] button.edit-button",
    "button.edit-button:has-text('Infographic')",
  ],
};

// Material Design component selectors
export const MATERIAL_SELECTORS = {
  dialog: 'mat-dialog-container',
  radioButton: 'mat-radio-button',
  buttonToggle: 'mat-button-toggle',
  buttonToggleGroup: 'mat-button-toggle-group',
  select: 'mat-select',
  option: 'mat-option',
  textarea: 'textarea',
  input: 'input',
};

// Dialog selectors
export const DIALOG_SELECTORS = {
  customizeDialog: "mat-dialog-container:has-text('Customise'), mat-dialog-container:has-text('Customize')",
  generateButton: "mat-dialog-container button:has-text('Generate')",
  cancelButton: "mat-dialog-container button:has-text('Cancel')",
  textarea: 'mat-dialog-container textarea',
};

// Shimmer loading detection (NotebookLM uses shimmer animation during generation)
export const SHIMMER_SELECTOR = '.artifact-item-button.shimmer';
export const ARTIFACT_CONTAINER_SELECTOR = '.artifact-item-button';

// Download menu selectors
export const DOWNLOAD_SELECTORS = {
  moreButton: [
    'button.artifact-more-button',
    "button[aria-label='More']",
    "button[aria-label='More options']",
  ],
  downloadButton: [
    "button:has-text('Download')",
    "[role='menuitem']:has-text('Download')",
  ],
  menu: "[role='menu']",
};

// Upload source selectors
export const UPLOAD_SELECTORS = {
  uploadButton: [
    "button[aria-label='Upload sources from your computer']",
    "button[aria-label='Opens the upload source dialogue']",
    "button:has-text('Upload a source')",
    "button:has-text('Add source')",
  ],
  fileInput: "input[type='file']",
  sourceModal: "[role='dialog']:has-text('Add sources')",
};

// Google consent/login selectors
export const CONSENT_SELECTORS = {
  acceptAll: "button:has-text('Accept all')",
  rejectAll: "button:has-text('Reject all')",
  signIn: "button:has-text('Sign in'), a:has-text('Sign in')",
};

// Login detection selectors
export const LOGIN_SELECTORS = [
  'a[href*="ServiceLogin"]',
  "button:has-text('Sign in')",
  "a:has-text('Sign in')",
  '[data-identifier]',
  '.account-picker',
  '[aria-label*="Google Account"]',
  'img[alt*="profile"]',
];

// Slide-specific selectors
export const SLIDE_SELECTORS = {
  formatOptions: {
    detailed: "mat-radio-button:has-text('Detailed deck'), mat-radio-button:has-text('Detailed')",
    presenter: "mat-radio-button:has-text('Presenter slides'), mat-radio-button:has-text('Presenter')",
  },
  lengthOptions: {
    short: "mat-button-toggle:has-text('Short')",
    default: "mat-button-toggle:has-text('Default')",
    long: "mat-button-toggle:has-text('Long')",
  },
};

// Audio-specific selectors
export const AUDIO_SELECTORS = {
  formatOptions: {
    'deep-dive': "mat-radio-button:has-text('Deep dive')",
    brief: "mat-radio-button:has-text('Brief')",
    critique: "mat-radio-button:has-text('Critique')",
    debate: "mat-radio-button:has-text('Debate')",
  },
  languageDropdown: "mat-select[aria-label*='language'], mat-select:has-text('Language')",
  languageOption: (lang: string) => `mat-option:has-text('${lang}')`,
};

// Video-specific selectors
export const VIDEO_SELECTORS = {
  formatOptions: {
    brief: "mat-radio-button:has-text('Brief'), mat-button-toggle:has-text('Brief')",
    explainer: "mat-radio-button:has-text('Explainer'), mat-button-toggle:has-text('Explainer')",
  },
  themeOptions: {
    'retro-90s': "mat-radio-button:has-text('Retro'), mat-button-toggle:has-text('Retro')",
    futuristic: "mat-radio-button:has-text('Futuristic'), mat-button-toggle:has-text('Futuristic')",
    corporate: "mat-radio-button:has-text('Corporate'), mat-button-toggle:has-text('Corporate')",
    minimal: "mat-radio-button:has-text('Minimal'), mat-button-toggle:has-text('Minimal')",
  },
  themeInput: "mat-dialog-container input[placeholder*='theme'], mat-dialog-container textarea",
};

// Infographic-specific selectors
export const INFOGRAPHIC_SELECTORS = {
  orientationOptions: {
    square: "mat-button-toggle:has-text('Square'), mat-radio-button:has-text('Square')",
    portrait: "mat-button-toggle:has-text('Portrait'), mat-radio-button:has-text('Portrait')",
    landscape: "mat-button-toggle:has-text('Landscape'), mat-radio-button:has-text('Landscape')",
  },
  detailOptions: {
    concise: "mat-button-toggle:has-text('Concise'), mat-radio-button:has-text('Concise')",
    standard: "mat-button-toggle:has-text('Standard'), mat-radio-button:has-text('Standard')",
    detailed: "mat-button-toggle:has-text('Detailed'), mat-radio-button:has-text('Detailed')",
  },
};

// Predefined audience prompts for slides
export const SLIDE_AUDIENCE_PROMPTS: Record<SlideAudience, string> = {
  technical:
    'Create a detailed technical presentation for engineers and developers. Focus on architecture, implementation details, technical specifications, and code examples where relevant.',
  investor:
    'Create a compelling investor pitch deck. Focus on market opportunity, business model, competitive advantages, traction metrics, and financial projections.',
  customer:
    'Create a customer-facing presentation that focuses on benefits and value proposition. Emphasize how the product solves problems, ease of use, and success stories.',
  executive:
    'Create an executive summary presentation for C-level stakeholders. Focus on strategic value, ROI, key metrics, and high-level roadmap without technical details.',
  beginner:
    'Create an introductory presentation for beginners with no prior knowledge. Cover fundamentals step-by-step with simple examples and clear explanations.',
};

// Supported languages for audio generation (subset - full list has 80+)
export const AUDIO_SUPPORTED_LANGUAGES = [
  'en-US',  // English (US)
  'en-GB',  // English (UK)
  'en-AU',  // English (Australia)
  'es-ES',  // Spanish (Spain)
  'es-MX',  // Spanish (Mexico)
  'fr-FR',  // French
  'de-DE',  // German
  'it-IT',  // Italian
  'pt-BR',  // Portuguese (Brazil)
  'pt-PT',  // Portuguese (Portugal)
  'ja-JP',  // Japanese
  'ko-KR',  // Korean
  'zh-CN',  // Chinese (Simplified)
  'zh-TW',  // Chinese (Traditional)
  'ru-RU',  // Russian
  'ar-SA',  // Arabic
  'hi-IN',  // Hindi
  'nl-NL',  // Dutch
  'pl-PL',  // Polish
  'sv-SE',  // Swedish
  'da-DK',  // Danish
  'fi-FI',  // Finnish
  'no-NO',  // Norwegian
  'tr-TR',  // Turkish
  'th-TH',  // Thai
  'vi-VN',  // Vietnamese
  'id-ID',  // Indonesian
  'ms-MY',  // Malay
  'tl-PH',  // Filipino/Tagalog
  'uk-UA',  // Ukrainian
  'cs-CZ',  // Czech
  'el-GR',  // Greek
  'he-IL',  // Hebrew
  'hu-HU',  // Hungarian
  'ro-RO',  // Romanian
  'sk-SK',  // Slovak
  'bg-BG',  // Bulgarian
  'hr-HR',  // Croatian
  'sr-RS',  // Serbian
  'sl-SI',  // Slovenian
  'ca-ES',  // Catalan
  'eu-ES',  // Basque
  'gl-ES',  // Galician
] as const;

// Video theme descriptions (used for custom theme context)
export const VIDEO_THEME_DESCRIPTIONS = {
  'retro-90s': 'Nostalgic 90s aesthetic with bold colors and retro graphics',
  futuristic: 'Modern sci-fi inspired with sleek animations and neon accents',
  corporate: 'Professional business style with clean design and subtle branding',
  minimal: 'Clean minimalist design with subtle animations and focused content',
} as const;

// Infographic orientation descriptions
export const INFOGRAPHIC_ORIENTATION_DESCRIPTIONS = {
  square: '1:1 aspect ratio - ideal for social media posts',
  portrait: '9:16 vertical - ideal for Instagram Stories, TikTok',
  landscape: '16:9 horizontal - ideal for LinkedIn, presentations',
} as const;

// Homepage selectors (for creating new notebooks)
export const HOMEPAGE_SELECTORS = {
  createButton: [
    "button[aria-label='Create new notebook']",
    '.create-new-button',
    "button:has-text('Create')",
    '.create-upsell-wrapper button',
  ],
  notebookList: '.notebook-list',
  recentNotebooks: '.recent-notebooks',
};

// Source upload selectors (for adding sources to notebook)
export const SOURCE_UPLOAD_SELECTORS = {
  uploadButton: [
    "button[aria-label='Upload sources from your computer']",
    "button[aria-label='Opens the upload source dialogue']",
    "button:has-text('Add source')",
    "button:has-text('Upload')",
  ],
  fileInput: "input[type='file']",
  uploadModal: "[role='dialog']:has-text('Add sources')",
  processingIndicator: '.source-processing, .loading-indicator',
  sourceItem: '.source-item, .source-card',
};

// Default configuration values
export const DEFAULT_CONFIG = {
  artifactType: 'slides' as ArtifactType,
  mode: 'existing' as const,
  slideAudience: 'technical' as SlideAudience,
  slideFormat: 'detailed' as const,
  slideLength: 'default' as const,
  audioFormat: 'deep-dive' as const,
  audioLanguage: 'en-US',
  videoFormat: 'explainer' as const,
  videoTheme: 'corporate' as const,
  infographicOrientation: 'landscape' as const,
  infographicDetail: 'standard' as const,
};
