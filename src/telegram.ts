/**
 * Telegram Bot
 *
 * Handles Telegram commands for Mission Control:
 * - /mission <topic> - Generate mission brief and create Discord thread
 * - /tweets <topic> - Generate tweet suggestions
 * - /status - Show current missions
 * - /help - Show available commands
 */

import { Bot, Context } from 'grammy';
import { config } from './config';
import { searchCampaigns, CampaignResult } from './services/notion';
import { generateMissionBrief, generateTweetSuggestions, MissionBriefResult, TweetSuggestion } from './services/claude';
import { createMissionThread } from './discord';
import {
  getActiveMissions,
  getMissionsPastDeadline,
  getMissionByTelegramMessage,
  updateMissionTelegramInfo,
  getMissionByThread,
  createSubmission,
} from './storage';
import { appendSubmissionToSheet, isSheetsConfigured } from './sheets';

let telegramBot: Bot | null = null;

/**
 * Check if message is from allowed chat
 */
function isAllowedChat(ctx: Context): boolean {
  const chatId = ctx.chat?.id?.toString();
  console.log(`[Telegram] DEBUG: isAllowedChat check - chatId=${chatId}, allowed=${config.telegramAllowedChatIds.join(',')}`);
  if (!chatId) return false;

  // Allow if no restrictions configured or if chat is in allowed list
  if (config.telegramAllowedChatIds.length === 0) return true;
  return config.telegramAllowedChatIds.includes(chatId);
}

/**
 * Escape special characters for Telegram MarkdownV2
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Send a long message, splitting if necessary
 */
async function sendLongMessage(ctx: Context, text: string, parseMode: 'MarkdownV2' | undefined = 'MarkdownV2'): Promise<void> {
  const MAX_LENGTH = 4000; // Telegram limit is 4096, leave buffer

  if (text.length <= MAX_LENGTH) {
    await ctx.reply(text, { parse_mode: parseMode });
    return;
  }

  // Split by double newlines (paragraph breaks)
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + '\n\n' + paragraph).length > MAX_LENGTH) {
      // Send current chunk
      if (currentChunk) {
        await ctx.reply(currentChunk, { parse_mode: parseMode });
      }
      currentChunk = paragraph;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n\n' + paragraph : paragraph;
    }
  }

  // Send remaining chunk
  if (currentChunk) {
    await ctx.reply(currentChunk, { parse_mode: parseMode });
  }
}

/**
 * Format mission brief for Telegram
 */
function formatMissionBrief(brief: MissionBriefResult, sourceCount: number): string {
  const lines: string[] = [];

  // Header
  lines.push(`🎯 *MISSION: ${escapeMarkdown(brief.title)}*`);
  lines.push('');

  // Key message
  lines.push('*KEY MESSAGE:*');
  lines.push(escapeMarkdown(brief.keyMessage));
  lines.push('');

  // Divider
  lines.push('━'.repeat(35));
  lines.push('');

  // Supporting points
  lines.push('*SUPPORTING POINTS:*');
  lines.push('');
  for (const point of brief.supportingPoints) {
    lines.push(`• ${escapeMarkdown(point)}`);
  }
  lines.push('');

  // Divider
  lines.push('━'.repeat(35));
  lines.push('');

  // Optional angles
  lines.push('*OPTIONAL ANGLES:*');
  lines.push('');
  for (const angle of brief.optionalAngles) {
    lines.push(`💡 ${escapeMarkdown(angle)}`);
  }
  lines.push('');

  // Divider
  lines.push('━'.repeat(35));
  lines.push('');

  // Example tweets
  lines.push('*EXAMPLE TWEETS:*');
  lines.push('');
  for (let i = 0; i < brief.exampleTweets.length; i++) {
    lines.push(`*Tweet ${i + 1}:*`);
    lines.push('```');
    lines.push(brief.exampleTweets[i]);
    lines.push('```');
    lines.push('');
  }

  // Divider
  lines.push('━'.repeat(35));
  lines.push('');

  // Sources
  lines.push('*SOURCES:*');
  for (const url of brief.sourceLinks) {
    lines.push(escapeMarkdown(url));
  }
  lines.push('');

  // Footer
  lines.push(`_Aggregated from ${sourceCount} campaign content piece${sourceCount > 1 ? 's' : ''}_`);

  return lines.join('\n');
}

/**
 * Format mission brief for Discord (plain text, no escaping)
 */
function formatMissionBriefForDiscord(brief: MissionBriefResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`🎯 **MISSION: ${brief.title}**`);
  lines.push('');

  // Key message
  lines.push('**KEY MESSAGE:**');
  lines.push(brief.keyMessage);
  lines.push('');

  // Supporting points
  lines.push('**SUPPORTING POINTS:**');
  for (const point of brief.supportingPoints) {
    lines.push(`• ${point}`);
  }
  lines.push('');

  // Optional angles
  lines.push('**OPTIONAL ANGLES:**');
  for (const angle of brief.optionalAngles) {
    lines.push(`💡 ${angle}`);
  }
  lines.push('');

  // Example tweets
  lines.push('**EXAMPLE TWEETS:**');
  for (let i = 0; i < brief.exampleTweets.length; i++) {
    lines.push(`**Tweet ${i + 1}:**`);
    lines.push('```');
    lines.push(brief.exampleTweets[i]);
    lines.push('```');
  }
  lines.push('');

  // Sources
  lines.push('**SOURCES:**');
  for (const url of brief.sourceLinks) {
    lines.push(url);
  }

  return lines.join('\n');
}

/**
 * Format tweet suggestions for Telegram
 */
function formatTweetSuggestions(topic: string, suggestions: TweetSuggestion[], sourceCount: number): string {
  const lines: string[] = [];

  // Header
  lines.push(`🐦 *TWEET SUGGESTIONS: ${escapeMarkdown(topic)}*`);
  lines.push('');
  lines.push('━'.repeat(35));
  lines.push('');

  // Each suggestion
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];

    lines.push(`*${i + 1}\\. ${escapeMarkdown(s.hook)}*`);
    lines.push('');
    lines.push(`📱 *Twitter:* ${escapeMarkdown(s.twitterAngle)}`);
    lines.push(`💼 *LinkedIn:* ${escapeMarkdown(s.linkedinAngle)}`);
    lines.push(`🔗 ${escapeMarkdown(s.sourceUrl)}`);
    lines.push('');
    lines.push('━'.repeat(35));
    lines.push('');
  }

  // Footer
  lines.push(`_Generated from ${sourceCount} content source${sourceCount > 1 ? 's' : ''}_`);

  return lines.join('\n');
}

// ============================================================================
// Bot Setup
// ============================================================================

/**
 * Start the Telegram bot
 */
export async function startTelegramBot(): Promise<void> {
  if (!config.telegramBotToken) {
    console.log('[Telegram] No token provided, skipping Telegram bot');
    return;
  }

  console.log('[Telegram] Starting bot...');
  console.log(`[Telegram] DEBUG: Allowed chat IDs: ${config.telegramAllowedChatIds.join(', ') || '(any)'}`);

  telegramBot = new Bot(config.telegramBotToken);

  // ============================================================================
  // /mission Command - Generate brief AND create Discord thread
  // ============================================================================
  telegramBot.command('mission', async (ctx) => {
    console.log(`[Telegram] DEBUG: /mission command received from chat ${ctx.chat?.id}`);

    if (!isAllowedChat(ctx)) {
      console.log(`[Telegram] DEBUG: Chat not allowed, ignoring`);
      return;
    }

    const topic = ctx.match?.trim();
    if (!topic) {
      await ctx.reply(
        '*Usage:* /mission <topic>\n\n' +
        '*Example:*\n' +
        '`/mission Morgan Stanley`\n' +
        '`/mission "Pyth V3 launch"`',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    console.log(`[Telegram] /mission command from ${ctx.from?.username}: "${topic}"`);

    // Check if Notion and Claude are configured
    if (!config.notionToken || !config.anthropicApiKey) {
      await ctx.reply(
        '*Error:* Notion and Claude API keys are not configured\\. Contact the bot admin\\.',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // Send progress message
    const progressMsg = await ctx.reply(`_Searching campaigns for "${escapeMarkdown(topic)}"..._`, { parse_mode: 'MarkdownV2' });

    try {
      // Step 1: Search Notion for campaigns
      console.log(`[Telegram] DEBUG: Searching Notion for "${topic}"`);
      const campaigns = await searchCampaigns(topic);
      console.log(`[Telegram] DEBUG: Found ${campaigns.length} campaigns`);

      if (campaigns.length === 0) {
        await ctx.reply(`*Error:* No campaigns found matching "${escapeMarkdown(topic)}"\\. Try a different search term\\.`, { parse_mode: 'MarkdownV2' });
        return;
      }

      // Update progress
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `_Found ${campaigns.length} campaign${campaigns.length > 1 ? 's' : ''}\\. Generating mission brief\\.\\.\\._`,
        { parse_mode: 'MarkdownV2' }
      );

      // Step 2: Aggregate content and generate brief
      const aggregatedContent = campaigns
        .map(c => `## ${c.title}\n\n${c.content}`)
        .join('\n\n---\n\n');
      const sourceUrls = campaigns.map(c => c.url);

      console.log(`[Telegram] DEBUG: Calling Claude to generate brief`);
      const brief = await generateMissionBrief(
        campaigns[0].title,
        aggregatedContent,
        sourceUrls
      );
      console.log(`[Telegram] DEBUG: Brief generated: "${brief.title}"`);

      // Step 3: Create Discord thread
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `_Brief generated\\. Creating Discord mission thread\\.\\.\\._`,
        { parse_mode: 'MarkdownV2' }
      );

      console.log(`[Telegram] DEBUG: Creating Discord thread`);
      const discordBrief = formatMissionBriefForDiscord(brief);
      const threadResult = await createMissionThread(brief.title, discordBrief);

      if (!threadResult.success) {
        console.error(`[Telegram] Failed to create Discord thread: ${threadResult.error}`);
        await ctx.reply(`*Warning:* Mission brief generated but Discord thread creation failed: ${escapeMarkdown(threadResult.error || 'Unknown error')}`, { parse_mode: 'MarkdownV2' });
      } else {
        console.log(`[Telegram] Discord thread created: ${threadResult.threadId}`);
      }

      // Step 4: Send the brief to Telegram announcement channel
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);

      const telegramMessage = formatMissionBrief(brief, campaigns.length);

      // Determine where to post the announcement
      const announcementChannelId = config.telegramAnnouncementChannelId;
      let missionAnnouncement;
      let announcementChatId: string;

      if (announcementChannelId) {
        // Post to dedicated announcement channel
        try {
          missionAnnouncement = await ctx.api.sendMessage(
            announcementChannelId,
            telegramMessage,
            { parse_mode: 'MarkdownV2' }
          );
          announcementChatId = announcementChannelId;
          console.log(`[Telegram] Mission announcement posted to channel ${announcementChannelId}: msgId=${missionAnnouncement.message_id}`);
        } catch (error) {
          console.error(`[Telegram] Failed to post to announcement channel:`, error);
          await ctx.reply(
            `⚠️ *Warning:* Could not post to announcement channel\\. Check bot permissions\\.`,
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }
      } else {
        // Fall back to posting in same chat
        missionAnnouncement = await ctx.reply(telegramMessage, { parse_mode: 'MarkdownV2' });
        announcementChatId = ctx.chat!.id.toString();
        console.log(`[Telegram] Mission announcement posted to same chat: msgId=${missionAnnouncement.message_id}`);
      }

      // Update mission with Telegram message ID for submission linking
      if (threadResult.success && threadResult.threadId) {
        const mission = getMissionByThread(threadResult.threadId);
        if (mission) {
          updateMissionTelegramInfo(
            mission.id,
            missionAnnouncement.message_id.toString(),
            announcementChatId
          );
        }
      }

      // Notify in command chat about success
      if (threadResult.success) {
        if (announcementChannelId) {
          await ctx.reply(
            `✅ *Mission created\\!*\n\n` +
            `• Discord thread created\n` +
            `• Announcement posted to Telegram channel\n\n` +
            `📝 Users can submit by replying to the mission announcement with their URL\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        } else {
          await ctx.reply(
            `✅ *Mission thread created in Discord*\n\n` +
            `📝 *To submit:* Reply to the mission message above with your URL\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        }
      }

    } catch (error) {
      console.error('[Telegram] Mission command error:', error);
      await ctx.reply(
        '*Error:* Something went wrong\\. Please try again\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }
  });

  // ============================================================================
  // /tweets Command
  // ============================================================================
  telegramBot.command('tweets', async (ctx) => {
    console.log(`[Telegram] DEBUG: /tweets command received from chat ${ctx.chat?.id}`);

    if (!isAllowedChat(ctx)) return;

    const topic = ctx.match?.trim();
    if (!topic) {
      await ctx.reply(
        '*Usage:* /tweets <topic>\n\n' +
        '*Example:*\n' +
        '`/tweets Pyth Pro`\n' +
        '`/tweets "Morgan Stanley"`',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    console.log(`[Telegram] /tweets command from ${ctx.from?.username}: "${topic}"`);

    // Check if Notion and Claude are configured
    if (!config.notionToken || !config.anthropicApiKey) {
      await ctx.reply(
        '*Error:* Notion and Claude API keys are not configured\\. Contact the bot admin\\.',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const progressMsg = await ctx.reply(`_Scanning content for "${escapeMarkdown(topic)}"..._`, { parse_mode: 'MarkdownV2' });

    try {
      // Search for content
      const campaigns = await searchCampaigns(topic);

      if (campaigns.length === 0) {
        await ctx.reply(`*Error:* No content found matching "${escapeMarkdown(topic)}"\\. Try a different search term\\.`, { parse_mode: 'MarkdownV2' });
        return;
      }

      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `_Found ${campaigns.length} source${campaigns.length > 1 ? 's' : ''}\\. Generating suggestions\\.\\.\\._`,
        { parse_mode: 'MarkdownV2' }
      );

      // Generate suggestions
      const contentPieces = campaigns.map(c => ({
        title: c.title,
        content: c.content,
        url: c.url,
      }));

      const suggestions = await generateTweetSuggestions(topic, contentPieces);

      // Send suggestions
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);

      const message = formatTweetSuggestions(topic, suggestions, campaigns.length);
      await sendLongMessage(ctx, message);

    } catch (error) {
      console.error('[Telegram] Tweets command error:', error);
      await ctx.reply(
        '*Error:* Something went wrong\\. Please try again\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }
  });

  // ============================================================================
  // /status Command
  // ============================================================================
  telegramBot.command('status', async (ctx) => {
    console.log(`[Telegram] DEBUG: /status command received`);
    if (!isAllowedChat(ctx)) return;

    const activeMissions = getActiveMissions();
    const pastDeadline = getMissionsPastDeadline();

    let message = '*Mission Control Status*\n\n';
    message += `Active missions: ${activeMissions.length}\n`;
    message += `Past deadline \\(pending export\\): ${pastDeadline.length}\n\n`;

    if (activeMissions.length > 0) {
      message += '*Active Missions:*\n';
      activeMissions.slice(0, 5).forEach(m => {
        const deadline = new Date(m.deadline).toLocaleDateString();
        message += `• ${escapeMarkdown(m.title)} \\(${deadline}\\)\n`;
      });
    }

    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
  });

  // ============================================================================
  // /help Command
  // ============================================================================
  telegramBot.command('help', async (ctx) => {
    console.log(`[Telegram] DEBUG: /help command received`);
    if (!isAllowedChat(ctx)) return;

    await ctx.reply(
      '*Mission Control Bot*\n\n' +
      '*Commands:*\n' +
      '/mission <topic> \\- Generate mission brief \\& create Discord thread\n' +
      '/tweets <topic> \\- Generate tweet suggestions\n' +
      '/status \\- Show current missions\n' +
      '/help \\- Show this message\n\n' +
      '*Content Submissions:*\n' +
      'Reply to a mission message with your URL to submit\\.\n' +
      'Submissions are linked to the specific mission and tracked in Google Sheets\\.\n\n' +
      '\\-\\-\\-\n' +
      '_Powered by Pyth Mission Control v2\\.0_',
      { parse_mode: 'MarkdownV2' }
    );
  });

  // ============================================================================
  // /start Command
  // ============================================================================
  telegramBot.command('start', async (ctx) => {
    console.log(`[Telegram] DEBUG: /start command received from chat ${ctx.chat?.id}`);
    await ctx.reply(
      '*Mission Control Bot*\n\n' +
      'Generate mission briefs from Notion content and create Discord threads for submissions\\.\n\n' +
      'Use /help to see available commands\\.',
      { parse_mode: 'MarkdownV2' }
    );
  });

  // ============================================================================
  // URL Detection - Mission-linked Submissions
  // ============================================================================
  telegramBot.on('message:text', async (ctx) => {
    // Skip commands
    if (ctx.message.text.startsWith('/')) return;

    const text = ctx.message.text;
    const chatId = ctx.chat?.id?.toString();

    // Check for URLs first
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);

    if (!urls || urls.length === 0) {
      return;
    }

    console.log(`[Telegram] URL detected from ${ctx.from?.username} in chat ${chatId}: ${urls[0]}`);

    // Check if this is a reply to a mission message
    const replyToId = ctx.message.reply_to_message?.message_id;

    // If it's a reply, check if it's a mission (allows submissions from announcement channel)
    if (replyToId) {
      const mission = getMissionByTelegramMessage(replyToId.toString());

      if (mission) {
        // This is a valid mission submission - process it
        // Verify the submission is in the correct chat (where mission was announced)
        if (mission.telegramChatId !== chatId) {
          console.log(`[Telegram] Submission chat ${chatId} doesn't match mission chat ${mission.telegramChatId}`);
          return;
        }

        // Check mission is still active
        if (mission.status !== 'active') {
          await ctx.reply('⚠️ This mission is closed\\.', {
            parse_mode: 'MarkdownV2',
            reply_to_message_id: ctx.message.message_id
          });
          return;
        }

        // Check if sheets is configured
        if (!isSheetsConfigured()) {
          console.log(`[Telegram] Google Sheets not configured, skipping submission`);
          return;
        }

        // Create submission (linked to mission)
        const submission = createSubmission(
          ctx.message.message_id.toString(),
          chatId,
          mission.threadId,
          mission.id,
          ctx.from?.id?.toString() || 'unknown',
          ctx.from?.username || ctx.from?.first_name || 'unknown',
          text,
          urls,
          'telegram'
        );

        // Append to Google Sheets
        const success = await appendSubmissionToSheet(mission, submission);

        if (success) {
          try {
            await ctx.react('👍');
          } catch (e) {
            console.log(`[Telegram] Could not add reaction, sending confirmation message`);
            await ctx.reply('✅ Submission recorded\\!', {
              parse_mode: 'MarkdownV2',
              reply_to_message_id: ctx.message.message_id
            });
          }
          console.log(`[Telegram] Submission ${submission.id} recorded for mission "${mission.title}"`);
        } else {
          await ctx.reply('⚠️ Failed to record submission\\. Please try again\\.', {
            parse_mode: 'MarkdownV2',
            reply_to_message_id: ctx.message.message_id
          });
        }
        return;
      }
    }

    // Not a mission reply - only respond if in allowed chat
    if (!isAllowedChat(ctx)) return;

    // Send hint about how to submit
    if (replyToId) {
      await ctx.reply('⚠️ This message is not a mission\\. Reply to an active mission to submit\\.', {
        parse_mode: 'MarkdownV2',
        reply_to_message_id: ctx.message.message_id
      });
    } else {
      await ctx.reply('💡 To submit, reply to a mission message with your URL', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  });

  // Error handling
  telegramBot.catch((err) => {
    console.error('[Telegram] Bot error:', err);
  });

  // Start polling
  await telegramBot.start({
    onStart: (botInfo) => {
      console.log(`[Telegram] Bot started: @${botInfo.username}`);
    },
  });
}

/**
 * Stop the Telegram bot gracefully
 */
export function stopTelegramBot(): void {
  if (telegramBot) {
    console.log('[Telegram] Stopping bot...');
    telegramBot.stop();
  }
}
