/**
 * Configuration loader for Mission Control Bot
 *
 * Loads environment variables and validates required config.
 */

import * as dotenv from 'dotenv';

dotenv.config();

export interface BotConfig {
  // Telegram
  telegramBotToken: string;
  telegramAllowedChatIds: string[];
  telegramAnnouncementChannelId?: string; // Channel where mission announcements are posted

  // Discord
  discordBotToken: string;
  discordGuildId: string;
  discordMissionChannelId: string;
  discordResultsChannelId: string;
  discordJudgeRoleIds: string[];

  // Claude API (optional - needed for /mission and /tweets)
  anthropicApiKey?: string;
  claudeModel: string;

  // Notion (optional - needed for /mission and /tweets)
  notionToken?: string;
  notionCampaignsDbId: string;

  // Google Sheets (optional)
  googleSpreadsheetId?: string;
  googleServiceAccountEmail?: string;
  googlePrivateKey?: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

function parseArray(value: string): string[] {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export function loadConfig(): BotConfig {
  return {
    // Telegram
    telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    telegramAllowedChatIds: parseArray(optionalEnv('TELEGRAM_ALLOWED_CHAT_IDS', '-5226358270')),
    telegramAnnouncementChannelId: optionalEnv('TELEGRAM_ANNOUNCEMENT_CHANNEL_ID') || undefined,

    // Discord
    discordBotToken: requireEnv('DISCORD_BOT_TOKEN'),
    discordGuildId: optionalEnv('DISCORD_GUILD_ID', '826115122799837205'),
    discordMissionChannelId: optionalEnv('DISCORD_MISSION_CHANNEL_ID', '1308506959032488067'),
    discordResultsChannelId: optionalEnv('DISCORD_RESULTS_CHANNEL_ID', '1308505757637021817'),
    discordJudgeRoleIds: parseArray(optionalEnv('DISCORD_JUDGE_ROLE_IDS', '1351377449744728105')),

    // Claude API (optional - needed for /mission and /tweets)
    anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY') || undefined,
    claudeModel: optionalEnv('CLAUDE_MODEL', 'claude-sonnet-4-20250514'),

    // Notion (optional - needed for /mission and /tweets)
    notionToken: optionalEnv('NOTION_TOKEN') || undefined,
    notionCampaignsDbId: optionalEnv('NOTION_CAMPAIGNS_DB_ID', 'c44eb8d4-52fe-4a11-91d9-6c7aff75ccec'),

    // Google Sheets
    googleSpreadsheetId: optionalEnv('GOOGLE_SPREADSHEET_ID') || undefined,
    googleServiceAccountEmail: optionalEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL') || undefined,
    googlePrivateKey: optionalEnv('GOOGLE_PRIVATE_KEY') || undefined,
  };
}

export const config = loadConfig();
