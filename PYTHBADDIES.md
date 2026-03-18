# PythBaddies Dashboard — Context File

Use this file to understand the PythBaddies payout model dashboard before making changes.

---

## What This Is

A presentation-ready interactive dashboard at `/pythbaddies` showing payout model projections for the PythBaddies creator program. Built to walk the Pyth team through budget scenarios and get sign-off on a payout structure.

## Key Framing (Do Not Lose)

1. **Twitter-only pilot.** The 10 creators are a base case. The program will expand to TikTok, Instagram, YouTube, and LinkedIn.
2. **Referral-driven growth.** Roster expansion is managed by the Community Council and community leaders via a referral system — not central recruiting.
3. **Surplus = expansion budget.** Every model's surplus is earmarked for referral growth and multi-platform rollout. This is the core argument for the 3M budget.
4. **Creators haven't started Pyth content yet.** Only 1 of 10 has posted Pyth-specific tweets (7 tweets, 15%). The Pyth content multiplier is the key lever once they go live.

## Program Structure

- **Recruited by:** Mersault
- **Initial group:** 13 creators (10 with Twitter handles confirmed, 3 pending)
- **Missing handles:** F Ξ R F Ξ R, iuefiq, Inari
- **Budget scenarios:** 1M PYTH / 6 months and 3M PYTH / 6 months
- **4 payout models:** A (Clipping Spec Mirror), B (Small Creator Adjusted), C (Base Retainer + Performance), D (Tiered Creator Ranks)
- **Recommended:** Model B at 1M (conservative), Model D at 3M (if growth targets are aggressive)

## Creator Roster (Pilot Group)

| Telegram | Twitter | Followers | 2mo Tweets | 2mo Impressions |
|----------|---------|-----------|------------|-----------------|
| alssoe | @alssoee | 1,607 | 70 | 74,646 |
| Cilinn | @1Cilineth | 12,875 | 182 | 1,515,000 |
| icebear | @ice_bearcute | 3,611 | 107 | 284,825 |
| Dina | @0xDinaMi | 793 | 87 | 39,328 |
| nnevvesss | @nnevvesss | 1,734 | 53 | 435,965 |
| Valeria | @valerie_onchain | 2,214 | 197 | 370,082 |
| Pineappleeee | @pineappleeeee17 | 250 | 46 | 17,490 |
| Alexandra | @esochka | 1,231 | 61 | 230,391 |
| KV | @_kate_lv | 5,461 | 145 | 531,102 |
| Vadym (gf) | @grafinkavi | 1,495 | 71 | 244,773 |

## File Map

| File | Purpose |
|------|---------|
| `public/pythbaddies.html` | The dashboard page. Self-contained HTML/CSS/JS, all data embedded inline. Served at `/pythbaddies`. |
| `src/status-server.ts` | Routes `/pythbaddies` to `pythbaddies.html` (lines ~317-318). |
| `public/index.html` | Status page — has nav link to PythBaddies. |
| `public/payouts.html` | Payouts page — has nav link to PythBaddies. |

### External files (in Pyth Community repo, not MissionMonitor)

| File | Purpose |
|------|---------|
| `06_Twitter_Growth/tools/pythbaddies-analysis.ts` | Script that pulls Twitter data and generates the markdown report. Run with `npx ts-node pythbaddies-analysis.ts`. |
| `06_Twitter_Growth/data/pythbaddies-raw-2026-03-18.json` | Raw API data for all 10 creators (cached — won't re-pull on same day). |
| `04_Drafts_and_Ideas/PythBaddies_Payout_Model.md` | Full markdown report with all models, projections, sensitivity analysis. |

## Dashboard Structure

The page has 5 tabbed sections controlled by `data-section` attributes:

1. **Overview** (`#overview`) — stat cards, roster table, key findings, recommendation
2. **Models 1M** (`#models1m`) — sub-tabbed Models A-D with tier tables, per-creator projections, burn/surplus
3. **Models 3M** (`#models3m`) — same structure at 3x budget
4. **Runway** (`#runway`) — comparison matrices, visual bar chart, sensitivity analysis
5. **Raw Data** (`#rawdata`) — per-creator stats, concentration risk, engagement correlation

Model sub-tabs use `data-model` attributes (e.g., `1m-a`, `1m-b`, `3m-d`). Panel IDs follow `model-{prefix}` pattern (e.g., `id="model-1m-a"`).

## Design System

- Background: `#0d1117`, text: `#c9d1d9`, accent: `#58a6ff`
- Cards: `#161b22` bg, `#21262d` border
- Callout types: `.callout.amber` (warnings), `.callout.green` (recommendations), `.callout.blue` (context), `.callout.muted` (notes)
- All CSS is inline in `<style>` tag — no external stylesheet dependency
- Print-friendly: `@media print` strips nav/tabs, shows all sections, white background

## How to Update Data

If you need to refresh with new Twitter data:
1. `cd "06_Twitter_Growth/tools" && npx ts-node pythbaddies-analysis.ts`
2. Script uses cached data for same-day runs. Delete `data/pythbaddies-raw-YYYY-MM-DD.json` to force re-pull.
3. Manually update the numbers in `public/pythbaddies.html` (data is embedded, not fetched from API).

## Existing Clipping Program Reference

The Pyth clipping program (separate from PythBaddies) targets Instagram/TikTok with a 1.5M PYTH budget. PythBaddies uses adjusted tiers because these are smaller Twitter-native creators, not clip farm operators. See `02_Library/notion-intel/campaign-clipping-program.md` for the full clipping spec.

## MissionMonitor Integration Path

When the payout model is approved:
- Add PythBaddies as a creator group in MissionMonitor config
- Configure tier tables matching the chosen model
- Add Pyth keyword detection for content multiplier
- Set up monthly payout aggregation via existing Sheets export (`src/sheets.ts`)
- Referral tracking already exists in MissionMonitor (`src/storage.ts` — 10% split, 90-day window)
