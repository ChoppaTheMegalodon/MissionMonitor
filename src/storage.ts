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
const TEMPLATES_FILE = path.join(STORAGE_DIR, 'templates.json');
const REFERRALS_FILE = path.join(STORAGE_DIR, 'referrals.json');

// ============================================================================
// Types
// ============================================================================

export interface Mission {
  id: string;
  title: string;
  threadId: string;
  deadline: string;
  status: 'active' | 'closed' | 'exported';
  createdAt: string;
  exportedAt?: string;
  brief?: string; // Optional: full mission brief content
  telegramMessageId?: string; // Message ID of mission announcement in Telegram
  telegramChatId?: string; // Chat ID where mission was announced
  starterMessageId?: string; // Discord starter message ID (for editing status)
  channelId?: string; // Discord channel ID where starter message lives
}

export interface Vote {
  judgeId: string;
  score: number;
  timestamp: string;
}

export interface Submission {
  id: string;
  messageId: string;
  channelId: string;
  threadId: string;
  missionId: string;
  userId: string;
  userTag: string;
  content: string;
  urls: string[];
  votes: Vote[];
  submittedAt: string;
  exported: boolean;
  source: 'discord' | 'telegram'; // Where submission came from
}

export interface MissionTemplate {
  id: string;
  name: string;
  briefContent: string;
  defaultDeadlineDays: number;
  claudePromptOverride?: string;
  announcementFormat?: string;
  roleIds?: string[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Referral Types
// ============================================================================

export interface Referral {
  code: string;              // "PYTH-R3NX" format
  referrerId: string;        // Telegram user ID
  referrerUsername: string;
  solanaWallet?: string;     // SOL wallet for receiving referral payouts
  createdAt: string;
}

export interface ReferralAttribution {
  recruitId: string;         // Telegram user ID
  recruitUsername: string;
  referrerCode: string;
  referrerId: string;        // Denormalized for fast lookup
  registeredAt: string;
  expiresAt: string;         // registeredAt + 90 days
  discordUserId?: string;    // Linked via /link command
  solanaWallet?: string;     // SOL wallet for payouts
  ethWallet?: string;        // ETH wallet for payouts
  twitterHandle?: string;    // Twitter/X handle (without @)
  agreedToTerms?: boolean;   // Privacy policy agreement
  agreedAt?: string;         // When they agreed
  onboardingComplete?: boolean; // All data collected
}

export interface ReferralPayout {
  id: string;                // "rpay-{timestamp}"
  missionId: string;
  submissionId: string;
  recruitId: string;
  referrerId: string;
  recruitPayout: number;
  referralAmount: number;    // 10% of recruitPayout
  createdAt: string;
  exported: boolean;
}

interface ReferralsData {
  referrals: Referral[];
  attributions: ReferralAttribution[];
  payouts: ReferralPayout[];
}

interface SubmissionsData {
  submissions: Submission[];
}

interface MissionsData {
  missions: Mission[];
}

interface TemplatesData {
  templates: MissionTemplate[];
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
  return JSON.parse(content);
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
  return JSON.parse(content);
}

function saveMissions(data: MissionsData): void {
  ensureStorageDir();
  fs.writeFileSync(MISSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function loadReferrals(): ReferralsData {
  ensureStorageDir();
  if (!fs.existsSync(REFERRALS_FILE)) {
    return { referrals: [], attributions: [], payouts: [] };
  }
  const content = fs.readFileSync(REFERRALS_FILE, 'utf-8');
  return JSON.parse(content);
}

function saveReferrals(data: ReferralsData): void {
  ensureStorageDir();
  fs.writeFileSync(REFERRALS_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
  deadline: Date,
  brief?: string,
  starterMessageId?: string,
  channelId?: string
): Mission {
  console.log(`[Storage] DEBUG: registerMission called - threadId=${threadId}, title="${title}"`);

  const data = loadMissions();

  // Check if already exists
  const existing = data.missions.find(m => m.threadId === threadId);
  if (existing) {
    console.log(`[Storage] DEBUG: Mission already exists: ${existing.id}`);
    return existing;
  }

  const mission: Mission = {
    id: `mission-${Date.now()}`,
    title,
    threadId,
    deadline: deadline.toISOString(),
    status: 'active',
    createdAt: new Date().toISOString(),
    brief,
    starterMessageId,
    channelId,
  };

  data.missions.push(mission);
  saveMissions(data);
  console.log(`[Storage] Mission registered: ${mission.id} - "${title}"`);
  return mission;
}

/**
 * Get mission by thread ID
 */
export function getMissionByThread(threadId: string): Mission | null {
  const data = loadMissions();
  return data.missions.find(m => m.threadId === threadId) || null;
}

/**
 * Get mission by mission ID
 */
export function getMissionById(missionId: string): Mission | null {
  const data = loadMissions();
  return data.missions.find(m => m.id === missionId) || null;
}

/**
 * Get mission by Telegram message ID
 */
export function getMissionByTelegramMessage(messageId: string): Mission | null {
  const data = loadMissions();
  return data.missions.find(m => m.telegramMessageId === messageId) || null;
}

/**
 * Update mission with Telegram message info
 */
export function updateMissionTelegramInfo(
  missionId: string,
  telegramMessageId: string,
  telegramChatId: string
): void {
  const data = loadMissions();
  const mission = data.missions.find(m => m.id === missionId);
  if (mission) {
    mission.telegramMessageId = telegramMessageId;
    mission.telegramChatId = telegramChatId;
    saveMissions(data);
    console.log(`[Storage] Mission ${missionId} updated with Telegram info: msgId=${telegramMessageId}, chatId=${telegramChatId}`);
  }
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
 * Get all active missions (not yet exported)
 */
export function getActiveMissions(): Mission[] {
  const data = loadMissions();
  return data.missions.filter(m => m.status === 'active');
}

/**
 * Get all missions (any status)
 */
export function getAllMissions(): Mission[] {
  const data = loadMissions();
  return data.missions;
}

/**
 * Get missions past their deadline that haven't been exported
 */
export function getMissionsPastDeadline(): Mission[] {
  const now = new Date();
  const data = loadMissions();
  return data.missions.filter(
    m => m.status === 'active' && new Date(m.deadline) < now
  );
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
  urls: string[],
  source: 'discord' | 'telegram' = 'discord'
): Submission {
  console.log(`[Storage] DEBUG: createSubmission called - messageId=${messageId}, userId=${userId}, source=${source}`);

  const data = loadSubmissions();

  const submission: Submission = {
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
    source,
  };

  data.submissions.push(submission);
  saveSubmissions(data);
  console.log(`[Storage] Submission created: ${submission.id} (source: ${source})`);
  return submission;
}

/**
 * Get submission by submission ID
 */
export function getSubmissionById(submissionId: string): Submission | null {
  const data = loadSubmissions();
  return data.submissions.find(s => s.id === submissionId) || null;
}

/**
 * Get submission by message ID
 */
export function getSubmissionByMessage(messageId: string): Submission | null {
  const data = loadSubmissions();
  return data.submissions.find(s => s.messageId === messageId) || null;
}

/**
 * Get all submissions for a mission
 */
export function getSubmissionsByMission(missionId: string): Submission[] {
  const data = loadSubmissions();
  return data.submissions.filter(s => s.missionId === missionId);
}

/**
 * Add or update a vote on a submission
 */
export function recordVote(submissionId: string, judgeId: string, score: number): void {
  console.log(`[Storage] DEBUG: recordVote called - submissionId=${submissionId}, judgeId=${judgeId}, score=${score}`);

  const data = loadSubmissions();
  const submission = data.submissions.find(s => s.id === submissionId);

  if (!submission) {
    console.error(`[Storage] Submission not found: ${submissionId}`);
    return;
  }

  // Check if judge already voted
  const existingVoteIndex = submission.votes.findIndex(v => v.judgeId === judgeId);
  const vote: Vote = {
    judgeId,
    score,
    timestamp: new Date().toISOString(),
  };

  if (existingVoteIndex >= 0) {
    // Update existing vote
    submission.votes[existingVoteIndex] = vote;
    console.log(`[Storage] Vote updated: judge ${judgeId} changed to ${score} on ${submissionId}`);
  } else {
    // Add new vote
    submission.votes.push(vote);
    console.log(`[Storage] Vote recorded: judge ${judgeId} gave ${score} to ${submissionId}`);
  }

  saveSubmissions(data);
}

/**
 * Remove a vote from a submission
 */
export function removeVote(submissionId: string, judgeId: string): void {
  console.log(`[Storage] DEBUG: removeVote called - submissionId=${submissionId}, judgeId=${judgeId}`);

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

// ============================================================================
// Template Functions
// ============================================================================

function loadTemplates(): TemplatesData {
  ensureStorageDir();
  if (!fs.existsSync(TEMPLATES_FILE)) {
    return { templates: [] };
  }
  const content = fs.readFileSync(TEMPLATES_FILE, 'utf-8');
  return JSON.parse(content);
}

function saveTemplates(data: TemplatesData): void {
  ensureStorageDir();
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Create a new mission template
 */
export function createTemplate(input: {
  name: string;
  briefContent: string;
  defaultDeadlineDays: number;
  claudePromptOverride?: string;
  announcementFormat?: string;
}): MissionTemplate {
  const data = loadTemplates();

  // Check for duplicate name (case-insensitive)
  const existing = data.templates.find(
    t => t.name.toLowerCase() === input.name.toLowerCase()
  );
  if (existing) {
    throw new Error(`Template "${input.name}" already exists.`);
  }

  const template: MissionTemplate = {
    id: `tmpl-${Date.now()}`,
    name: input.name,
    briefContent: input.briefContent,
    defaultDeadlineDays: input.defaultDeadlineDays,
    claudePromptOverride: input.claudePromptOverride,
    announcementFormat: input.announcementFormat,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  data.templates.push(template);
  saveTemplates(data);
  console.log(`[Storage] Template created: ${template.id} - "${template.name}"`);
  return template;
}

/**
 * Get template by name (case-insensitive)
 */
export function getTemplateByName(name: string): MissionTemplate | null {
  const data = loadTemplates();
  return data.templates.find(
    t => t.name.toLowerCase() === name.toLowerCase()
  ) || null;
}

/**
 * Get all templates sorted by createdAt desc
 */
export function getAllTemplates(): MissionTemplate[] {
  const data = loadTemplates();
  return data.templates.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Update a template by ID
 */
export function updateTemplate(
  id: string,
  updates: Partial<Pick<MissionTemplate, 'name' | 'briefContent' | 'defaultDeadlineDays' | 'claudePromptOverride' | 'announcementFormat'>>
): MissionTemplate | null {
  const data = loadTemplates();
  const template = data.templates.find(t => t.id === id);
  if (!template) return null;

  // If renaming, check for conflicts
  if (updates.name && updates.name.toLowerCase() !== template.name.toLowerCase()) {
    const conflict = data.templates.find(
      t => t.id !== id && t.name.toLowerCase() === updates.name!.toLowerCase()
    );
    if (conflict) {
      throw new Error(`Template "${updates.name}" already exists.`);
    }
  }

  Object.assign(template, updates, { updatedAt: new Date().toISOString() });
  saveTemplates(data);
  console.log(`[Storage] Template updated: ${template.id} - "${template.name}"`);
  return template;
}

/**
 * Delete a template by ID
 */
export function deleteTemplate(id: string): boolean {
  const data = loadTemplates();
  const index = data.templates.findIndex(t => t.id === id);
  if (index < 0) return false;

  const removed = data.templates.splice(index, 1)[0];
  saveTemplates(data);
  console.log(`[Storage] Template deleted: ${removed.id} - "${removed.name}"`);
  return true;
}

/**
 * Resolve {{placeholder}} variables in template text
 */
export function resolveTemplateVariables(
  text: string,
  vars: Record<string, string>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
}

// ============================================================================
// Referral Functions
// ============================================================================

const REFERRAL_WORD_POOL = ['PYTH', 'SHARK', 'ORBIT', 'PULSE', 'FLAME', 'SPARK', 'ALPHA', 'HYDRA', 'NEXUS', 'CREED'];
const UNAMBIGUOUS_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateReferralCode(): string {
  const word = REFERRAL_WORD_POOL[Math.floor(Math.random() * REFERRAL_WORD_POOL.length)];
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += UNAMBIGUOUS_CHARS[Math.floor(Math.random() * UNAMBIGUOUS_CHARS.length)];
  }
  return `${word}-${suffix}`;
}

/**
 * Create a referral code for a user. Returns existing code if user already has one.
 */
export function createReferralCode(referrerId: string, username: string): Referral {
  const data = loadReferrals();

  const existing = data.referrals.find(r => r.referrerId === referrerId);
  if (existing) return existing;

  // Generate unique code
  let code: string;
  do {
    code = generateReferralCode();
  } while (data.referrals.some(r => r.code === code));

  const referral: Referral = {
    code,
    referrerId,
    referrerUsername: username,
    createdAt: new Date().toISOString(),
  };

  data.referrals.push(referral);
  saveReferrals(data);
  console.log(`[Storage] Referral code created: ${code} for user ${referrerId} (${username})`);
  return referral;
}

/**
 * Get referral by code (case-insensitive)
 */
export function getReferralByCode(code: string): Referral | null {
  const data = loadReferrals();
  const upper = code.toUpperCase();
  return data.referrals.find(r => r.code.toUpperCase() === upper) || null;
}

/**
 * Get all referral codes for a user
 */
export function getReferralsByUser(referrerId: string): Referral[] {
  const data = loadReferrals();
  return data.referrals.filter(r => r.referrerId === referrerId);
}

/**
 * Register a referral attribution (recruit joined via code).
 * Blocks self-referral and duplicate attribution.
 */
export function registerReferralAttribution(
  recruitId: string,
  username: string,
  code: string,
  attributionDays: number = 90
): { success: boolean; error?: string } {
  const data = loadReferrals();

  // Find the referral code
  const upper = code.toUpperCase();
  const referral = data.referrals.find(r => r.code.toUpperCase() === upper);
  if (!referral) {
    return { success: false, error: 'Invalid referral code' };
  }

  // Block self-referral
  if (referral.referrerId === recruitId) {
    return { success: false, error: 'Cannot use your own referral code' };
  }

  // Block duplicate attribution
  const existing = data.attributions.find(a => a.recruitId === recruitId);
  if (existing) {
    return { success: false, error: 'You have already been referred' };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + attributionDays * 24 * 60 * 60 * 1000);

  const attribution: ReferralAttribution = {
    recruitId,
    recruitUsername: username,
    referrerCode: referral.code,
    referrerId: referral.referrerId,
    registeredAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  data.attributions.push(attribution);
  saveReferrals(data);
  console.log(`[Storage] Referral attribution: ${recruitId} (${username}) referred by ${referral.referrerId} via ${referral.code}`);
  return { success: true };
}

/**
 * Get attribution by recruit's Telegram user ID
 */
export function getAttributionByRecruit(recruitId: string): ReferralAttribution | null {
  const data = loadReferrals();
  return data.attributions.find(a => a.recruitId === recruitId) || null;
}

/**
 * Get attribution by linked Discord user ID
 */
export function getAttributionByDiscordUser(discordId: string): ReferralAttribution | null {
  const data = loadReferrals();
  return data.attributions.find(a => a.discordUserId === discordId) || null;
}

/**
 * Link a Discord user ID to a recruit's attribution record
 */
export function linkDiscordId(telegramId: string, discordId: string): { success: boolean; error?: string } {
  const data = loadReferrals();
  const attribution = data.attributions.find(a => a.recruitId === telegramId);
  if (!attribution) {
    return { success: false, error: 'No referral attribution found for your account' };
  }

  // Check if this Discord ID is already linked to another attribution
  const existingLink = data.attributions.find(a => a.discordUserId === discordId && a.recruitId !== telegramId);
  if (existingLink) {
    return { success: false, error: 'This Discord ID is already linked to another account' };
  }

  attribution.discordUserId = discordId;
  saveReferrals(data);
  console.log(`[Storage] Discord linked: Telegram ${telegramId} → Discord ${discordId}`);
  return { success: true };
}

/**
 * Set Solana wallet address for a recruit
 */
export function setSolanaWallet(telegramId: string, wallet: string): { success: boolean; error?: string } {
  const data = loadReferrals();
  const attribution = data.attributions.find(a => a.recruitId === telegramId);
  if (!attribution) {
    return { success: false, error: 'No referral attribution found for your account. You must join via a referral link first.' };
  }

  attribution.solanaWallet = wallet;
  saveReferrals(data);
  console.log(`[Storage] Solana wallet set: Telegram ${telegramId} → ${wallet}`);
  return { success: true };
}

/**
 * Set ETH wallet address for a recruit
 */
export function setEthWallet(telegramId: string, wallet: string): { success: boolean; error?: string } {
  const data = loadReferrals();
  const attribution = data.attributions.find(a => a.recruitId === telegramId);
  if (!attribution) {
    return { success: false, error: 'No referral attribution found for your account.' };
  }

  attribution.ethWallet = wallet;
  saveReferrals(data);
  console.log(`[Storage] ETH wallet set: Telegram ${telegramId} → ${wallet}`);
  return { success: true };
}

/**
 * Set Twitter handle for a recruit
 */
export function setTwitterHandle(telegramId: string, handle: string): { success: boolean; error?: string } {
  const data = loadReferrals();
  const attribution = data.attributions.find(a => a.recruitId === telegramId);
  if (!attribution) {
    return { success: false, error: 'No referral attribution found for your account.' };
  }

  attribution.twitterHandle = handle.replace(/^@/, '');
  saveReferrals(data);
  console.log(`[Storage] Twitter handle set: Telegram ${telegramId} → @${attribution.twitterHandle}`);
  return { success: true };
}

/**
 * Mark user as agreed to terms
 */
export function markAgreedToTerms(telegramId: string): { success: boolean; error?: string } {
  const data = loadReferrals();
  const attribution = data.attributions.find(a => a.recruitId === telegramId);
  if (!attribution) {
    return { success: false, error: 'No referral attribution found.' };
  }

  attribution.agreedToTerms = true;
  attribution.agreedAt = new Date().toISOString();
  saveReferrals(data);
  console.log(`[Storage] Terms agreed: Telegram ${telegramId}`);
  return { success: true };
}

/**
 * Mark onboarding as complete
 */
export function markOnboardingComplete(telegramId: string): { success: boolean; error?: string } {
  const data = loadReferrals();
  const attribution = data.attributions.find(a => a.recruitId === telegramId);
  if (!attribution) {
    return { success: false, error: 'No referral attribution found.' };
  }

  attribution.onboardingComplete = true;
  saveReferrals(data);
  console.log(`[Storage] Onboarding complete: Telegram ${telegramId}`);
  return { success: true };
}

/**
 * Check if a user has completed onboarding (agreed to terms + provided all data)
 */
export function isOnboardingComplete(telegramId: string): boolean {
  const data = loadReferrals();
  const attribution = data.attributions.find(a => a.recruitId === telegramId);
  if (!attribution) return false;
  return attribution.onboardingComplete === true;
}

/**
 * Check if a user has agreed to terms
 */
export function hasAgreedToTerms(telegramId: string): boolean {
  const data = loadReferrals();
  const attribution = data.attributions.find(a => a.recruitId === telegramId);
  if (!attribution) return false;
  return attribution.agreedToTerms === true;
}

/**
 * Get all attributions that haven't completed onboarding
 */
export function getIncompleteOnboardings(): ReferralAttribution[] {
  const data = loadReferrals();
  return data.attributions.filter(a => !a.onboardingComplete);
}

/**
 * Set Solana wallet address for a referrer (by their Telegram ID)
 */
export function setReferrerSolanaWallet(referrerId: string, wallet: string): { success: boolean; error?: string } {
  const data = loadReferrals();
  const referral = data.referrals.find(r => r.referrerId === referrerId);
  if (!referral) {
    return { success: false, error: 'You need to create a referral code first. Use /referral.' };
  }

  referral.solanaWallet = wallet;
  saveReferrals(data);
  console.log(`[Storage] Referrer wallet set: ${referrerId} → ${wallet}`);
  return { success: true };
}

/**
 * Record a referral payout for a mission winner.
 * Checks attribution validity and 90-day expiry.
 * Returns the payout if created, null if no valid attribution.
 */
export function recordReferralPayout(
  missionId: string,
  submissionId: string,
  recruitId: string,
  recruitPayout: number,
  payoutSplit: number = 0.10
): ReferralPayout | null {
  // Try Telegram ID first, then Discord ID
  let attribution = getAttributionByRecruit(recruitId);
  if (!attribution) {
    attribution = getAttributionByDiscordUser(recruitId);
  }

  if (!attribution) return null;

  // Check expiry
  if (new Date() > new Date(attribution.expiresAt)) {
    console.log(`[Storage] Referral attribution expired for recruit ${recruitId}`);
    return null;
  }

  const data = loadReferrals();

  // Check for duplicate payout (same mission + submission)
  const existing = data.payouts.find(p => p.missionId === missionId && p.submissionId === submissionId);
  if (existing) return existing;

  const referralAmount = Math.round(recruitPayout * payoutSplit * 100) / 100;

  const payout: ReferralPayout = {
    id: `rpay-${Date.now()}`,
    missionId,
    submissionId,
    recruitId: attribution.recruitId,
    referrerId: attribution.referrerId,
    recruitPayout,
    referralAmount,
    createdAt: new Date().toISOString(),
    exported: false,
  };

  data.payouts.push(payout);
  saveReferrals(data);
  console.log(`[Storage] Referral payout created: ${payout.id} - $${referralAmount} to referrer ${attribution.referrerId}`);
  return payout;
}

/**
 * Get referral stats for a referrer
 */
export function getReferralStats(referrerId: string): {
  totalRecruits: number;
  activeRecruits: number;
  totalEarnings: number;
  recentPayouts: ReferralPayout[];
} {
  const data = loadReferrals();
  const now = new Date();

  const allRecruits = data.attributions.filter(a => a.referrerId === referrerId);
  const activeRecruits = allRecruits.filter(a => new Date(a.expiresAt) > now);
  const payouts = data.payouts.filter(p => p.referrerId === referrerId);
  const totalEarnings = payouts.reduce((sum, p) => sum + p.referralAmount, 0);
  const recentPayouts = payouts
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return {
    totalRecruits: allRecruits.length,
    activeRecruits: activeRecruits.length,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    recentPayouts,
  };
}

/**
 * Look up wallet address for a user (checks both referrer and recruit records)
 */
export function getWalletForUser(userId: string): string | undefined {
  const data = loadReferrals();
  // Check referrer record
  const referral = data.referrals.find(r => r.referrerId === userId);
  if (referral?.solanaWallet) return referral.solanaWallet;
  // Check recruit record
  const attribution = data.attributions.find(a => a.recruitId === userId);
  return attribution?.solanaWallet;
}

/**
 * Get unexported referral payouts
 */
export function getUnexportedPayouts(): ReferralPayout[] {
  const data = loadReferrals();
  return data.payouts.filter(p => !p.exported);
}

/**
 * Mark referral payouts as exported
 */
export function markPayoutsExported(ids: string[]): void {
  const data = loadReferrals();
  const idSet = new Set(ids);
  data.payouts.forEach(p => {
    if (idSet.has(p.id)) p.exported = true;
  });
  saveReferrals(data);
  console.log(`[Storage] Marked ${ids.length} referral payouts as exported`);
}
