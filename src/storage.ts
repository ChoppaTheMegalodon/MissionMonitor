/**
 * File-based storage for Mission Control Bot
 *
 * Persists submissions and mission mappings to disk.
 * Survives bot restarts.
 */

import * as fs from 'fs';
import * as path from 'path';

// Storage directory (relative to bot root)
const STORAGE_DIR = path.join(__dirname, '..', 'data');
const SUBMISSIONS_FILE = path.join(STORAGE_DIR, 'submissions.json');
const MISSIONS_FILE = path.join(STORAGE_DIR, 'missions.json');

// ============================================================================
// Types
// ============================================================================

export interface StoredVote {
  judgeId: string;
  score: number;
  timestamp: string;
}

export interface StoredSubmission {
  id: string;
  messageId: string;
  channelId: string;
  threadId: string;
  missionId: string;           // Linked mission
  userId: string;
  userTag: string;
  content: string;
  urls: string[];
  votes: StoredVote[];
  submittedAt: string;
  exported: boolean;
}

export interface StoredMission {
  id: string;
  title: string;
  threadId: string;
  deadline: string;            // ISO 8601
  status: 'active' | 'closed' | 'exported';
  createdAt: string;
  exportedAt?: string;
}

interface SubmissionsData {
  submissions: StoredSubmission[];
}

interface MissionsData {
  missions: StoredMission[];
}

// ============================================================================
// Initialization
// ============================================================================

function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    console.log(`[Storage] Created data directory: ${STORAGE_DIR}`);
  }
}

function loadSubmissions(): SubmissionsData {
  ensureStorageDir();
  if (!fs.existsSync(SUBMISSIONS_FILE)) {
    return { submissions: [] };
  }
  const content = fs.readFileSync(SUBMISSIONS_FILE, 'utf-8');
  return JSON.parse(content) as SubmissionsData;
}

function saveSubmissions(data: SubmissionsData): void {
  ensureStorageDir();
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function loadMissions(): MissionsData {
  ensureStorageDir();
  if (!fs.existsSync(MISSIONS_FILE)) {
    return { missions: [] };
  }
  const content = fs.readFileSync(MISSIONS_FILE, 'utf-8');
  return JSON.parse(content) as MissionsData;
}

function saveMissions(data: MissionsData): void {
  ensureStorageDir();
  fs.writeFileSync(MISSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Mission Functions
// ============================================================================

/**
 * Register a new mission (called when mission thread is created)
 */
export function registerMission(
  threadId: string,
  title: string,
  deadline: Date
): StoredMission {
  const data = loadMissions();

  // Check if already exists
  const existing = data.missions.find(m => m.threadId === threadId);
  if (existing) {
    return existing;
  }

  const mission: StoredMission = {
    id: `mission-${Date.now()}`,
    title,
    threadId,
    deadline: deadline.toISOString(),
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  data.missions.push(mission);
  saveMissions(data);
  console.log(`[Storage] Mission registered: ${mission.id} - "${title}"`);

  return mission;
}

/**
 * Get mission by thread ID
 */
export function getMissionByThread(threadId: string): StoredMission | null {
  const data = loadMissions();
  return data.missions.find(m => m.threadId === threadId) || null;
}

/**
 * Get mission by mission ID
 */
export function getMissionById(missionId: string): StoredMission | null {
  const data = loadMissions();
  return data.missions.find(m => m.id === missionId) || null;
}

/**
 * Get all active missions (not yet exported)
 */
export function getActiveMissions(): StoredMission[] {
  const data = loadMissions();
  return data.missions.filter(m => m.status === 'active');
}

/**
 * Get missions past their deadline that haven't been exported
 */
export function getMissionsPastDeadline(): StoredMission[] {
  const now = new Date();
  const data = loadMissions();
  return data.missions.filter(m =>
    m.status === 'active' && new Date(m.deadline) < now
  );
}

/**
 * Update a mission's deadline
 */
export function updateMissionDeadline(missionId: string, newDeadline: Date): boolean {
  const data = loadMissions();
  const mission = data.missions.find(m => m.id === missionId);
  if (mission && mission.status === 'active') {
    mission.deadline = newDeadline.toISOString();
    saveMissions(data);
    console.log(`[Storage] Mission deadline updated: ${missionId} -> ${newDeadline.toISOString()}`);
    return true;
  }
  return false;
}

/**
 * Mark mission as closed (thread locked, awaiting export)
 */
export function markMissionClosed(missionId: string): void {
  const data = loadMissions();
  const mission = data.missions.find(m => m.id === missionId);
  if (mission) {
    mission.status = 'closed';
    saveMissions(data);
    console.log(`[Storage] Mission marked closed: ${missionId}`);
  }
}

/**
 * Mark mission as exported
 */
export function markMissionExported(missionId: string): void {
  const data = loadMissions();
  const mission = data.missions.find(m => m.id === missionId);
  if (mission) {
    mission.status = 'exported';
    mission.exportedAt = new Date().toISOString();
    saveMissions(data);
    console.log(`[Storage] Mission marked exported: ${missionId}`);
  }
}

// ============================================================================
// Submission Functions
// ============================================================================

/**
 * Create a new submission
 */
export function createSubmission(
  messageId: string,
  channelId: string,
  threadId: string,
  missionId: string,
  userId: string,
  userTag: string,
  content: string,
  urls: string[]
): StoredSubmission {
  const data = loadSubmissions();

  const submission: StoredSubmission = {
    id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    messageId,
    channelId,
    threadId,
    missionId,
    userId,
    userTag,
    content,
    urls,
    votes: [],
    submittedAt: new Date().toISOString(),
    exported: false,
  };

  data.submissions.push(submission);
  saveSubmissions(data);
  console.log(`[Storage] Submission created: ${submission.id}`);

  return submission;
}

/**
 * Get submission by message ID
 */
export function getSubmissionByMessage(messageId: string): StoredSubmission | null {
  const data = loadSubmissions();
  return data.submissions.find(s => s.messageId === messageId) || null;
}

/**
 * Get all submissions for a mission
 */
export function getSubmissionsByMission(missionId: string): StoredSubmission[] {
  const data = loadSubmissions();
  return data.submissions.filter(s => s.missionId === missionId);
}

/**
 * Add or update a vote on a submission
 */
export function recordVote(
  submissionId: string,
  judgeId: string,
  score: number
): void {
  const data = loadSubmissions();
  const submission = data.submissions.find(s => s.id === submissionId);

  if (!submission) {
    console.error(`[Storage] Submission not found: ${submissionId}`);
    return;
  }

  // Check if judge already voted
  const existingVoteIndex = submission.votes.findIndex(v => v.judgeId === judgeId);

  const vote: StoredVote = {
    judgeId,
    score,
    timestamp: new Date().toISOString(),
  };

  if (existingVoteIndex >= 0) {
    // Update existing vote
    submission.votes[existingVoteIndex] = vote;
  } else {
    // Add new vote
    submission.votes.push(vote);
  }

  saveSubmissions(data);
  console.log(`[Storage] Vote recorded: judge ${judgeId} gave ${score} to ${submissionId}`);
}

/**
 * Remove a vote from a submission
 */
export function removeVote(submissionId: string, judgeId: string): void {
  const data = loadSubmissions();
  const submission = data.submissions.find(s => s.id === submissionId);

  if (!submission) return;

  submission.votes = submission.votes.filter(v => v.judgeId !== judgeId);
  saveSubmissions(data);
  console.log(`[Storage] Vote removed: judge ${judgeId} from ${submissionId}`);
}

/**
 * Mark submissions as exported
 */
export function markSubmissionsExported(missionId: string): void {
  const data = loadSubmissions();
  data.submissions.forEach(s => {
    if (s.missionId === missionId) {
      s.exported = true;
    }
  });
  saveSubmissions(data);
}
