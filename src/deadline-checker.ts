/**
 * Deadline Checker for Mission Control Bot
 *
 * Runs periodically to check for missions past their deadline
 * and triggers Google Sheets export.
 */

import { getMissionsPastDeadline, markMissionClosed, Mission } from './storage';
import { exportMissionToSheets, isSheetsConfigured } from './sheets';
import { closeThread } from './discord';

// Check interval: 5 minutes
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let checkInterval: NodeJS.Timeout | null = null;

/**
 * Check for missions past deadline and export them
 */
async function checkDeadlines(): Promise<void> {
  if (!isSheetsConfigured()) {
    return; // Skip if Google Sheets not configured
  }

  const missionsPastDeadline = getMissionsPastDeadline();

  if (missionsPastDeadline.length === 0) {
    return;
  }

  console.log(`[DeadlineChecker] Found ${missionsPastDeadline.length} mission(s) past deadline`);

  for (const mission of missionsPastDeadline) {
    console.log(`[DeadlineChecker] Processing: "${mission.title}" (deadline: ${mission.deadline})`);

    // Step 1: Close the thread to prevent further submissions
    const threadClosed = await closeThread(mission.threadId);
    if (threadClosed) {
      console.log(`[DeadlineChecker] Thread closed for "${mission.title}"`);
      markMissionClosed(mission.id);
    } else {
      console.warn(`[DeadlineChecker] Could not close thread for "${mission.title}", continuing with export`);
    }

    // Step 2: Export to Google Sheets
    const result = await exportMissionToSheets(mission);

    if (result.success) {
      console.log(`[DeadlineChecker] Exported "${mission.title}" - ${result.rowCount} submissions`);
    } else {
      console.error(`[DeadlineChecker] Failed to export "${mission.title}": ${result.error}`);
    }
  }
}

/**
 * Start the deadline checker
 */
export function startDeadlineChecker(): void {
  if (!isSheetsConfigured()) {
    console.log('[DeadlineChecker] Google Sheets not configured, skipping deadline checker');
    return;
  }

  console.log('[DeadlineChecker] Starting deadline checker (every 5 minutes)');

  // Run immediately on start
  checkDeadlines().catch(err => {
    console.error('[DeadlineChecker] Error during initial check:', err);
  });

  // Then run periodically
  checkInterval = setInterval(() => {
    checkDeadlines().catch(err => {
      console.error('[DeadlineChecker] Error during periodic check:', err);
    });
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the deadline checker
 */
export function stopDeadlineChecker(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log('[DeadlineChecker] Stopped');
  }
}

/**
 * Manually trigger a check (for testing or manual export)
 */
export async function triggerCheck(): Promise<void> {
  console.log('[DeadlineChecker] Manual check triggered');
  await checkDeadlines();
}
