// Bot data types (read-only, must match ../src/storage.ts)

export interface Mission {
  id: string;
  title: string;
  threadId: string;
  deadline: string;
  status: 'active' | 'closed' | 'exported';
  createdAt: string;
  exportedAt?: string;
  brief?: string;
  telegramMessageId?: string;
  telegramChatId?: string;
  starterMessageId?: string;
  channelId?: string;
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
  source: 'discord' | 'telegram';
}

// Dashboard-owned types

export interface MetricSnapshot {
  timestamp: string;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
}

export interface TweetMetrics {
  tweetId: string;
  submissionId: string;
  missionId: string;
  authorUsername: string;
  authorFollowerCount: number;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  tweetCreatedAt: string;
  firstFetchedAt: string;
  lastFetchedAt: string;
  fetchHistory: MetricSnapshot[];
}

export interface EngagementData {
  tweets: TweetMetrics[];
  lastPollAt: string | null;
  lastManualRefreshAt: string | null;
}

export interface MissionScore {
  missionId: string;
  title: string;
  status: string;
  deadline: string;
  submissionCount: number;
  totalImpressions: number;
  avgImpressions: number;
  avgEngagementRate: number;
  avgFollowerNormalized: number;
  successScore: number;
  trackedTweets: number;
}

export interface LeaderboardEntry {
  tweetId: string;
  submissionId: string;
  missionId: string;
  missionTitle: string;
  authorUsername: string;
  authorFollowerCount: number;
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  totalEngagement: number;
  engagementRate: number;
}

// Partner tracking types

export interface PartnerClip {
  id: string;
  tweetUrl: string;
  tweetId: string;
  postedBy: string;       // username of account that posted the clip
  note?: string;          // optional context ("clipped from podcast ep 12")
  addedAt: string;
  // Metrics (populated by poller)
  impressions: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  authorFollowerCount: number;
  tweetCreatedAt: string;
  lastFetchedAt: string;
  fetchHistory: MetricSnapshot[];
}

export interface Partner {
  id: string;
  name: string;           // display name ("Kirito", "Spank")
  handle?: string;        // optional primary X handle (for reference, not filtering)
  searchTerms?: string[]; // keywords for timeline scan ("Gainzy", "Gainzy222")
  clips: PartnerClip[];
  addedAt: string;
  lastScanAt?: string;
}

export interface PartnersData {
  partners: Partner[];
  lastPollAt: string | null;
}

export interface PartnerSummary {
  id: string;
  name: string;
  handle?: string;
  clipCount: number;
  totalViews: number;
  avgViews: number;
  totalEngagement: number;
  avgEngagementRate: number;
  uniqueClippers: number; // how many different accounts posted clips
  addedAt: string;
}
