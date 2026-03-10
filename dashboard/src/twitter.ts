/**
 * Twitter/X API v2 client — fetches tweet metrics using Bearer token auth
 */

import { TweetMetrics } from './types';

const TWITTER_API_BASE = 'https://api.twitter.com/2';

interface TwitterApiTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    bookmark_count: number;
    impression_count: number;
  };
}

interface TwitterApiUser {
  id: string;
  username: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
}

interface TwitterApiResponse {
  data?: TwitterApiTweet[];
  includes?: {
    users?: TwitterApiUser[];
  };
  errors?: Array<{ detail: string; type: string }>;
}

export async function fetchTweetMetrics(
  tweetIds: string[],
  bearerToken: string
): Promise<Map<string, { metrics: TwitterApiTweet; user: TwitterApiUser | undefined }>> {
  const results = new Map<string, { metrics: TwitterApiTweet; user: TwitterApiUser | undefined }>();

  if (tweetIds.length === 0) return results;

  // Batch in groups of 100
  for (let i = 0; i < tweetIds.length; i += 100) {
    const batch = tweetIds.slice(i, i + 100);
    const ids = batch.join(',');

    const url = `${TWITTER_API_BASE}/tweets?ids=${ids}&tweet.fields=public_metrics,created_at,author_id&expansions=author_id&user.fields=public_metrics,username`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
        },
      });

      if (response.status === 429) {
        console.warn('[Twitter] Rate limited (429). Skipping batch.');
        continue;
      }

      if (!response.ok) {
        console.error(`[Twitter] API error: ${response.status} ${response.statusText}`);
        continue;
      }

      const json = await response.json() as TwitterApiResponse;

      if (json.errors) {
        for (const err of json.errors) {
          console.warn(`[Twitter] API error: ${err.detail}`);
        }
      }

      if (!json.data) continue;

      const userMap = new Map<string, TwitterApiUser>();
      if (json.includes?.users) {
        for (const user of json.includes.users) {
          userMap.set(user.id, user);
        }
      }

      for (const tweet of json.data) {
        const user = tweet.author_id ? userMap.get(tweet.author_id) : undefined;
        results.set(tweet.id, { metrics: tweet, user });
      }
    } catch (err) {
      console.error(`[Twitter] Fetch error:`, err);
    }
  }

  return results;
}

// ============================================================================
// Twitter Search — find tweets matching query (e.g. video content mentioning a name)
// ============================================================================

interface SearchResult {
  tweetId: string;
  tweetUrl: string;
  authorUsername: string;
  text: string;
}

export async function searchTweets(
  query: string,
  bearerToken: string,
  maxResults: number = 100
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  let nextToken: string | undefined;

  // Twitter search API returns max 100 per page, paginate if needed
  while (results.length < maxResults) {
    const perPage = Math.min(maxResults - results.length, 100);
    let url = `${TWITTER_API_BASE}/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${Math.max(perPage, 10)}&tweet.fields=author_id,created_at&expansions=author_id&user.fields=username`;
    if (nextToken) {
      url += `&next_token=${nextToken}`;
    }

    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${bearerToken}` },
      });

      if (response.status === 429) {
        console.warn('[Twitter] Search rate limited (429). Stopping pagination.');
        break;
      }

      if (!response.ok) {
        const text = await response.text();
        console.error(`[Twitter] Search API error: ${response.status} ${response.statusText} — ${text}`);
        break;
      }

      const json = await response.json() as TwitterApiResponse & { meta?: { next_token?: string; result_count?: number } };

      if (!json.data || json.data.length === 0) break;

      const userMap = new Map<string, TwitterApiUser>();
      if (json.includes?.users) {
        for (const user of json.includes.users) {
          userMap.set(user.id, user);
        }
      }

      for (const tweet of json.data) {
        const user = tweet.author_id ? userMap.get(tweet.author_id) : undefined;
        const username = user?.username || 'unknown';
        results.push({
          tweetId: tweet.id,
          tweetUrl: `https://x.com/${username}/status/${tweet.id}`,
          authorUsername: username,
          text: tweet.text,
        });
      }

      nextToken = json.meta?.next_token;
      if (!nextToken) break;
    } catch (err) {
      console.error('[Twitter] Search fetch error:', err);
      break;
    }
  }

  console.log(`[Twitter] Search for "${query}" returned ${results.length} results`);
  return results;
}

export function apiResponseToTweetMetrics(
  tweetId: string,
  submissionId: string,
  missionId: string,
  tweet: TwitterApiTweet,
  user: TwitterApiUser | undefined
): TweetMetrics {
  const pm = tweet.public_metrics;
  return {
    tweetId,
    submissionId,
    missionId,
    authorUsername: user?.username || 'unknown',
    authorFollowerCount: user?.public_metrics?.followers_count || 0,
    impressions: pm?.impression_count || 0,
    likes: pm?.like_count || 0,
    retweets: pm?.retweet_count || 0,
    replies: pm?.reply_count || 0,
    quotes: pm?.quote_count || 0,
    bookmarks: pm?.bookmark_count || 0,
    tweetCreatedAt: tweet.created_at || '',
    firstFetchedAt: '',
    lastFetchedAt: '',
    fetchHistory: [],
  };
}
