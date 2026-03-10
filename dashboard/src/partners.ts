/**
 * Partner tracking — manages partner profiles and clip metrics
 */

import * as fs from 'fs';
import * as path from 'path';
import { Partner, PartnerClip, PartnersData, PartnerSummary, MetricSnapshot } from './types';
import { fetchTweetMetrics, apiResponseToTweetMetrics, searchTweets } from './twitter';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PARTNERS_FILE = path.join(DATA_DIR, 'partners.json');
const MAX_FETCH_HISTORY = 30;

const TWEET_URL_REGEX = /https?:\/\/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/;

// ============================================================================
// Data persistence
// ============================================================================

export function loadPartners(): PartnersData {
  try {
    const content = fs.readFileSync(PARTNERS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { partners: [], lastPollAt: null };
  }
}

function savePartners(data: PartnersData): void {
  fs.writeFileSync(PARTNERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Partner CRUD
// ============================================================================

export function addPartner(name: string, handle?: string, searchTerms?: string[]): Partner {
  const data = loadPartners();

  const partner: Partner = {
    id: `partner-${Date.now()}`,
    name,
    handle: handle || undefined,
    searchTerms: searchTerms?.length ? searchTerms : undefined,
    clips: [],
    addedAt: new Date().toISOString(),
  };

  data.partners.push(partner);
  savePartners(data);
  console.log(`[Partners] Added: ${partner.name} (${partner.id})`);
  return partner;
}

export function updatePartner(partnerId: string, updates: { name?: string; handle?: string; searchTerms?: string[] }): Partner | null {
  const data = loadPartners();
  const partner = data.partners.find(p => p.id === partnerId);
  if (!partner) return null;

  if (updates.name) partner.name = updates.name;
  if (updates.handle !== undefined) partner.handle = updates.handle || undefined;
  if (updates.searchTerms !== undefined) partner.searchTerms = updates.searchTerms.length ? updates.searchTerms : undefined;

  savePartners(data);
  console.log(`[Partners] Updated: ${partner.name}`);
  return partner;
}

export function removePartner(partnerId: string): boolean {
  const data = loadPartners();
  const idx = data.partners.findIndex(p => p.id === partnerId);
  if (idx < 0) return false;

  const removed = data.partners.splice(idx, 1)[0];
  savePartners(data);
  console.log(`[Partners] Removed: ${removed.name}`);
  return true;
}

export function getPartner(partnerId: string): Partner | undefined {
  const data = loadPartners();
  return data.partners.find(p => p.id === partnerId);
}

// ============================================================================
// Clip CRUD
// ============================================================================

function extractTweetInfo(url: string): { tweetId: string; username: string } | null {
  const match = url.match(TWEET_URL_REGEX);
  if (!match) return null;
  return { tweetId: match[2], username: match[1] };
}

export function addClip(partnerId: string, tweetUrl: string, note?: string): PartnerClip | null {
  const data = loadPartners();
  const partner = data.partners.find(p => p.id === partnerId);
  if (!partner) return null;

  const info = extractTweetInfo(tweetUrl);
  if (!info) return null;

  // Check for duplicate
  if (partner.clips.some(c => c.tweetId === info.tweetId)) {
    return partner.clips.find(c => c.tweetId === info.tweetId)!;
  }

  const clip: PartnerClip = {
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tweetUrl: tweetUrl.split('?')[0], // strip query params
    tweetId: info.tweetId,
    postedBy: info.username,
    note,
    addedAt: new Date().toISOString(),
    impressions: 0,
    likes: 0,
    retweets: 0,
    replies: 0,
    quotes: 0,
    bookmarks: 0,
    authorFollowerCount: 0,
    tweetCreatedAt: '',
    lastFetchedAt: '',
    fetchHistory: [],
  };

  partner.clips.push(clip);
  savePartners(data);
  console.log(`[Partners] Added clip ${clip.tweetId} to ${partner.name}`);
  return clip;
}

export function removeClip(partnerId: string, clipId: string): boolean {
  const data = loadPartners();
  const partner = data.partners.find(p => p.id === partnerId);
  if (!partner) return false;

  const idx = partner.clips.findIndex(c => c.id === clipId);
  if (idx < 0) return false;

  partner.clips.splice(idx, 1);
  savePartners(data);
  console.log(`[Partners] Removed clip ${clipId} from ${partner.name}`);
  return true;
}

// ============================================================================
// Polling — fetch metrics for all partner clips
// ============================================================================

export async function pollPartnerClips(bearerToken: string): Promise<{ fetched: number; updated: number }> {
  const data = loadPartners();
  const allClips: { clip: PartnerClip; partner: Partner }[] = [];

  for (const partner of data.partners) {
    for (const clip of partner.clips) {
      allClips.push({ clip, partner });
    }
  }

  if (allClips.length === 0) return { fetched: 0, updated: 0 };

  const tweetIds = [...new Set(allClips.map(c => c.clip.tweetId))];
  console.log(`[Partners] Polling ${tweetIds.length} clips across ${data.partners.length} partners`);

  const apiResults = await fetchTweetMetrics(tweetIds, bearerToken);

  let updated = 0;
  for (const { clip } of allClips) {
    const result = apiResults.get(clip.tweetId);
    if (!result) continue;

    const pm = result.metrics.public_metrics;
    if (!pm) continue;

    // Add to fetch history
    clip.fetchHistory.push({
      timestamp: new Date().toISOString(),
      impressions: pm.impression_count || 0,
      likes: pm.like_count || 0,
      retweets: pm.retweet_count || 0,
      replies: pm.reply_count || 0,
      quotes: pm.quote_count || 0,
      bookmarks: pm.bookmark_count || 0,
    });
    if (clip.fetchHistory.length > MAX_FETCH_HISTORY) {
      clip.fetchHistory = clip.fetchHistory.slice(-MAX_FETCH_HISTORY);
    }

    // Update current metrics
    clip.impressions = pm.impression_count || 0;
    clip.likes = pm.like_count || 0;
    clip.retweets = pm.retweet_count || 0;
    clip.replies = pm.reply_count || 0;
    clip.quotes = pm.quote_count || 0;
    clip.bookmarks = pm.bookmark_count || 0;
    clip.tweetCreatedAt = result.metrics.created_at || '';
    clip.lastFetchedAt = new Date().toISOString();

    if (result.user) {
      clip.postedBy = result.user.username;
      clip.authorFollowerCount = result.user.public_metrics?.followers_count || 0;
    }

    updated++;
  }

  data.lastPollAt = new Date().toISOString();
  savePartners(data);

  console.log(`[Partners] Poll complete. Updated ${updated}/${allClips.length} clips.`);
  return { fetched: apiResults.size, updated };
}

// ============================================================================
// Timeline Scan — search Twitter for video content mentioning partner
// ============================================================================

export async function scanPartnerTimeline(
  partnerId: string,
  bearerToken: string
): Promise<{ found: number; added: number; skipped: number }> {
  const data = loadPartners();
  const partner = data.partners.find(p => p.id === partnerId);
  if (!partner) throw new Error('Partner not found');

  // Build search terms: explicit searchTerms, or fall back to name + handle
  const terms: string[] = partner.searchTerms?.length
    ? partner.searchTerms
    : [partner.name, ...(partner.handle ? [partner.handle] : [])];

  // Build Twitter search query: ("term1" OR "term2") has:video
  const orTerms = terms.map(t => `"${t}"`).join(' OR ');
  const query = `(${orTerms}) has:video`;

  console.log(`[Partners] Scanning timeline for ${partner.name}: ${query}`);

  const results = await searchTweets(query, bearerToken, 100);

  let added = 0;
  let skipped = 0;
  const existingTweetIds = new Set(partner.clips.map(c => c.tweetId));

  for (const result of results) {
    if (existingTweetIds.has(result.tweetId)) {
      skipped++;
      continue;
    }

    const clip: PartnerClip = {
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tweetUrl: result.tweetUrl,
      tweetId: result.tweetId,
      postedBy: result.authorUsername,
      note: 'auto-scan: video content',
      addedAt: new Date().toISOString(),
      impressions: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
      authorFollowerCount: 0,
      tweetCreatedAt: '',
      lastFetchedAt: '',
      fetchHistory: [],
    };

    partner.clips.push(clip);
    existingTweetIds.add(result.tweetId);
    added++;
  }

  partner.lastScanAt = new Date().toISOString();
  savePartners(data);

  console.log(`[Partners] Scan complete for ${partner.name}: ${results.length} found, ${added} added, ${skipped} duplicates`);
  return { found: results.length, added, skipped };
}

// ============================================================================
// Aggregation
// ============================================================================

function clipEngagement(c: PartnerClip): number {
  return c.likes + c.retweets + c.replies + c.quotes + c.bookmarks;
}

function clipEngagementRate(c: PartnerClip): number {
  if (c.impressions === 0) return 0;
  return clipEngagement(c) / c.impressions;
}

export function getPartnerSummaries(): PartnerSummary[] {
  const data = loadPartners();

  return data.partners.map(p => {
    const clips = p.clips;
    const totalViews = clips.reduce((s, c) => s + c.impressions, 0);
    const totalEng = clips.reduce((s, c) => s + clipEngagement(c), 0);
    const avgRate = clips.length > 0
      ? clips.reduce((s, c) => s + clipEngagementRate(c), 0) / clips.length
      : 0;
    const uniqueClippers = new Set(clips.map(c => c.postedBy.toLowerCase())).size;

    return {
      id: p.id,
      name: p.name,
      handle: p.handle,
      clipCount: clips.length,
      totalViews,
      avgViews: clips.length > 0 ? Math.round(totalViews / clips.length) : 0,
      totalEngagement: totalEng,
      avgEngagementRate: avgRate,
      uniqueClippers,
      addedAt: p.addedAt,
    };
  }).sort((a, b) => b.totalViews - a.totalViews);
}

export function getPartnerDetail(partnerId: string) {
  const data = loadPartners();
  const partner = data.partners.find(p => p.id === partnerId);
  if (!partner) return null;

  const clips = partner.clips.map(c => ({
    ...c,
    totalEngagement: clipEngagement(c),
    engagementRate: clipEngagementRate(c),
  })).sort((a, b) => b.impressions - a.impressions);

  const totalViews = clips.reduce((s, c) => s + c.impressions, 0);
  const totalEng = clips.reduce((s, c) => s + c.totalEngagement, 0);
  const uniqueClippers = new Set(clips.map(c => c.postedBy.toLowerCase())).size;

  return {
    partner: {
      id: partner.id,
      name: partner.name,
      handle: partner.handle,
      addedAt: partner.addedAt,
    },
    clips,
    stats: {
      totalViews,
      totalEngagement: totalEng,
      clipCount: clips.length,
      uniqueClippers,
      avgViews: clips.length > 0 ? Math.round(totalViews / clips.length) : 0,
      avgEngagementRate: clips.length > 0
        ? clips.reduce((s, c) => s + c.engagementRate, 0) / clips.length
        : 0,
    },
  };
}
