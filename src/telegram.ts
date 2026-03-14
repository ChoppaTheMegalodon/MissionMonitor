/**
 * Telegram Bot
 *
 * Handles Telegram commands for Mission Control:
 * - /mission <topic> - Generate mission brief and create Discord thread
 * - /tweets <topic> - Generate tweet suggestions
 * - /status - Show current missions
 * - /help - Show available commands
 */

import * as https from 'https';
import { Bot, Context } from 'grammy';
import { config } from './config';

// Force IPv4 — IPv6 is broken on this server and node-fetch tries it first
const ipv4Agent = new https.Agent({ family: 4 });
import { searchCampaigns, CampaignResult } from './services/notion';
import { generateMissionBrief, generateTweetSuggestions, MissionBriefResult, TweetSuggestion } from './services/claude';
import { createMissionThread, DEFAULT_MISSION_ROLE_IDS } from './discord';
import {
  getActiveMissions,
  getMissionsPastDeadline,
  getMissionByTelegramMessage,
  updateMissionTelegramInfo,
  getMissionByThread,
  createSubmission,
  getTemplateByName,
  createReferralCode,
  getReferralByCode,
  registerReferralAttribution,
  linkDiscordId,
  getReferralStats,
  recordReferralPayout,
  setSolanaWallet,
  setReferrerSolanaWallet,
} from './storage';
import {
  handleTemplateMissionCommand,
  handleListTemplatesCommand,
  handleViewTemplateCommand,
  handleCreateTemplateCommand,
  handleDeleteTemplateCommand,
} from './commands/handlers';
import { appendSubmissionToSheet, appendReferralPayoutToSheet, isSheetsConfigured } from './sheets';

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
 * Check if message is from a private (DM) chat
 */
function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private';
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
 * Download a file from Telegram by file ID and return its content as a UTF-8 string
 */
async function downloadTelegramFile(fileId: string, token: string): Promise<string> {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, {
    agent: ipv4Agent as any,
  });
  const data = (await res.json()) as any;
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`Failed to get file path: ${JSON.stringify(data)}`);
  }
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${data.result.file_path}`, {
    agent: ipv4Agent as any,
  });
  if (!fileRes.ok) {
    throw new Error(`Failed to download file: ${fileRes.statusText}`);
  }
  return await fileRes.text();
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

  telegramBot = new Bot(config.telegramBotToken, {
    client: { baseFetchConfig: { agent: ipv4Agent as any } },
  });

  // ============================================================================
  // /mission Command - Generate brief AND create Discord thread
  // ============================================================================
  telegramBot.command('mission', async (ctx) => {
    console.log(`[Telegram] DEBUG: /mission command received from chat ${ctx.chat?.id}`);

    if (!isPrivateChat(ctx)) {
      console.log(`[Telegram] DEBUG: Not a private chat, ignoring command`);
      return;
    }

    const topic = ctx.match?.trim();
    if (!topic) {
      await ctx.reply(
        '*Usage:* /mission \\<topic\\>\n\n' +
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
      const threadResult = await createMissionThread(brief.title, discordBrief, 7, { roleIds: DEFAULT_MISSION_ROLE_IDS });

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
      // Priority: Channel (nested comments) > Legacy group > Same chat
      const channelId = config.telegramChannelId;
      const legacyChannelId = config.telegramAnnouncementChannelId;
      let missionAnnouncement;
      let announcementChatId: string;

      if (channelId) {
        // Post to Telegram Channel (comments appear nested via linked Discussion Group)
        try {
          missionAnnouncement = await ctx.api.sendMessage(
            channelId,
            telegramMessage,
            { parse_mode: 'MarkdownV2' }
          );
          announcementChatId = channelId;
          console.log(`[Telegram] Mission posted to channel ${channelId}: msgId=${missionAnnouncement.message_id}`);
        } catch (error) {
          console.error(`[Telegram] Failed to post to channel:`, error);
          await ctx.reply(
            `⚠️ *Warning:* Could not post to channel\\. Check bot permissions\\.`,
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }
      } else if (legacyChannelId) {
        // Legacy: Post to dedicated announcement group
        try {
          missionAnnouncement = await ctx.api.sendMessage(
            legacyChannelId,
            telegramMessage,
            { parse_mode: 'MarkdownV2' }
          );
          announcementChatId = legacyChannelId;
          console.log(`[Telegram] Mission announcement posted to legacy channel ${legacyChannelId}: msgId=${missionAnnouncement.message_id}`);
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
        if (channelId || legacyChannelId) {
          await ctx.reply(
            `✅ *Mission created\\!*\n\n` +
            `• Discord thread created\n` +
            `• Announcement posted to Telegram ${channelId ? 'channel' : 'group'}\n\n` +
            `📝 Users can submit by ${channelId ? 'commenting on the channel post' : 'replying to the mission announcement'} with their URL\\.`,
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

    if (!isPrivateChat(ctx)) return;

    const topic = ctx.match?.trim();
    if (!topic) {
      await ctx.reply(
        '*Usage:* /tweets \\<topic\\>\n\n' +
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
    if (!isPrivateChat(ctx)) return;

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
    if (!isPrivateChat(ctx)) return;

    await ctx.reply(
      '*Mission Control Bot*\n\n' +
      '*Quick Mission:*\n' +
      '1\\. Send your mission brief as a message\n' +
      '2\\. Reply to it with: /create title\\="Title" deadline\\=3\n\n' +
      '*Other Commands:*\n' +
      '/mission \\<topic\\> \\- Generate brief from Notion \\& create thread\n' +
      '/tweets \\<topic\\> \\- Generate tweet suggestions\n' +
      '/status \\- Show current missions\n\n' +
      '*Template Commands:*\n' +
      '/tm \\<name\\> \\[var\\=val\\] \\- Create mission from template\n' +
      '/templates \\- List all templates\n' +
      '/tnew \\- Create a new template\n' +
      '/tview \\<name\\> \\- View template details\n' +
      '/tdel \\<name\\> \\- Delete a template\n\n' +
      '*Referral Commands:*\n' +
      '/referral \\- Get your referral link\n' +
      '/referrals \\- View your referral stats\n' +
      '/wallet \\<sol\\_address\\> \\- Set your payout wallet\n' +
      '/link \\<discord\\_id\\> \\- Link Discord for submission tracking\n\n' +
      '*Admin Commands:*\n' +
      '/payout \\<sub\\_id\\> \\<amount\\> \\- Record payout \\(triggers referral bonus\\)\n\n' +
      '*Content Submissions \\(group chat\\):*\n' +
      'Reply to a mission message with your URL to submit\\.\n\n' +
      '\\-\\-\\-\n' +
      '_Powered by Pyth Mission Control v2\\.0_',
      { parse_mode: 'MarkdownV2' }
    );
  });

  // ============================================================================
  // Template Argument Parser
  // ============================================================================

  /**
   * Parse "/tm weekly topic="Pyth V3" deadline_days=3" into
   * { templateName: "weekly", variables: { topic: "Pyth V3", deadline_days: "3" } }
   */
  function parseTemplateArgs(input: string): { templateName: string; variables: Record<string, string> } {
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (inQuote) {
        if (ch === quoteChar) {
          inQuote = false;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === ' ') {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current) parts.push(current);

    const templateName = parts[0] || '';
    const variables: Record<string, string> = {};
    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx > 0) {
        variables[parts[i].slice(0, eqIdx)] = parts[i].slice(eqIdx + 1);
      }
    }
    return { templateName, variables };
  }

  /**
   * Parse key=value pairs from command text (for /tnew)
   */
  function parseKeyValueArgs(input: string): Record<string, string> {
    const result: Record<string, string> = {};
    const regex = /(\w+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    let match;
    while ((match = regex.exec(input)) !== null) {
      result[match[1]] = match[2] ?? match[3] ?? match[4];
    }
    return result;
  }

  // ============================================================================
  // /tm Command — Create mission from template
  // ============================================================================
  telegramBot.command('tm', async (ctx) => {
    console.log(`[Telegram] DEBUG: /tm command received from chat ${ctx.chat?.id}`);
    if (!isPrivateChat(ctx)) return;

    const rawArgs = ctx.match?.trim();
    if (!rawArgs) {
      await ctx.reply(
        '*Usage:* /tm \\<template\\-name\\> \\[var\\=val \\.\\.\\.\\]\n\n' +
        '*Example:*\n' +
        '\\`/tm weekly topic\\="Pyth V3"\\`\n' +
        '\\`/tm weekly topic\\="Pyth V3" deadline\\_days\\=3\\`',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const { templateName, variables } = parseTemplateArgs(rawArgs);
    if (!templateName) {
      await ctx.reply('*Error:* Please provide a template name\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const result = handleTemplateMissionCommand(templateName, variables);
    if (!result.success) {
      await ctx.reply(`*Error:* ${escapeMarkdown(result.error || 'Unknown error')}`, { parse_mode: 'MarkdownV2' });
      return;
    }

    // Create Discord thread (same flow as /mission)
    const progressMsg = await ctx.reply(
      `_Creating mission from template "${escapeMarkdown(templateName)}"\\.\\.\\._`,
      { parse_mode: 'MarkdownV2' }
    );

    try {
      console.log(`[Telegram] Creating Discord thread from template: "${result.title}"`);
      const template = getTemplateByName(templateName);
      const roleIds = template?.roleIds ?? DEFAULT_MISSION_ROLE_IDS;
      const threadResult = await createMissionThread(result.title, result.resolvedBrief, result.deadlineDays, { roleIds });

      if (!threadResult.success) {
        console.error(`[Telegram] Failed to create Discord thread: ${threadResult.error}`);
        await ctx.reply(
          `*Error:* Discord thread creation failed: ${escapeMarkdown(threadResult.error || 'Unknown error')}`,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      console.log(`[Telegram] Discord thread created: ${threadResult.threadId}`);

      // Delete progress message
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);

      // Build Telegram announcement
      let announcementText: string;
      if (result.announcementText) {
        announcementText = escapeMarkdown(result.announcementText);
      } else {
        const briefPreview = result.resolvedBrief.length > 300
          ? result.resolvedBrief.slice(0, 300) + '...'
          : result.resolvedBrief;
        const deadlineDate = new Date(Date.now() + result.deadlineDays * 24 * 60 * 60 * 1000);
        const deadlineStr = deadlineDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        announcementText =
          `🎯 *MISSION: ${escapeMarkdown(result.title)}*\n\n` +
          `${escapeMarkdown(briefPreview)}\n\n` +
          `━`.repeat(35) + `\n` +
          `⏰ *Deadline:* ${escapeMarkdown(deadlineStr)}\n` +
          `📝 ${config.telegramChannelId ? 'Comment on this post' : 'Reply to this message'} with your URL to submit\\.`;
      }

      // Post announcement — Priority: Channel > Legacy group > Same chat
      const tmplChannelId = config.telegramChannelId;
      const tmplLegacyChannelId = config.telegramAnnouncementChannelId;
      let missionAnnouncement;
      let announcementChatId: string;

      if (tmplChannelId) {
        try {
          missionAnnouncement = await ctx.api.sendMessage(
            tmplChannelId,
            announcementText,
            { parse_mode: 'MarkdownV2' }
          );
          announcementChatId = tmplChannelId;
          console.log(`[Telegram] Template mission posted to channel ${tmplChannelId}: msgId=${missionAnnouncement.message_id}`);
        } catch (error) {
          console.error(`[Telegram] Failed to post to channel:`, error);
          await ctx.reply(
            `⚠️ *Warning:* Could not post to channel\\. Check bot permissions\\.`,
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }
      } else if (tmplLegacyChannelId) {
        try {
          missionAnnouncement = await ctx.api.sendMessage(
            tmplLegacyChannelId,
            announcementText,
            { parse_mode: 'MarkdownV2' }
          );
          announcementChatId = tmplLegacyChannelId;
          console.log(`[Telegram] Template mission announcement posted to legacy channel ${tmplLegacyChannelId}`);
        } catch (error) {
          console.error(`[Telegram] Failed to post to announcement channel:`, error);
          await ctx.reply(
            `⚠️ *Warning:* Could not post to announcement channel\\. Check bot permissions\\.`,
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }
      } else {
        missionAnnouncement = await ctx.reply(announcementText, { parse_mode: 'MarkdownV2' });
        announcementChatId = ctx.chat!.id.toString();
      }

      // Link mission to Telegram
      if (threadResult.threadId) {
        const mission = getMissionByThread(threadResult.threadId);
        if (mission) {
          updateMissionTelegramInfo(
            mission.id,
            missionAnnouncement.message_id.toString(),
            announcementChatId
          );
        }
      }

      // Confirm success
      if (tmplChannelId || tmplLegacyChannelId) {
        await ctx.reply(
          `✅ *Mission created from template "${escapeMarkdown(templateName)}"\\!*\n\n` +
          `• Discord thread created\n` +
          `• Announcement posted to Telegram ${tmplChannelId ? 'channel' : 'group'}\n\n` +
          `📝 Users can submit by ${tmplChannelId ? 'commenting on the channel post' : 'replying to the mission announcement'} with their URL\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      } else {
        await ctx.reply(
          `✅ *Mission created from template "${escapeMarkdown(templateName)}"\\!*\n\n` +
          `📝 *To submit:* Reply to the mission message above with your URL\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      }

    } catch (error) {
      console.error('[Telegram] /tm command error:', error);
      await ctx.reply('*Error:* Something went wrong\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
    }
  });

  // ============================================================================
  // /templates Command — List all templates
  // ============================================================================
  telegramBot.command('templates', async (ctx) => {
    console.log(`[Telegram] DEBUG: /templates command received`);
    if (!isPrivateChat(ctx)) return;

    const result = handleListTemplatesCommand();
    await ctx.reply(result.message!, { parse_mode: 'MarkdownV2' });
  });

  // ============================================================================
  // /tnew Command — Create a new template
  // ============================================================================
  telegramBot.command('tnew', async (ctx) => {
    console.log(`[Telegram] DEBUG: /tnew command received from chat ${ctx.chat?.id}`);
    if (!isPrivateChat(ctx)) return;

    const rawArgs = ctx.match?.trim() || '';
    const args = parseKeyValueArgs(rawArgs);

    if (!args.name) {
      await ctx.reply(
        '*Usage:* Reply to a message with the brief text, then:\n' +
        '\\`/tnew name\\=weekly deadline\\=7\\`\n\n' +
        'Or inline:\n' +
        '\\`/tnew name\\=weekly deadline\\=7 brief\\="Your brief text"\\`',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // Get brief content from reply or inline
    let briefContent = args.brief;
    if (!briefContent) {
      const replyText = ctx.message?.reply_to_message?.text;
      if (!replyText) {
        await ctx.reply(
          '*Error:* No brief content\\. Either reply to a message containing the brief, or use `brief\\="your text"`\\.',
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
      briefContent = replyText;
    }

    const deadlineDays = args.deadline ? parseInt(args.deadline, 10) : 7;
    if (isNaN(deadlineDays) || deadlineDays < 1) {
      await ctx.reply('*Error:* Deadline must be a positive number of days\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const result = handleCreateTemplateCommand({
      name: args.name,
      briefContent,
      defaultDeadlineDays: deadlineDays,
      claudePromptOverride: args.prompt,
      announcementFormat: args.announcement,
    });

    if (result.success) {
      await ctx.reply(result.message!, { parse_mode: 'MarkdownV2' });
    } else {
      await ctx.reply(`*Error:* ${escapeMarkdown(result.error || 'Unknown error')}`, { parse_mode: 'MarkdownV2' });
    }
  });

  // ============================================================================
  // /tview Command — View template details
  // ============================================================================
  telegramBot.command('tview', async (ctx) => {
    console.log(`[Telegram] DEBUG: /tview command received`);
    if (!isPrivateChat(ctx)) return;

    const name = ctx.match?.trim();
    if (!name) {
      await ctx.reply('*Usage:* /tview \\<template\\-name\\>', { parse_mode: 'MarkdownV2' });
      return;
    }

    const result = handleViewTemplateCommand(name);
    if (result.success) {
      await ctx.reply(result.message!, { parse_mode: 'MarkdownV2' });
    } else {
      await ctx.reply(`*Error:* ${escapeMarkdown(result.error || 'Unknown error')}`, { parse_mode: 'MarkdownV2' });
    }
  });

  // ============================================================================
  // /tdel Command — Delete a template
  // ============================================================================
  telegramBot.command('tdel', async (ctx) => {
    console.log(`[Telegram] DEBUG: /tdel command received`);
    if (!isPrivateChat(ctx)) return;

    const name = ctx.match?.trim();
    if (!name) {
      await ctx.reply('*Usage:* /tdel \\<template\\-name\\>', { parse_mode: 'MarkdownV2' });
      return;
    }

    const result = handleDeleteTemplateCommand(name);
    if (result.success) {
      await ctx.reply(result.message!, { parse_mode: 'MarkdownV2' });
    } else {
      await ctx.reply(`*Error:* ${escapeMarkdown(result.error || 'Unknown error')}`, { parse_mode: 'MarkdownV2' });
    }
  });

  // ============================================================================
  // /create Command — Create mission from replied-to brief message
  // ============================================================================
  telegramBot.command('create', async (ctx) => {
    console.log(`[Telegram] DEBUG: /create command received from chat ${ctx.chat?.id}`);
    if (!isPrivateChat(ctx)) return;

    // Must be a reply to a message containing the brief (text or .md file)
    let replyText = ctx.message?.reply_to_message?.text;

    // If no text, check for a .md document attachment
    if (!replyText) {
      const doc = (ctx.message?.reply_to_message as any)?.document;
      if (doc && doc.file_name && doc.file_name.endsWith('.md')) {
        try {
          replyText = await downloadTelegramFile(doc.file_id, config.telegramBotToken!);
        } catch (err) {
          console.error('[Telegram] Failed to download .md file:', err);
          await ctx.reply('*Error:* Failed to download the \\.md file\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
          return;
        }
      }
    }

    if (!replyText) {
      await ctx.reply(
        '*Usage:* Send your mission brief as a message \\(or upload a \\.md file\\), then reply to it with:\n' +
        '\\`/create title\\="Mission Title" deadline\\=3\\`\n\n' +
        '_deadline is in days \\(default: 7\\)_\n' +
        '_Add \\`silent\\=true\\` to skip role pings \\(for testing\\)_',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const rawArgs = ctx.match?.trim() || '';
    const args = parseKeyValueArgs(rawArgs);

    if (!args.title) {
      await ctx.reply(
        '*Error:* title is required\\.\n\n' +
        '*Example:* \\`/create title\\="Pyth V3 Launch" deadline\\=3\\`',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const title = args.title;
    const deadlineDays = args.deadline ? parseInt(args.deadline, 10) : 7;
    const silent = args.silent === 'true' || args.silent === 'yes';
    if (isNaN(deadlineDays) || deadlineDays < 1) {
      await ctx.reply('*Error:* Deadline must be a positive number of days\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const progressMsg = await ctx.reply(
      `_Creating mission "${escapeMarkdown(title)}"\\.\\.\\._`,
      { parse_mode: 'MarkdownV2' }
    );

    try {
      // Create Discord thread with embed + role pings
      console.log(`[Telegram] /create creating Discord thread: "${title}"`);
      const threadResult = await createMissionThread(title, replyText, deadlineDays, { roleIds: silent ? [] : DEFAULT_MISSION_ROLE_IDS });

      if (!threadResult.success) {
        console.error(`[Telegram] Failed to create Discord thread: ${threadResult.error}`);
        await ctx.reply(
          `*Error:* Discord thread creation failed: ${escapeMarkdown(threadResult.error || 'Unknown error')}`,
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }

      console.log(`[Telegram] Discord thread created: ${threadResult.threadId}`);

      // Delete progress message
      await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id);

      // Build Telegram announcement
      const briefPreview = replyText.length > 300
        ? replyText.slice(0, 300) + '...'
        : replyText;
      const deadlineDate = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);
      const deadlineStr = deadlineDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const announcementText =
        `🎯 *MISSION: ${escapeMarkdown(title)}*\n\n` +
        `${escapeMarkdown(briefPreview)}\n\n` +
        `━`.repeat(35) + `\n` +
        `⏰ *Deadline:* ${escapeMarkdown(deadlineStr)}\n` +
        `📝 ${config.telegramChannelId ? 'Comment on this post' : 'Reply to this message'} with your URL to submit\\.`;

      // Post announcement to group — Priority: Channel > Legacy group > Same chat
      const channelId = config.telegramChannelId;
      const legacyAnnouncementChannelId = config.telegramAnnouncementChannelId;
      let missionAnnouncement;
      let announcementChatId: string;

      if (channelId) {
        // Post to Telegram Channel (comments appear nested via linked Discussion Group)
        try {
          missionAnnouncement = await ctx.api.sendMessage(
            channelId,
            announcementText,
            { parse_mode: 'MarkdownV2' }
          );
          announcementChatId = channelId;
          console.log(`[Telegram] /create mission posted to channel ${channelId}: msgId=${missionAnnouncement.message_id}`);
        } catch (error) {
          console.error(`[Telegram] Failed to post to channel:`, error);
          await ctx.reply(
            `⚠️ *Warning:* Could not post to channel\\. Check bot permissions\\.`,
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }
      } else if (legacyAnnouncementChannelId) {
        // Legacy: Post to dedicated announcement group
        try {
          missionAnnouncement = await ctx.api.sendMessage(
            legacyAnnouncementChannelId,
            announcementText,
            { parse_mode: 'MarkdownV2' }
          );
          announcementChatId = legacyAnnouncementChannelId;
          console.log(`[Telegram] /create announcement posted to legacy channel ${legacyAnnouncementChannelId}`);
        } catch (error) {
          console.error(`[Telegram] Failed to post to announcement channel:`, error);
          await ctx.reply(
            `⚠️ *Warning:* Could not post to announcement channel\\. Check bot permissions\\.`,
            { parse_mode: 'MarkdownV2' }
          );
          return;
        }
      } else {
        missionAnnouncement = await ctx.reply(announcementText, { parse_mode: 'MarkdownV2' });
        announcementChatId = ctx.chat!.id.toString();
      }

      // Link mission to Telegram
      if (threadResult.threadId) {
        const mission = getMissionByThread(threadResult.threadId);
        if (mission) {
          updateMissionTelegramInfo(
            mission.id,
            missionAnnouncement.message_id.toString(),
            announcementChatId
          );
        }
      }

      // Confirm success in DM
      await ctx.reply(
        `✅ *Mission created\\!*\n\n` +
        `• Discord thread created with role pings\n` +
        `• Announcement posted to Telegram channel\n\n` +
        `📝 Users can submit by replying to the mission announcement with their URL\\.`,
        { parse_mode: 'MarkdownV2' }
      );

    } catch (error) {
      console.error('[Telegram] /create command error:', error);
      await ctx.reply('*Error:* Something went wrong\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
    }
  });

  // ============================================================================
  // /test-channel — Test channel posting + submission flow (no Discord needed)
  // ============================================================================
  telegramBot.command('testchannel', async (ctx) => {
    if (!isPrivateChat(ctx)) return;

    const channelId = config.telegramChannelId;
    if (!channelId) {
      await ctx.reply('TELEGRAM_CHANNEL_ID not configured.');
      return;
    }

    try {
      // Post a test mission to the channel
      const testText =
        `🎯 *MISSION: Channel Test*\n\n` +
        `This is a test mission to verify channel \\+ discussion group flow\\.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⏰ *Deadline:* Tomorrow\n` +
        `📝 Comment on this post with your URL to submit\\.`;

      const msg = await ctx.api.sendMessage(channelId, testText, { parse_mode: 'MarkdownV2' });
      console.log(`[Telegram] Test channel post: msgId=${msg.message_id} in channel ${channelId}`);

      // Register a fake mission so submissions work
      const { registerMission, updateMissionTelegramInfo, getMissionByThread } = await import('./storage');
      const fakeThreadId = `test-${Date.now()}`;
      const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
      registerMission(fakeThreadId, 'Channel Test', deadline, 'Test mission for channel flow');

      const mission = getMissionByThread(fakeThreadId);
      if (mission) {
        updateMissionTelegramInfo(mission.id, msg.message_id.toString(), channelId);
      }

      await ctx.reply(
        `✅ Test mission posted to channel\\!\n\n` +
        `• Channel msg ID: \`${msg.message_id}\`\n` +
        `• Mission ID: \`${mission?.id}\`\n\n` +
        `Now comment on the channel post with a URL from another account to test submissions\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    } catch (error: any) {
      console.error('[Telegram] /testchannel error:', error);
      await ctx.reply(`Error: ${error.message}`);
    }
  });

  // ============================================================================
  // /start Command — handles referral deep links
  // ============================================================================
  telegramBot.command('start', async (ctx) => {
    console.log(`[Telegram] DEBUG: /start command received from chat ${ctx.chat?.id}`);
    const payload = (ctx.match as string)?.trim();

    // Check if payload is a referral code (e.g. PYTH-R3NX)
    if (payload && /^[A-Z]+-[A-Z0-9]{4}$/i.test(payload)) {
      const userId = ctx.from?.id?.toString();
      const username = ctx.from?.username || ctx.from?.first_name || 'unknown';

      if (!userId) {
        await ctx.reply('Could not identify your account\\. Please try again\\.', { parse_mode: 'MarkdownV2' });
        return;
      }

      const result = registerReferralAttribution(userId, username, payload, config.referralAttributionDays);

      if (result.success) {
        const referral = getReferralByCode(payload);
        await ctx.reply(
          `🎯 *Welcome to Pythian Propaganda\\!*\n\n` +
          `You were referred by @${escapeMarkdown(referral?.referrerUsername || 'a community member')}\\.\n\n` +
          `Submit to missions and earn rewards\\. Your referrer earns ${Math.round(config.referralPayoutSplit * 100)}% of your winnings for ${config.referralAttributionDays} days\\.\n\n` +
          `*Next steps:*\n` +
          `1\\. /wallet \\<solana\\_address\\> — Set your SOL wallet for payouts\n` +
          `2\\. /link \\<discord\\_id\\> — Link your Discord for submission tracking\n` +
          `3\\. /help — See all available commands`,
          { parse_mode: 'MarkdownV2' }
        );
        console.log(`[Telegram] Referral registration: ${userId} (${username}) via code ${payload}`);
      } else {
        // Still welcome them even if referral failed
        await ctx.reply(
          `*Mission Control Bot*\n\n` +
          `⚠️ Referral: ${escapeMarkdown(result.error || 'Unknown error')}\n\n` +
          `Use /help to see available commands\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      return;
    }

    // Default welcome (no referral code)
    await ctx.reply(
      '*Mission Control Bot*\n\n' +
      'Generate mission briefs from Notion content and create Discord threads for submissions\\.\n\n' +
      'Use /help to see available commands\\.',
      { parse_mode: 'MarkdownV2' }
    );
  });

  // ============================================================================
  // /referral Command — Get your referral code + deep link
  // ============================================================================
  telegramBot.command('referral', async (ctx) => {
    if (!isPrivateChat(ctx)) return;

    const userId = ctx.from?.id?.toString();
    const username = ctx.from?.username || ctx.from?.first_name || 'unknown';

    if (!userId) {
      await ctx.reply('Could not identify your account\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const referral = createReferralCode(userId, username);
    const botInfo = await ctx.api.getMe();
    const deepLink = `t.me/${botInfo.username}?start=${referral.code}`;

    await ctx.reply(
      `🔗 *Your Referral Code:* \`${referral.code}\`\n\n` +
      `📲 *Share this link:*\n${escapeMarkdown(deepLink)}\n\n` +
      `When someone joins through your link and wins missions, you earn *${Math.round(config.referralPayoutSplit * 100)}%* of their payouts for *${config.referralAttributionDays} days*\\.\n\n` +
      `Use /referrals to check your stats\\.`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  // ============================================================================
  // /referrals Command — View referral stats
  // ============================================================================
  telegramBot.command('referrals', async (ctx) => {
    if (!isPrivateChat(ctx)) return;

    const userId = ctx.from?.id?.toString();
    if (!userId) {
      await ctx.reply('Could not identify your account\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const stats = getReferralStats(userId);

    let message = `📊 *Your Referral Stats*\n\n`;
    message += `👥 Total recruits: ${stats.totalRecruits}\n`;
    message += `✅ Active recruits \\(within ${config.referralAttributionDays}d\\): ${stats.activeRecruits}\n`;
    message += `💰 Total earnings: $${escapeMarkdown(stats.totalEarnings.toFixed(2))}\n`;

    if (stats.recentPayouts.length > 0) {
      message += `\n*Recent Payouts:*\n`;
      for (const p of stats.recentPayouts) {
        const date = new Date(p.createdAt).toLocaleDateString();
        message += `• ${escapeMarkdown(date)} — \\$${escapeMarkdown(p.referralAmount.toFixed(2))} \\(mission payout: \\$${escapeMarkdown(p.recruitPayout.toFixed(2))}\\)\n`;
      }
    } else {
      message += `\n_No payouts yet\\. Share your referral link to start earning\\!_`;
    }

    message += `\n\nUse /referral to get your link\\.`;
    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
  });

  // ============================================================================
  // /link Command — Link Discord ID for submission tracking
  // ============================================================================
  telegramBot.command('link', async (ctx) => {
    if (!isPrivateChat(ctx)) return;

    const discordId = (ctx.match as string)?.trim();
    if (!discordId || !/^\d{17,20}$/.test(discordId)) {
      await ctx.reply(
        '*Usage:* /link \\<discord\\_user\\_id\\>\n\n' +
        '*Example:* \\`/link 123456789012345678\\`\n\n' +
        '_Your Discord user ID is a 17\\-20 digit number\\. Enable Developer Mode in Discord settings, then right\\-click your username → Copy ID\\._',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const userId = ctx.from?.id?.toString();
    if (!userId) {
      await ctx.reply('Could not identify your account\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const result = linkDiscordId(userId, discordId);
    if (result.success) {
      await ctx.reply(
        `✅ *Discord linked\\!*\n\n` +
        `Your Discord ID \`${discordId}\` is now linked to your Telegram account\\. Discord mission submissions will be tracked for referral payouts\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    } else {
      await ctx.reply(
        `⚠️ ${escapeMarkdown(result.error || 'Unknown error')}`,
        { parse_mode: 'MarkdownV2' }
      );
    }
  });

  // ============================================================================
  // /wallet Command — Set Solana wallet for payouts
  // ============================================================================
  telegramBot.command('wallet', async (ctx) => {
    if (!isPrivateChat(ctx)) return;

    const wallet = (ctx.match as string)?.trim();
    if (!wallet) {
      await ctx.reply(
        '*Usage:* /wallet \\<solana\\_address\\>\n\n' +
        '*Example:* \\`/wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\\`\n\n' +
        '_Your Solana wallet address for receiving mission payouts\\._',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // Basic Solana address validation (base58, 32-44 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      await ctx.reply('*Error:* Invalid Solana address\\. Should be 32\\-44 base58 characters\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const userId = ctx.from?.id?.toString();
    if (!userId) {
      await ctx.reply('Could not identify your account\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    // Try setting as recruit first, then as referrer
    const recruitResult = setSolanaWallet(userId, wallet);
    const referrerResult = setReferrerSolanaWallet(userId, wallet);

    if (recruitResult.success || referrerResult.success) {
      await ctx.reply(
        `✅ *Wallet saved\\!*\n\n` +
        `\`${escapeMarkdown(wallet)}\`\n\n` +
        `_This wallet will be used for mission payouts and referral bonuses\\._`,
        { parse_mode: 'MarkdownV2' }
      );
    } else {
      await ctx.reply(
        `⚠️ Could not save wallet\\. You need to either join via a referral link or create a referral code with /referral first\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    }
  });

  // ============================================================================
  // /payout Command — Manually record a payout for a submission (admin only)
  // ============================================================================
  telegramBot.command('payout', async (ctx) => {
    if (!isPrivateChat(ctx)) return;

    const rawArgs = (ctx.match as string)?.trim();
    if (!rawArgs) {
      await ctx.reply(
        '*Usage:* /payout \\<submission\\_id\\> \\<amount\\>\n\n' +
        '*Example:* \\`/payout sub\\-1234567890\\-ab3f 100\\`\n\n' +
        '_Records a payout for the submission\\. If the winner was referred, their referrer automatically gets ' +
        `${Math.round(config.referralPayoutSplit * 100)}% as a referral bonus\\._`,
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    const parts = rawArgs.split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply('*Error:* Need both submission ID and amount\\. Example: \\`/payout sub\\-123 100\\`', { parse_mode: 'MarkdownV2' });
      return;
    }

    const submissionId = parts[0];
    const amount = parseFloat(parts[1]);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('*Error:* Amount must be a positive number\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    // Look up submission directly
    const { getSubmissionById } = await import('./storage');
    const submission = getSubmissionById(submissionId);

    if (!submission) {
      await ctx.reply(`*Error:* Submission \`${escapeMarkdown(submissionId)}\` not found\\.`, { parse_mode: 'MarkdownV2' });
      return;
    }

    // Record referral payout (checks attribution automatically)
    const payout = recordReferralPayout(
      submission.missionId,
      submission.id,
      submission.userId,
      amount,
      config.referralPayoutSplit
    );

    let message = `✅ *Payout recorded:* \\$${escapeMarkdown(amount.toFixed(2))} to ${escapeMarkdown(submission.userTag)}\n`;

    if (payout) {
      message += `\n🔗 *Referral bonus:* \\$${escapeMarkdown(payout.referralAmount.toFixed(2))} to referrer \\(${escapeMarkdown(payout.referrerId)}\\)`;

      // Export to Sheets if configured
      if (isSheetsConfigured()) {
        await appendReferralPayoutToSheet(payout).catch(err => {
          console.error(`[Telegram] Failed to export referral payout to Sheets:`, err);
        });
      }
    } else {
      message += `\n_No referral attribution \\(winner was not referred or attribution expired\\)_`;
    }

    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
  });

  // ============================================================================
  // .md File Upload — Hint about /create
  // ============================================================================
  telegramBot.on('message:document', async (ctx) => {
    if (!isPrivateChat(ctx)) return;

    const fileName = ctx.message.document.file_name;
    if (fileName && fileName.endsWith('.md')) {
      await ctx.reply(
        '📄 \\.md file detected\\! Reply to this message with:\n' +
        '\\`/create title\\="Mission Title" deadline\\=3\\`\n\n' +
        '_to create a mission from it\\._',
        { parse_mode: 'MarkdownV2' }
      );
    }
  });

  // ============================================================================
  // URL Detection - Mission-linked Submissions
  // Supports both direct replies (legacy group) and channel comments
  // (via auto-forwarded messages in linked Discussion Group)
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
    const replyTo = ctx.message.reply_to_message;
    const replyToId = replyTo?.message_id;

    // If it's a reply, check if it's a mission
    if (replyToId) {
      // Path 1: Direct reply in group (legacy — existing behavior)
      let mission = getMissionByTelegramMessage(replyToId.toString());

      // Path 2: Reply to auto-forwarded channel post in Discussion Group
      // When a channel has a linked discussion group, Telegram auto-forwards
      // each channel post. Comments reply to the forwarded copy, not the original.
      // We trace back to the original channel message ID.
      if (!mission && replyTo) {
        let originalMsgId: string | undefined;

        // Modern Bot API (7.0+): forward_origin.type === 'channel'
        const forwardOrigin = (replyTo as any).forward_origin;
        if (forwardOrigin?.type === 'channel' && forwardOrigin.message_id) {
          originalMsgId = forwardOrigin.message_id.toString();
          console.log(`[Telegram] Channel comment detected — forward_origin.message_id=${originalMsgId}`);
        }
        // Legacy Bot API fallback: forward_from_message_id
        else if ((replyTo as any).forward_from_message_id) {
          originalMsgId = (replyTo as any).forward_from_message_id.toString();
          console.log(`[Telegram] Channel comment detected — forward_from_message_id=${originalMsgId}`);
        }

        if (originalMsgId) {
          mission = getMissionByTelegramMessage(originalMsgId);
        }
      }

      if (mission) {
        // Verify the submission is in a valid chat:
        // - Original chat where mission was posted, OR
        // - The linked Discussion Group (for channel comments)
        const isDiscussionGroup = config.telegramDiscussionGroupId && chatId === config.telegramDiscussionGroupId;
        if (!isDiscussionGroup && mission.telegramChatId !== chatId) {
          console.log(`[Telegram] Submission chat ${chatId} doesn't match mission chat ${mission.telegramChatId} or discussion group`);
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

    // Not a mission reply - only respond if in allowed chat or discussion group
    const isDiscussionGroup = config.telegramDiscussionGroupId && chatId === config.telegramDiscussionGroupId;
    if (!isAllowedChat(ctx) && !isDiscussionGroup) return;

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

  // Clear any stale long-polling connections before starting.
  // This prevents 409 Conflict errors when restarting (e.g. PM2 restart)
  // where the old getUpdates request may still be pending on Telegram's servers.
  await telegramBot.api.deleteWebhook({ drop_pending_updates: false });
  console.log('[Telegram] Cleared stale connections via deleteWebhook');

  // Start polling with retry logic for 409 conflicts
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await telegramBot.start({
        onStart: (botInfo) => {
          console.log(`[Telegram] Bot started: @${botInfo.username}`);
        },
      });
      break; // bot.start() only resolves on stop, so break if it returns cleanly
    } catch (err: any) {
      const is409 = err?.error_code === 409 || err?.message?.includes('409');
      if (is409 && attempt < MAX_RETRIES) {
        const delay = attempt * 5; // 5s, 10s, 15s, 20s backoff
        console.log(`[Telegram] 409 Conflict on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay}s...`);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
        // Clear stale connections again before retry
        await telegramBot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
        continue;
      }
      throw err; // Non-409 error or max retries exhausted
    }
  }
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
