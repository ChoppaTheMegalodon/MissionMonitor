/**
 * Express HTTP server — API routes + static file serving
 */

import express from 'express';
import * as path from 'path';
import { calculateMissionScores, getMissionDetail, getLeaderboard } from './scoring';
import { loadEngagement } from './data';
import { manualRefresh } from './poller';
import {
  addPartner,
  removePartner,
  updatePartner,
  addClip,
  removeClip,
  getPartnerSummaries,
  getPartnerDetail,
  pollPartnerClips,
  scanPartnerTimeline,
  loadPartners,
} from './partners';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export function createServer(bearerToken: string, port: number): express.Application {
  const app = express();
  app.use(express.json());

  // Static files
  app.use(express.static(PUBLIC_DIR));

  // ========================================================================
  // Mission API (existing)
  // ========================================================================

  app.get('/api/missions', (_req, res) => {
    const scores = calculateMissionScores();
    res.json(scores);
  });

  app.get('/api/missions/:id', (req, res) => {
    const { mission, tweets } = getMissionDetail(req.params.id);
    if (!mission) {
      res.status(404).json({ error: 'Mission not found' });
      return;
    }
    res.json({ mission, tweets });
  });

  app.get('/api/leaderboard', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 25;
    const entries = getLeaderboard(limit);
    res.json(entries);
  });

  app.get('/api/refresh', async (_req, res) => {
    const result = await manualRefresh(bearerToken);
    // Also refresh partner clips
    await pollPartnerClips(bearerToken).catch(() => {});
    res.json(result);
  });

  app.get('/api/status', (_req, res) => {
    const engagement = loadEngagement();
    const partners = loadPartners();
    const clipCount = partners.partners.reduce((s, p) => s + p.clips.length, 0);
    res.json({
      status: 'ok',
      trackedTweets: engagement.tweets.length,
      trackedPartners: partners.partners.length,
      trackedClips: clipCount,
      lastPollAt: engagement.lastPollAt,
      lastManualRefreshAt: engagement.lastManualRefreshAt,
      partnersLastPollAt: partners.lastPollAt,
      port,
    });
  });

  // ========================================================================
  // Partner API
  // ========================================================================

  // List all partners with summaries
  app.get('/api/partners', (_req, res) => {
    const summaries = getPartnerSummaries();
    res.json(summaries);
  });

  // Refresh partner clips only (must be before :id route)
  app.get('/api/partners/refresh', async (_req, res) => {
    const result = await pollPartnerClips(bearerToken);
    res.json({ success: true, ...result });
  });

  // Add a partner
  app.post('/api/partners', (req, res) => {
    const { name, handle, searchTerms } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const partner = addPartner(name.trim(), handle?.trim(), searchTerms);
    res.json(partner);
  });

  // Get partner detail
  app.get('/api/partners/:id', (req, res) => {
    const detail = getPartnerDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    res.json(detail);
  });

  // Update a partner (name, handle, searchTerms)
  app.patch('/api/partners/:id', (req, res) => {
    const { name, handle, searchTerms } = req.body;
    const partner = updatePartner(req.params.id, { name, handle, searchTerms });
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    res.json(partner);
  });

  // Scan partner timeline — search Twitter for video content mentioning partner
  app.post('/api/partners/:id/scan', async (req, res) => {
    try {
      const scanResult = await scanPartnerTimeline(req.params.id, bearerToken);
      // Fetch metrics for newly added clips
      if (scanResult.added > 0) {
        await pollPartnerClips(bearerToken).catch(() => {});
      }
      const detail = getPartnerDetail(req.params.id);
      res.json({ ...scanResult, detail });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Remove a partner
  app.delete('/api/partners/:id', (req, res) => {
    const removed = removePartner(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    res.json({ success: true });
  });

  // Add a clip to a partner
  app.post('/api/partners/:id/clips', async (req, res) => {
    const { url, note } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'url is required (tweet/x.com URL)' });
      return;
    }
    const clip = addClip(req.params.id, url.trim(), note?.trim());
    if (!clip) {
      res.status(400).json({ error: 'Invalid partner ID or tweet URL' });
      return;
    }
    // Immediately fetch metrics for the new clip
    await pollPartnerClips(bearerToken).catch(() => {});
    // Return refreshed detail
    const detail = getPartnerDetail(req.params.id);
    res.json(detail);
  });

  // Remove a clip from a partner
  app.delete('/api/partners/:partnerId/clips/:clipId', (req, res) => {
    const removed = removeClip(req.params.partnerId, req.params.clipId);
    if (!removed) {
      res.status(404).json({ error: 'Partner or clip not found' });
      return;
    }
    res.json({ success: true });
  });

  return app;
}

export function startServer(app: express.Application, port: number): void {
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Dashboard] Running at http://0.0.0.0:${port}`);
  });
}
