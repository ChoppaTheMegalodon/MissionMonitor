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
  TextChannel,
  ThreadChannel,
  ChannelType,
} from 'discord.js';
import { config } from './config';
import {
  registerMission,
  getMissionByThread,
  createSubmission,
  getSubmissionByMessage,
  getSubmissionsByMission,
  recordVote,
  removeVote,
  Mission,
  Submission,
} from './storage';
import { appendSubmissionToSheet, updateSubmissionVotes, isSheetsConfigured } from './sheets';

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
  console.log(`[Discord] Results channel: ${config.discordResultsChannelId}`);
  console.log(`[Discord] Judge role IDs: ${config.discordJudgeRoleIds.join(', ')}`);
  console.log(`[Discord] DEBUG: MessageContent intent enabled`);
});

/**
 * Handle ALL messages for debugging, then filter
 */
discordClient.on(Events.MessageCreate, async (message) => {
  // Debug: Log all messages
  console.log(`[Discord] DEBUG: MessageCreate event received`);
  console.log(`[Discord] DEBUG: - Author: ${message.author.tag} (bot: ${message.author.bot})`);
  console.log(`[Discord] DEBUG: - Channel: ${message.channel.id} (type: ${message.channel.type})`);
  console.log(`[Discord] DEBUG: - Content length: ${message.content.length}`);
  console.log(`[Discord] DEBUG: - Content preview: "${message.content.substring(0, 100)}${message.content.length > 100 ? '...' : ''}"`);

  // Ignore bot messages
  if (message.author.bot) {
    console.log(`[Discord] DEBUG: Ignoring bot message`);
    return;
  }

  // Only process messages in threads
  if (!message.channel.isThread()) {
    console.log(`[Discord] DEBUG: Not a thread (channel type: ${message.channel.type}), checking if mission channel...`);

    // If it's in the mission channel directly, log for debugging
    if (message.channel.id === config.discordMissionChannelId) {
      console.log(`[Discord] DEBUG: Message in mission channel directly - use threads for submissions`);
    }
    return;
  }

  const thread = message.channel as ThreadChannel;
  console.log(`[Discord] DEBUG: Message in thread "${thread.name}" (parent: ${thread.parentId})`);

  // Check if thread's parent is the mission channel
  if (thread.parentId !== config.discordMissionChannelId) {
    console.log(`[Discord] DEBUG: Thread parent (${thread.parentId}) doesn't match mission channel (${config.discordMissionChannelId})`);
    return;
  }

  console.log(`[Discord] DEBUG: Thread is under mission channel - checking for URLs`);

  // Check if message contains a URL (potential submission)
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = message.content.match(urlRegex);

  console.log(`[Discord] DEBUG: URL regex match result: ${urls ? urls.join(', ') : 'null'}`);

  if (urls && urls.length > 0) {
    console.log(`[Discord] Submission in thread "${thread.name}" from ${message.author.tag}: ${urls[0]}`);

    // Ensure mission is registered (create if first submission)
    let mission = getMissionByThread(thread.id);
    if (!mission) {
      console.log(`[Discord] DEBUG: No mission found for thread, creating default mission`);
      // Default deadline: 7 days from now (can be updated via command)
      const defaultDeadline = new Date();
      defaultDeadline.setDate(defaultDeadline.getDate() + 7);
      mission = registerMission(thread.id, thread.name, defaultDeadline);
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
      urls,
      'discord'
    );

    // Track in memory for quick lookups
    messageToSubmissionId.set(message.id, submission.id);

    // Append to Google Sheets (real-time)
    if (isSheetsConfigured()) {
      appendSubmissionToSheet(mission, submission).catch(err => {
        console.error('[Discord] Failed to append to sheets:', err);
      });
    }

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
  } else {
    console.log(`[Discord] DEBUG: No URLs found in message`);
  }
});

/**
 * Handle reaction additions
 * Process judge votes on confirmed submissions.
 * Non-judge reactions are removed to keep voting clean.
 */
discordClient.on(Events.MessageReactionAdd, async (reaction, user) => {
  console.log(`[Discord] DEBUG: ReactionAdd event - emoji: ${reaction.emoji.name}, user: ${user.tag}`);

  // Ignore bot reactions (including our pre-created ones)
  if (user.bot) {
    console.log(`[Discord] DEBUG: Ignoring bot reaction`);
    return;
  }

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
  if (voteScore === undefined) {
    console.log(`[Discord] DEBUG: Not a vote emoji: ${emoji}`);
    return;
  }

  const messageId = reaction.message.id;
  console.log(`[Discord] DEBUG: Vote emoji ${emoji} (score ${voteScore}) on message ${messageId}`);

  // Look up submission (check memory first, then file storage)
  let submissionId = messageToSubmissionId.get(messageId);
  if (!submissionId) {
    const submission = getSubmissionByMessage(messageId);
    if (!submission) {
      console.log(`[Discord] DEBUG: Message ${messageId} is not a tracked submission`);
      return;
    }
    submissionId = submission.id;
    messageToSubmissionId.set(messageId, submissionId);
  }

  console.log(`[Discord] DEBUG: Found submission ${submissionId}`);

  // Check if user has judge role
  let member = reaction.message.guild?.members.cache.get(user.id);
  if (!member) {
    // Try to fetch member if not cached
    try {
      member = await reaction.message.guild?.members.fetch(user.id);
    } catch (e) {
      console.log(`[Discord] DEBUG: Could not fetch member ${user.id}`);
      return;
    }
  }

  const memberRoles = member?.roles.cache.map(r => r.id) || [];
  console.log(`[Discord] DEBUG: User roles: ${memberRoles.join(', ')}`);
  console.log(`[Discord] DEBUG: Required judge roles: ${config.discordJudgeRoleIds.join(', ')}`);

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

  // Update Google Sheets with new vote data
  if (isSheetsConfigured()) {
    const submission = getSubmissionByMessage(messageId);
    if (submission) {
      const votes = submission.votes.map(v => ({ judgeId: v.judgeId, score: v.score }));
      // Re-add current vote since recordVote was just called
      const existingIdx = votes.findIndex(v => v.judgeId === user.id);
      if (existingIdx >= 0) {
        votes[existingIdx].score = voteScore;
      } else {
        votes.push({ judgeId: user.id, score: voteScore });
      }
      updateSubmissionVotes(submission.missionId, submissionId, votes).catch(err => {
        console.error('[Discord] Failed to update sheet votes:', err);
      });
    }
  }
});

/**
 * Handle reaction removals
 * Remove vote if judge removes their reaction
 */
discordClient.on(Events.MessageReactionRemove, async (reaction, user) => {
  console.log(`[Discord] DEBUG: ReactionRemove event - emoji: ${reaction.emoji.name}, user: ${user.tag}`);

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
});

// ============================================================================
// Mission Creation (called from Telegram)
// ============================================================================

/**
 * Create a mission thread in the mission channel
 * Returns the thread ID if successful
 */
export async function createMissionThread(
  title: string,
  briefContent: string,
  deadlineDays: number = 7
): Promise<{ success: boolean; threadId?: string; error?: string }> {
  console.log(`[Discord] DEBUG: createMissionThread called - title="${title}"`);

  try {
    const channel = discordClient.channels.cache.get(config.discordMissionChannelId);

    if (!channel) {
      console.error(`[Discord] Mission channel not found: ${config.discordMissionChannelId}`);
      return { success: false, error: 'Mission channel not found' };
    }

    if (channel.type !== ChannelType.GuildText) {
      console.error(`[Discord] Mission channel is not a text channel`);
      return { success: false, error: 'Mission channel is not a text channel' };
    }

    const textChannel = channel as TextChannel;

    // Create thread name (limit to 100 chars)
    const threadName = title.length > 97 ? title.substring(0, 97) + '...' : title;

    // Create a public thread
    const thread = await textChannel.threads.create({
      name: threadName,
      autoArchiveDuration: 10080, // 7 days
      reason: 'Mission created via Telegram bot',
    });

    console.log(`[Discord] Thread created: ${thread.id} - "${threadName}"`);

    // Post the mission brief as the first message
    await thread.send(briefContent);
    console.log(`[Discord] Mission brief posted to thread`);

    // Register the mission in storage
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + deadlineDays);
    registerMission(thread.id, title, deadline, briefContent);

    return { success: true, threadId: thread.id };
  } catch (error) {
    console.error('[Discord] Failed to create mission thread:', error);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// Thread Management
// ============================================================================

/**
 * Close a thread (lock it to prevent further messages)
 * Called when mission deadline passes
 */
export async function closeThread(threadId: string): Promise<boolean> {
  try {
    const thread = discordClient.channels.cache.get(threadId) as ThreadChannel;

    if (!thread) {
      console.log(`[Discord] Thread ${threadId} not found in cache, trying to fetch`);
      try {
        const fetchedThread = await discordClient.channels.fetch(threadId) as ThreadChannel;
        if (fetchedThread && fetchedThread.isThread()) {
          await fetchedThread.setLocked(true);
          await fetchedThread.setArchived(true);
          console.log(`[Discord] Thread ${threadId} closed and archived`);
          return true;
        }
      } catch (e) {
        console.error(`[Discord] Failed to fetch thread ${threadId}:`, e);
        return false;
      }
    }

    if (thread && thread.isThread()) {
      await thread.setLocked(true);
      await thread.setArchived(true);
      console.log(`[Discord] Thread ${threadId} closed and archived`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`[Discord] Failed to close thread ${threadId}:`, error);
    return false;
  }
}

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
    console.log('[Discord] Login successful');
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
