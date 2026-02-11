/**
 * Claude API Service
 *
 * Handles all interactions with Claude's API for content generation.
 * This replaces the "Claude as orchestrator" pattern with direct API calls.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

// Client is created lazily to avoid errors when API key is not configured
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    client = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }
  return client;
}

/**
 * System prompt for mission brief generation
 */
const MISSION_SYSTEM_PROMPT = `You are a content strategist for Pyth Network, a decentralized oracle network.

Your job is to create mission briefs for community content creators. Mission briefs should be:
- Factual and evidence-based (every claim needs a source)
- Focused on what matters to the crypto/DeFi community
- Structured for easy content creation

You write in a professional but accessible tone. No hype, no marketing fluff - just clear facts and suggested angles.`;

/**
 * System prompt for tweet suggestions
 */
const TWEETS_SYSTEM_PROMPT = `You are a content strategist for Pyth Network, generating tweet ideas for the internal team.

Your job is to suggest tweet hooks and angles, NOT write full tweets. Each suggestion should:
- Be a clear hook or angle (not a complete tweet)
- Include both Twitter and LinkedIn variations
- Reference specific facts from the source material
- Be distinct from other suggestions (different angles)

Output exactly 10 suggestions in the format specified.`;

export interface MissionBriefResult {
  title: string;
  keyMessage: string;
  supportingPoints: string[];
  optionalAngles: string[];
  exampleTweets: string[];
  sourceLinks: string[];
}

export interface TweetSuggestion {
  hook: string;
  twitterAngle: string;
  linkedinAngle: string;
  sourceUrl: string;
}

/**
 * Generate a mission brief from campaign content
 */
export async function generateMissionBrief(
  campaignTitle: string,
  campaignContent: string,
  sourceUrls: string[]
): Promise<MissionBriefResult> {
  const response = await getClient().messages.create({
    model: config.claudeModel,
    max_tokens: 2000,
    system: MISSION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Create a mission brief for the following campaign:

**Campaign Title:** ${campaignTitle}

**Campaign Content:**
${campaignContent}

**Source URLs:**
${sourceUrls.map(url => `- ${url}`).join('\n')}

Respond with a JSON object in this exact format:
{
  "title": "Mission title",
  "keyMessage": "The core message in 2-3 sentences",
  "supportingPoints": ["Point 1", "Point 2", "Point 3"],
  "optionalAngles": ["Angle 1", "Angle 2", "Angle 3"],
  "exampleTweets": ["Tweet 1", "Tweet 2", "Tweet 3"],
  "sourceLinks": ["url1", "url2"]
}

Return ONLY the JSON, no markdown code blocks.`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    return JSON.parse(text) as MissionBriefResult;
  } catch (e) {
    console.error('Failed to parse mission brief response:', text);
    throw new Error('Failed to generate mission brief');
  }
}

/**
 * Generate tweet suggestions from campaign/content data
 */
export async function generateTweetSuggestions(
  topic: string,
  contentPieces: Array<{ title: string; content: string; url: string }>
): Promise<TweetSuggestion[]> {
  const contentSummary = contentPieces
    .map(p => `**${p.title}**\n${p.content}\nSource: ${p.url}`)
    .join('\n\n---\n\n');

  const response = await getClient().messages.create({
    model: config.claudeModel,
    max_tokens: 3000,
    system: TWEETS_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Generate 10 tweet suggestions for the topic: "${topic}"

**Content Sources:**
${contentSummary}

Respond with a JSON array of exactly 10 suggestions in this format:
[
  {
    "hook": "The attention-grabbing idea or angle",
    "twitterAngle": "How to approach this for Twitter (casual, punchy)",
    "linkedinAngle": "How to approach this for LinkedIn (professional, insight-driven)",
    "sourceUrl": "URL to the source for this fact"
  }
]

Each suggestion should have a DIFFERENT angle on the topic.
Return ONLY the JSON array, no markdown code blocks.`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    return JSON.parse(text) as TweetSuggestion[];
  } catch (e) {
    console.error('Failed to parse tweet suggestions response:', text);
    throw new Error('Failed to generate tweet suggestions');
  }
}

/**
 * General-purpose Claude query for complex tasks
 */
export async function askClaude(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await getClient().messages.create({
    model: config.claudeModel,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}
