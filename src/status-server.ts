/**
 * Lightweight HTTP status server for the Mission Control Bot dashboard.
 *
 * Serves:
 *   GET /              → dashboard HTML
 *   GET /style.css     → dashboard styles
 *   GET /dashboard.js  → dashboard client script
 *   GET /status.json   → live service health payload
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'discord.js';
import { config } from './config';
import { isSheetsConfigured } from './sheets';
import { appendReferralPayoutToSheet } from './sheets';
import {
  getActiveMissions,
  getAllMissions,
  getSubmissionsByMission,
  getSubmissionById,
  getMissionById,
  recordReferralPayout,
  recordVote,
  getAttributionByRecruit,
  getAttributionByDiscordUser,
  getWalletForUser,
  getReferralByCode,
} from './storage';

const PORT = parseInt(process.env.STATUS_PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const START_TIME = Date.now();
const VERSION = '2.0.0';

// References set at boot from index.ts
let discordClientRef: Client | null = null;
let telegramRunning = false;

export function setDiscordClient(client: Client) {
  discordClientRef = client;
}

export function setTelegramRunning(running: boolean) {
  telegramRunning = running;
}

// ---------------------------------------------------------------------------
// Status payload builder
// ---------------------------------------------------------------------------

interface ServiceStatus {
  name: string;
  status: 'operational' | 'down' | 'unconfigured';
  detail: string;
}

function buildStatus(): object {
  const services: ServiceStatus[] = [];

  // Discord
  const discordReady = discordClientRef?.isReady() ?? false;
  services.push({
    name: 'Discord Bot',
    status: discordReady ? 'operational' : 'down',
    detail: discordReady
      ? `Logged in as ${discordClientRef!.user?.tag}`
      : 'Not connected',
  });

  // Telegram
  services.push({
    name: 'Telegram Bot',
    status: telegramRunning ? 'operational' : 'down',
    detail: telegramRunning ? 'Long-polling active' : 'Not running',
  });

  // Notion
  const notionConfigured = !!config.notionToken;
  services.push({
    name: 'Notion API',
    status: notionConfigured ? 'operational' : 'unconfigured',
    detail: notionConfigured ? 'Token configured' : 'No token set',
  });

  // Claude
  const claudeConfigured = !!config.anthropicApiKey;
  services.push({
    name: 'Claude API',
    status: claudeConfigured ? 'operational' : 'unconfigured',
    detail: claudeConfigured ? `Model: ${config.claudeModel}` : 'No API key set',
  });

  // Google Sheets
  const sheetsOk = isSheetsConfigured();
  services.push({
    name: 'Google Sheets',
    status: sheetsOk ? 'operational' : 'unconfigured',
    detail: sheetsOk ? 'Configured' : 'Not configured',
  });

  // Active missions summary
  const activeMissions = getActiveMissions();
  let totalSubmissions = 0;
  for (const m of activeMissions) {
    totalSubmissions += getSubmissionsByMission(m.id).length;
  }
  services.push({
    name: 'Active Missions',
    status: 'operational',
    detail: `${activeMissions.length} mission${activeMissions.length !== 1 ? 's' : ''}, ${totalSubmissions} submission${totalSubmissions !== 1 ? 's' : ''}`,
  });

  return {
    version: VERSION,
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    lastUpdated: new Date().toISOString(),
    services,
  };
}

// ---------------------------------------------------------------------------
// Static file helpers
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveFile(res: http.ServerResponse, filePath: string) {
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let server: http.Server | null = null;

export function startStatusServer(): void {
  server = http.createServer(async (req, res) => {
    const url = req.url?.split('?')[0] || '/';

    // -----------------------------------------------------------------------
    // JSON API endpoints
    // -----------------------------------------------------------------------

    if (url === '/status.json') {
      const payload = JSON.stringify(buildStatus());
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(payload);
      return;
    }

    if (url === '/api/missions') {
      const missions = getAllMissions().sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const payload = missions.map(m => {
        const subs = getSubmissionsByMission(m.id);
        return {
          ...m,
          submissions: subs.map(s => {
            const scores = s.votes.map(v => v.score);
            const avgScore = scores.length > 0
              ? (scores.reduce((a, b) => a + b, 0) / scores.length)
              : null;

            // Look up wallet and referral info
            const attribution = getAttributionByRecruit(s.userId) || getAttributionByDiscordUser(s.userId);
            const wallet = getWalletForUser(s.userId);

            return {
              id: s.id,
              userId: s.userId,
              userTag: s.userTag,
              source: s.source,
              urls: s.urls,
              content: s.content.slice(0, 200),
              submittedAt: s.submittedAt,
              voteCount: s.votes.length,
              avgScore: avgScore !== null ? Math.round(avgScore * 100) / 100 : null,
              wallet: wallet || null,
              referred: !!attribution,
              referrerCode: attribution?.referrerCode || null,
            };
          }).sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0)),
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (url === '/api/payout' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { submissionId, amount } = JSON.parse(body);
          if (!submissionId || typeof amount !== 'number' || amount <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'submissionId and positive amount required' }));
            return;
          }

          const submission = getSubmissionById(submissionId);
          if (!submission) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Submission not found' }));
            return;
          }

          const payout = recordReferralPayout(
            submission.missionId,
            submission.id,
            submission.userId,
            amount,
            config.referralPayoutSplit
          );

          // Export to Sheets if configured
          if (payout && isSheetsConfigured()) {
            await appendReferralPayoutToSheet(payout).catch(err => {
              console.error('[Status] Failed to export referral payout to Sheets:', err);
            });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            submission: { id: submission.id, userTag: submission.userTag, userId: submission.userId },
            referralPayout: payout ? {
              id: payout.id,
              referrerId: payout.referrerId,
              referralAmount: payout.referralAmount,
            } : null,
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url === '/api/score' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { submissionId, score } = JSON.parse(body);
          if (!submissionId || typeof score !== 'number' || score < 0 || score > 10) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'submissionId and score (0-10) required' }));
            return;
          }

          const submission = getSubmissionById(submissionId);
          if (!submission) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Submission not found' }));
            return;
          }

          recordVote(submissionId, 'dashboard-admin', score);

          // Re-read to get updated averages
          const updated = getSubmissionById(submissionId)!;
          const scores = updated.votes.map(v => v.score);
          const avg = scores.length > 0
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
            : null;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            voteCount: updated.votes.length,
            avgScore: avg,
          }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Static dashboard files
    // -----------------------------------------------------------------------
    const fileMap: Record<string, string> = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/style.css': 'style.css',
      '/dashboard.js': 'dashboard.js',
      '/payouts': 'payouts.html',
      '/payouts.html': 'payouts.html',
      '/payouts.js': 'payouts.js',
      '/pythbaddies': 'pythbaddies.html',
      '/pythbaddies.html': 'pythbaddies.html',
    };

    const fileName = fileMap[url];
    if (fileName) {
      serveFile(res, path.join(PUBLIC_DIR, fileName));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Status] Dashboard running at http://0.0.0.0:${PORT}`);
  });
}

export function stopStatusServer(): void {
  if (server) {
    server.close();
    server = null;
    console.log('[Status] Server stopped');
  }
}
