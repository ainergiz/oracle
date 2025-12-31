/**
 * NotebookLM Browser Automation - Page Actions Re-exports
 *
 * Convenience re-exports for all action modules
 */

// Navigation
export {
  navigateToNotebook,
  handleGoogleConsent,
  ensureNotebookLMLoggedIn,
  ensureNotebookReady,
  probeNotebookLMLogin,
} from './actions/navigation.js';

// Notebook Creation
export {
  navigateToHomepage,
  clickCreateButton,
  isUploadDialogVisible,
  closeUploadDialog,
  waitForNewNotebookReady,
  uploadSources,
  uploadSourcesWithInput,
  waitForUploadDialogClose,
  waitForSourceProcessing,
  handleUploadDialog,
  createNewNotebook,
} from './actions/notebookCreation.js';

// Artifact Monitoring
export {
  countArtifacts,
  isArtifactLoading,
  getArtifactStatus,
  waitForArtifactReady,
  waitForMultipleArtifactsReady,
  getArtifactInfo,
} from './actions/artifactMonitor.js';

// Dialog Interaction
export {
  openCustomizeDialog,
  waitForDialog,
  selectRadioOption,
  selectToggleOption,
  selectDropdownOption,
  fillDialogTextarea,
  fillDialogInput,
  clickGenerateButton,
  closeDialog,
  isDialogOpen,
} from './actions/dialogInteraction.js';

// Download Handler
export {
  setupDownloadDirectory,
  triggerArtifactDownload,
  waitForDownload,
  downloadLatestArtifact,
  downloadAllArtifacts,
} from './actions/downloadHandler.js';

// Generation Workflows
export { generateSlides, generateSlidesForAudiences } from './actions/slideGeneration.js';
export { generateAudio } from './actions/audioGeneration.js';
export { generateVideo, generateVideoWithTheme } from './actions/videoGeneration.js';
export { generateInfographic, generateInfographicsForOrientations } from './actions/infographicGeneration.js';
