/**
 * Shared test configuration — single source of truth for scenario defaults.
 */

/** Default artifacts directory for exported game builds */
export const DEFAULT_ARTIFACTS_DIR =
  'C:\\lunar-horse\\contract-projects\\vampire-mini\\project\\hosts\\complete-app\\build\\_artifacts\\latest\\windows_debug_x86_64'

/** Resolve artifacts directory from env or default */
export const ARTIFACTS = process.env.ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR
