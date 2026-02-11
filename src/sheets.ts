/**
 * Google Sheets Export for Mission Control Bot
 *
 * Exports mission submissions to Google Sheets in real-time.
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from './config';
import {
  Mission,
  Submission,
  getSubmissionsByMission,
  getMissionById,
  markMissionExported,
  markSubmissionsExported,
} from './storage';

// ============================================================================
// Authentication
// ============================================================================

/**
 * Create authenticated JWT for Google Sheets API
 */
function createAuth(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!email || !privateKey) {
    throw new Error('Missing Google service account credentials in environment');
  }

  return new JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * Get authenticated spreadsheet instance
 */
async function getSpreadsheet(): Promise<GoogleSpreadsheet> {
  const spreadsheetId = config.googleSpreadsheetId;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SPREADSHEET_ID not configured');
  }

  const auth = createAuth();
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo();

  return doc;
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Sanitize sheet title (max 100 chars, no special chars)
 */
function sanitizeTitle(title: string): string {
  return title
    .replace(/[*?:/\\[\]']/g, '-')
    .slice(0, 100)
    .trim();
}

// Standard headers for mission sheets
const SHEET_HEADERS = [
  'Submission ID',
  'Source',
  'User ID',
  'User Tag',
  'URL',
  'Content',
  'Submitted At',
  'Vote Count',
  'Average Score',
  'Votes (JSON)',
];

/**
 * Ensure a sheet exists for the mission, create if not
 */
async function ensureMissionSheet(mission: Mission): Promise<any> {
  const doc = await getSpreadsheet();
  const sheetTitle = sanitizeTitle(mission.title);

  let sheet = doc.sheetsByTitle[sheetTitle];

  if (!sheet) {
    sheet = await doc.addSheet({ title: sheetTitle });
    await sheet.setHeaderRow(SHEET_HEADERS);
    console.log(`[Sheets] Created new sheet: ${sheetTitle}`);
  } else {
    // Verify headers match (older sheets may be missing the Source column)
    await sheet.loadHeaderRow();
    if (!sheet.headerValues.includes('Source')) {
      console.log(`[Sheets] Migrating sheet "${sheetTitle}" - adding Source column`);
      const rows = await sheet.getRows();
      const oldHeaders = sheet.headerValues;
      const rowData = rows.map((r: any) => oldHeaders.map((h: string) => r.get(h) || ''));
      const newHeaders = [oldHeaders[0], 'Source', ...oldHeaders.slice(1)];
      await sheet.clear();
      await sheet.setHeaderRow(newHeaders);
      for (const data of rowData) {
        await sheet.addRow([data[0], 'discord', ...data.slice(1)]);
      }
      console.log(`[Sheets] Migration complete: ${rowData.length} rows updated`);
    }
  }

  return sheet;
}

// ============================================================================
// Real-time Functions
// ============================================================================

/**
 * Append a new submission to the sheet immediately
 */
export async function appendSubmissionToSheet(
  mission: Mission,
  submission: Submission
): Promise<boolean> {
  // Don't update if mission is already closed/exported
  if (mission.status !== 'active') {
    console.log(`[Sheets] Mission "${mission.title}" is ${mission.status}, skipping append`);
    return false;
  }

  try {
    const sheet = await ensureMissionSheet(mission);

    const row = [
      submission.id,
      submission.source || 'discord',
      submission.userId,
      submission.userTag,
      submission.urls[0] || '',
      submission.content.slice(0, 500),
      submission.submittedAt,
      '0',      // Vote count
      'N/A',    // Average score
      '[]',     // Votes JSON
    ];

    await sheet.addRow(row);
    console.log(`[Sheets] Appended submission ${submission.id} (${submission.source}) to "${mission.title}"`);
    return true;

  } catch (error) {
    console.error(`[Sheets] Failed to append submission:`, error);
    return false;
  }
}

/**
 * Update a submission's vote data in the sheet
 */
export async function updateSubmissionVotes(
  missionId: string,
  submissionId: string,
  votes: { judgeId: string; score: number }[]
): Promise<boolean> {
  try {
    // Get mission to check status and get sheet
    const mission = getMissionById(missionId);
    if (!mission) {
      console.log(`[Sheets] Could not find mission ${missionId} for vote update`);
      return false;
    }

    // Don't update if mission is closed/exported
    if (mission.status !== 'active') {
      console.log(`[Sheets] Mission "${mission.title}" is ${mission.status}, skipping vote update`);
      return false;
    }

    const doc = await getSpreadsheet();
    const sheetTitle = sanitizeTitle(mission.title);
    const sheet = doc.sheetsByTitle[sheetTitle];

    if (!sheet) {
      console.log(`[Sheets] Sheet not found for "${mission.title}"`);
      return false;
    }

    // Load rows and find the submission
    const rows = await sheet.getRows();
    const row = rows.find((r: any) => r.get('Submission ID') === submissionId);

    if (!row) {
      console.log(`[Sheets] Submission ${submissionId} not found in sheet`);
      return false;
    }

    // Calculate new values
    const voteCount = votes.length;
    const avgScore = voteCount > 0
      ? (votes.reduce((sum, v) => sum + v.score, 0) / voteCount).toFixed(2)
      : 'N/A';

    // Update the row
    row.set('Vote Count', voteCount.toString());
    row.set('Average Score', avgScore);
    row.set('Votes (JSON)', JSON.stringify(votes));
    await row.save();

    console.log(`[Sheets] Updated votes for ${submissionId}: ${voteCount} votes, avg ${avgScore}`);
    return true;

  } catch (error) {
    console.error(`[Sheets] Failed to update votes:`, error);
    return false;
  }
}

/**
 * Export a mission's submissions to Google Sheets
 *
 * Creates a new sheet tab for the mission with all submissions and votes.
 */
export async function exportMissionToSheets(mission: Mission): Promise<{
  success: boolean;
  rowCount: number;
  error?: string;
}> {
  console.log(`[Sheets] Exporting mission: ${mission.title}`);

  try {
    const doc = await getSpreadsheet();
    const submissions = getSubmissionsByMission(mission.id);

    if (submissions.length === 0) {
      console.log(`[Sheets] No submissions for mission ${mission.id}`);
      markMissionExported(mission.id);
      return { success: true, rowCount: 0 };
    }

    // Get unique judge IDs across all submissions
    const judgeIds = new Set<string>();
    submissions.forEach(s => s.votes.forEach(v => judgeIds.add(v.judgeId)));
    const judgeIdArray = Array.from(judgeIds).sort();

    // Create or get sheet for this mission
    const sheetTitle = sanitizeTitle(mission.title);
    let sheet = doc.sheetsByTitle[sheetTitle];

    if (!sheet) {
      sheet = await doc.addSheet({ title: sheetTitle });
      console.log(`[Sheets] Created new sheet: ${sheetTitle}`);
    } else {
      // Clear existing data
      await sheet.clear();
      console.log(`[Sheets] Cleared existing sheet: ${sheetTitle}`);
    }

    // Build headers
    const headers = [
      'Submission ID',
      'Source',
      'User ID',
      'User Tag',
      'URL',
      'Content',
      'Submitted At',
      'Vote Count',
      'Average Score',
      ...judgeIdArray.map(id => `Judge_${id.slice(-6)}`),
    ];

    // Build rows
    const rows = submissions.map(s => {
      const voteScores = s.votes.map(v => v.score);
      const avgScore = voteScores.length > 0
        ? (voteScores.reduce((a, b) => a + b, 0) / voteScores.length).toFixed(2)
        : 'N/A';

      // Build judge columns (score or empty)
      const judgeScores = judgeIdArray.map(judgeId => {
        const vote = s.votes.find(v => v.judgeId === judgeId);
        return vote ? vote.score.toString() : '';
      });

      return [
        s.id,
        s.source || 'discord',
        s.userId,
        s.userTag,
        s.urls[0] || '',
        s.content.slice(0, 500), // Limit content length
        s.submittedAt,
        s.votes.length.toString(),
        avgScore,
        ...judgeScores,
      ];
    });

    // Write to sheet
    await sheet.setHeaderRow(headers);
    await sheet.addRows(rows);

    // Mark as exported
    markMissionExported(mission.id);
    markSubmissionsExported(mission.id);

    console.log(`[Sheets] Exported ${rows.length} submissions for "${mission.title}"`);
    return { success: true, rowCount: rows.length };

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`[Sheets] Export failed: ${errorMessage}`);
    return { success: false, rowCount: 0, error: errorMessage };
  }
}

/**
 * Check if Google Sheets is configured
 */
export function isSheetsConfigured(): boolean {
  return !!(
    config.googleSpreadsheetId &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY
  );
}

// ============================================================================
// Telegram Submissions
// ============================================================================

const TELEGRAM_SHEET_NAME = 'Telegram Submissions';
const TELEGRAM_HEADERS = [
  'Submission ID',
  'User ID',
  'Username',
  'URL',
  'Content',
  'Submitted At',
  'Chat ID',
];

/**
 * Ensure Telegram submissions sheet exists
 */
async function ensureTelegramSheet(): Promise<any> {
  const doc = await getSpreadsheet();

  let sheet = doc.sheetsByTitle[TELEGRAM_SHEET_NAME];

  if (!sheet) {
    sheet = await doc.addSheet({ title: TELEGRAM_SHEET_NAME });
    await sheet.setHeaderRow(TELEGRAM_HEADERS);
    console.log(`[Sheets] Created Telegram submissions sheet`);
  }

  return sheet;
}

/**
 * Append a Telegram submission to the sheet
 */
export async function appendTelegramSubmission(
  submissionId: string,
  userId: string,
  username: string,
  url: string,
  content: string,
  chatId: string
): Promise<boolean> {
  try {
    const sheet = await ensureTelegramSheet();

    const row = [
      submissionId,
      userId,
      username,
      url,
      content.slice(0, 500),
      new Date().toISOString(),
      chatId,
    ];

    await sheet.addRow(row);
    console.log(`[Sheets] Appended Telegram submission ${submissionId}`);
    return true;

  } catch (error) {
    console.error(`[Sheets] Failed to append Telegram submission:`, error);
    return false;
  }
}
