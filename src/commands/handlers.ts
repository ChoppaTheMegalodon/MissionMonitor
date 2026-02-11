/**
 * Command Handlers
 *
 * Business logic for bot commands. Platform-agnostic - can be called from
 * Telegram or Discord handlers.
 */

import { searchCampaigns, CampaignResult } from '../services/notion';
import { generateMissionBrief, generateTweetSuggestions, MissionBriefResult, TweetSuggestion } from '../services/claude';

export interface CommandResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Escape special characters for Telegram MarkdownV2
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// ============================================================================
// /mission Command
// ============================================================================

/**
 * Handle /mission <topic> command
 *
 * 1. Search Notion for matching campaigns
 * 2. Aggregate content if multiple related pieces
 * 3. Generate mission brief via Claude
 * 4. Format for Telegram
 */
export async function handleMissionCommand(topic: string): Promise<CommandResult> {
  try {
    // Search for campaigns
    const campaigns = await searchCampaigns(topic);

    if (campaigns.length === 0) {
      return {
        success: false,
        error: `No campaigns found matching "${topic}". Try a different search term.`,
      };
    }

    // Aggregate content from all matching campaigns
    const aggregatedContent = campaigns
      .map(c => `## ${c.title}\n\n${c.content}`)
      .join('\n\n---\n\n');

    const sourceUrls = campaigns.map(c => c.url);

    // Generate mission brief via Claude
    const brief = await generateMissionBrief(
      campaigns[0].title, // Use first campaign title as mission title
      aggregatedContent,
      sourceUrls
    );

    // Format for Telegram
    const message = formatMissionBrief(brief, campaigns.length);

    return {
      success: true,
      message,
    };
  } catch (error) {
    console.error('[Mission] Error:', error);
    return {
      success: false,
      error: 'Failed to generate mission brief. Please try again.',
    };
  }
}

/**
 * Format mission brief for Telegram
 */
function formatMissionBrief(brief: MissionBriefResult, sourceCount: number): string {
  const lines: string[] = [];

  // Header
  lines.push(`\u{1F3AF} *MISSION: ${escapeMarkdown(brief.title)}*`);
  lines.push('');

  // Key message
  lines.push('*KEY MESSAGE:*');
  lines.push(escapeMarkdown(brief.keyMessage));
  lines.push('');

  // Divider
  lines.push('\u2501'.repeat(35));
  lines.push('');

  // Supporting points
  lines.push('*SUPPORTING POINTS:*');
  lines.push('');
  for (const point of brief.supportingPoints) {
    lines.push(`\u2022 ${escapeMarkdown(point)}`);
  }
  lines.push('');

  // Divider
  lines.push('\u2501'.repeat(35));
  lines.push('');

  // Optional angles
  lines.push('*OPTIONAL ANGLES:*');
  lines.push('');
  for (const angle of brief.optionalAngles) {
    lines.push(`\u{1F4A1} ${escapeMarkdown(angle)}`);
  }
  lines.push('');

  // Divider
  lines.push('\u2501'.repeat(35));
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
  lines.push('\u2501'.repeat(35));
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

// ============================================================================
// /tweets Command
// ============================================================================

/**
 * Handle /tweets <topic> command
 *
 * 1. Search Notion for content matching topic
 * 2. Aggregate facts and quotes
 * 3. Generate tweet suggestions via Claude
 * 4. Format for Telegram
 */
export async function handleTweetsCommand(topic: string): Promise<CommandResult> {
  try {
    // Search for content
    const campaigns = await searchCampaigns(topic);

    if (campaigns.length === 0) {
      return {
        success: false,
        error: `No content found matching "${topic}". Try a different search term.`,
      };
    }

    // Prepare content for Claude
    const contentPieces = campaigns.map(c => ({
      title: c.title,
      content: c.content,
      url: c.url,
    }));

    // Generate suggestions via Claude
    const suggestions = await generateTweetSuggestions(topic, contentPieces);

    // Format for Telegram
    const message = formatTweetSuggestions(topic, suggestions, campaigns.length);

    return {
      success: true,
      message,
    };
  } catch (error) {
    console.error('[Tweets] Error:', error);
    return {
      success: false,
      error: 'Failed to generate tweet suggestions. Please try again.',
    };
  }
}

/**
 * Format tweet suggestions for Telegram
 */
function formatTweetSuggestions(topic: string, suggestions: TweetSuggestion[], sourceCount: number): string {
  const lines: string[] = [];

  // Header
  lines.push(`\u{1F426} *TWEET SUGGESTIONS: ${escapeMarkdown(topic)}*`);
  lines.push('');
  lines.push('\u2501'.repeat(35));
  lines.push('');

  // Each suggestion
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];

    lines.push(`*${i + 1}\\. ${escapeMarkdown(s.hook)}*`);
    lines.push('');
    lines.push(`\u{1F4F1} *Twitter:* ${escapeMarkdown(s.twitterAngle)}`);
    lines.push(`\u{1F4BC} *LinkedIn:* ${escapeMarkdown(s.linkedinAngle)}`);
    lines.push(`\u{1F517} ${escapeMarkdown(s.sourceUrl)}`);
    lines.push('');
    lines.push('\u2501'.repeat(35));
    lines.push('');
  }

  // Footer
  lines.push(`_Generated from ${sourceCount} content source${sourceCount > 1 ? 's' : ''}_`);

  return lines.join('\n');
}

// ============================================================================
// /help Command
// ============================================================================

/**
 * Handle /help command
 */
export function handleHelpCommand(): string {
  return '*Mission Control Bot*\n\n' +
    'Available commands:\n\n' +
    '*/mission <topic>*\n' +
    'Create a mission brief from campaign content\\.\n' +
    'Example: \\`/mission Morgan Stanley\\`\n\n' +
    '*/tweets <topic>*\n' +
    'Generate 10 tweet suggestions for a topic\\.\n' +
    'Example: \\`/tweets Pyth Pro\\`\n\n' +
    '*/help*\n' +
    'Show this help message\\.\n\n' +
    '\\-\\-\\-\n' +
    '_Powered by Pyth Mission Control v1\\.1_';
}
