/**
 * Discord Bot
 *
 * Handles Discord events for Mission Control:
 * - Submission detection in mission THREADS (not main channel)
 * - Pre-creates 1-5 vote reactions for judges to click
 * - Only judges can vote (non-judge reactions removed)
 * - Votes persisted to disk for Google Sheets export
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  ThreadChannel,
  Message,
  TextChannel,
} from 'discord.js';
import { config } from './config';
import {
  createSubmission,
  getSubmissionByMessage,
  getMissionByThread,
  registerMission,
  recordVote,
  removeVote,
  StoredSubmission,
} from './storage';
import { appendSubmissionToSheet, updateSubmissionVotes } from './sheets';

// Create Discord client with required intents
export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

// Vote emoji mappings
const VOTE_EMOJIS: Record<string, number> = {
  '1️⃣': 1,
  '2️⃣': 2,
  '3️⃣': 3,
  '4️⃣': 4,
  '5️⃣': 5,
};

// Ordered array for pre-creating reactions
const VOTE_EMOJI_ORDER = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

const CONFIRMATION_EMOJI = '📝';

// ============================================================================
// Discord Timestamp Parsing
// ============================================================================

/**
 * Parse Discord timestamp from message content
 * Discord timestamps look like: <t:1706619600:R> or <t:1706619600:F> or <t:1706619600>
 * The number is Unix epoch in seconds
 * Returns the first timestamp found, or null if none
 */
function parseDiscordTimestamp(content: string): Date | null {
  // Match Discord timestamp format: <t:TIMESTAMP> or <t:TIMESTAMP:STYLE>
  const timestampRegex = /<t:(\d+)(?::[tTdDfFR])?>/g;
  const match = timestampRegex.exec(content);

  if (match && match[1]) {
    const unixSeconds = parseInt(match[1], 10);
    return new Date(unixSeconds * 1000);
  }

  return null;
}

/**
 * Fetch the parent (starter) message of a thread
 */
async function fetchThreadStarterMessage(thread: ThreadChannel): Promise<Message | null> {
  try {
    // The thread ID is the same as the starter message ID for message-based threads
    const starterMessage = await thread.fetchStarterMessage();
    return starterMessage;
  } catch (error) {
    console.log(`[Discord] Could not fetch starter message for thread ${thread.id}:`, error);
    return null;
  }
}

// In-memory index for quick message -> submission lookups
// This is rebuilt on each message, file storage is source of truth
const messageToSubmissionId = new Map<string, string>();

// ============================================================================
// Event Handlers
// ============================================================================

discordClient.once(Events.ClientReady, (client) => {
  console.log(`[Discord] Bot ready: ${client.user?.tag}`);
  console.log(`[Discord] Watching guild: ${config.discordGuildId}`);
  console.log(`[Discord] Mission channel: ${config.discordMissionChannelId}`);
});

/**
 * Handle new messages in mission THREADS
 * Submissions are posted as replies in threads under mission posts.
 * Check if it's a submission (contains URL) and pre-create vote reactions.
 */
discordClient.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Only process messages in threads
  if (!message.channel.isThread()) return;

  const thread = message.channel as ThreadChannel;

  // Check if thread's parent is the mission channel
  if (thread.parentId !== config.discordMissionChannelId) return;

  // Check if message contains a URL (potential submission)
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = message.content.match(urlRegex);

  if (urls && urls.length > 0) {
    console.log(`[Discord] Submission in thread "${thread.name}" from ${message.author.tag}: ${urls[0]}`);

    // Ensure mission is registered (create if first submission)
    let mission = getMissionByThread(thread.id);
    if (!mission) {
      // Try to parse deadline from the thread's starter message (mission post)
      let deadline: Date | null = null;
      const starterMessage = await fetchThreadStarterMessage(thread);

      if (starterMessage) {
        deadline = parseDiscordTimestamp(starterMessage.content);
        if (deadline) {
          console.log(`[Discord] Parsed deadline from mission post: ${deadline.toISOString()}`);
        }
      }

      // Fallback: 7 days from now if no deadline found in post
      if (!deadline) {
        deadline = new Date();
        deadline.setDate(deadline.getDate() + 7);
        console.log(`[Discord] No deadline in post, using default: ${deadline.toISOString()}`);
      }

      mission = registerMission(thread.id, thread.name, deadline);
    }

    // Create submission in file storage
    const submission = createSubmission(
      message.id,
      message.channel.id,
      thread.id,
      mission.id,
      message.author.id,
      message.author.tag,
      message.content,
      urls
    );

    // Track in memory for quick lookups
    messageToSubmissionId.set(message.id, submission.id);

    // Append to Google Sheets immediately
    appendSubmissionToSheet(mission, submission).catch(err => {
      console.error('[Discord] Failed to append submission to sheets:', err);
    });

    // Add confirmation reaction and pre-create vote reactions
    try {
      // First add confirmation emoji
      await message.react(CONFIRMATION_EMOJI);
      console.log(`[Discord] Submission confirmed: ${message.id}`);

      // Pre-create all vote reactions (1-5) for judges to click
      for (const emoji of VOTE_EMOJI_ORDER) {
        await message.react(emoji);
      }
      console.log(`[Discord] Vote reactions pre-created on submission: ${message.id}`);
    } catch (error) {
      console.error('[Discord] Failed to add reactions:', error);
    }
  }
});

/**
 * Handle reaction additions
 * Process judge votes on confirmed submissions.
 * Non-judge reactions are removed to keep voting clean.
 */
discordClient.on(Events.MessageReactionAdd, async (reaction, user) => {
  // Ignore bot reactions (including our pre-created ones)
  if (user.bot) return;

  // Fetch partial data if needed
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('[Discord] Error fetching reaction:', error);
      return;
    }
  }

  const emoji = reaction.emoji.name;
  if (!emoji) return;

  // Check if this is a vote emoji
  const voteScore = VOTE_EMOJIS[emoji];
  if (voteScore === undefined) return;

  const messageId = reaction.message.id;

  // Look up submission (check memory first, then file storage)
  let submissionId = messageToSubmissionId.get(messageId);
  if (!submissionId) {
    const submission = getSubmissionByMessage(messageId);
    if (!submission) {
      // Not a tracked submission
      return;
    }
    submissionId = submission.id;
    messageToSubmissionId.set(messageId, submissionId);
  }

  // Check if user has judge role
  let member = reaction.message.guild?.members.cache.get(user.id);
  if (!member) {
    // Try to fetch member if not cached
    try {
      member = await reaction.message.guild?.members.fetch(user.id);
    } catch (e) {
      console.log(`[Discord] Could not fetch member ${user.id}`);
      return;
    }
  }

  const hasJudgeRole = config.discordJudgeRoleIds.some(roleId =>
    member?.roles.cache.has(roleId)
  );

  if (!hasJudgeRole) {
    // Remove non-judge reactions
    console.log(`[Discord] Removing non-judge reaction from ${user.tag}`);
    try {
      await reaction.users.remove(user.id);
    } catch (e) {
      console.error('[Discord] Failed to remove reaction:', e);
    }
    return;
  }

  // Record the judge vote to file storage
  recordVote(submissionId, user.id, voteScore);
  console.log(`[Discord] Judge vote recorded: ${user.tag} gave ${voteScore} to submission ${submissionId}`);

  // Update Google Sheets with new vote
  const updatedSubmission = getSubmissionByMessage(messageId);
  if (updatedSubmission) {
    const votes = updatedSubmission.votes.map(v => ({ judgeId: v.judgeId, score: v.score }));
    updateSubmissionVotes(updatedSubmission.missionId, submissionId, votes).catch(err => {
      console.error('[Discord] Failed to update votes in sheets:', err);
    });
  }
});

/**
 * Handle reaction removals
 * Remove vote if judge removes their reaction
 */
discordClient.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;

  const emoji = reaction.emoji.name;
  if (!emoji || !VOTE_EMOJIS[emoji]) return;

  const messageId = reaction.message.id;

  // Look up submission
  let submissionId = messageToSubmissionId.get(messageId);
  if (!submissionId) {
    const submission = getSubmissionByMessage(messageId);
    if (!submission) return;
    submissionId = submission.id;
  }

  // Remove the vote from file storage
  removeVote(submissionId, user.id);
  console.log(`[Discord] Vote removed: ${user.tag} from submission ${submissionId}`);

  // Update Google Sheets with removed vote
  const updatedSubmission = getSubmissionByMessage(messageId);
  if (updatedSubmission) {
    const votes = updatedSubmission.votes.map(v => ({ judgeId: v.judgeId, score: v.score }));
    updateSubmissionVotes(updatedSubmission.missionId, submissionId, votes).catch(err => {
      console.error('[Discord] Failed to update votes in sheets:', err);
    });
  }
});

// ============================================================================
// Bot Lifecycle
// ============================================================================

/**
 * Start the Discord bot
 */
export async function startDiscordBot(): Promise<void> {
  console.log('[Discord] Starting bot...');

  try {
    await discordClient.login(config.discordBotToken);
  } catch (error) {
    console.error('[Discord] Failed to login:', error);
    throw error;
  }
}

/**
 * Stop the Discord bot gracefully
 */
export async function stopDiscordBot(): Promise<void> {
  console.log('[Discord] Stopping bot...');
  await discordClient.destroy();
}

/**
 * Close/archive a mission thread
 * Called when deadline expires to prevent further submissions
 */
export async function closeThread(threadId: string, reason?: string): Promise<boolean> {
  try {
    const thread = await discordClient.channels.fetch(threadId);

    if (!thread || !thread.isThread()) {
      console.error(`[Discord] Thread not found or not a thread: ${threadId}`);
      return false;
    }

    const threadChannel = thread as ThreadChannel;

    // Post closing message
    const closingMessage = reason || '🔒 **Mission deadline reached.** This thread is now closed for submissions. Results will be posted shortly.';
    await threadChannel.send(closingMessage);

    // Lock the thread (prevent new messages) and archive it
    await threadChannel.setLocked(true, 'Mission deadline reached');
    await threadChannel.setArchived(true, 'Mission deadline reached');

    console.log(`[Discord] Thread closed and archived: ${threadId}`);
    return true;
  } catch (error) {
    console.error(`[Discord] Failed to close thread ${threadId}:`, error);
    return false;
  }
}
