# Mission Control Bot

Always-online Telegram and Discord bot for Pyth Mission Control.

## Features

- **Telegram Commands**
  - `/mission <topic>` - Generate mission brief from Notion campaigns
  - `/tweets <topic>` - Generate 10 tweet suggestions
  - `/help` - Show available commands

- **Discord Integration**
  - Auto-confirm submissions (📝 reaction)
  - Judge voting (1️⃣-5️⃣ reactions)
  - Automatic score announcements

## Quick Start (Local)

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your tokens

# Run in development mode
npm run dev
```

## Deployment (DigitalOcean)

### 1. Create Droplet

1. Log into DigitalOcean
2. Create Droplet → Marketplace → "Docker on Ubuntu"
3. Choose $6/mo plan (1 vCPU, 1GB RAM)
4. Add your SSH key
5. Create and note the IP address

### 2. Upload Bot to Server

```bash
# From your local machine
scp -r ./bot root@YOUR_DROPLET_IP:/root/mission-control-bot
```

### 3. Configure on Server

```bash
ssh root@YOUR_DROPLET_IP
cd /root/mission-control-bot

# Create .env file
cp .env.example .env
nano .env  # Edit with your tokens
```

### 4. Build and Run

```bash
# Build Docker image
docker build -t mission-control-bot .

# Run with auto-restart
docker run -d \
  --name mission-control \
  --restart unless-stopped \
  --env-file .env \
  mission-control-bot
```

### 5. View Logs

```bash
# Follow logs
docker logs -f mission-control

# View last 100 lines
docker logs --tail 100 mission-control
```

### 6. Update Bot

```bash
# Stop current container
docker stop mission-control
docker rm mission-control

# Pull latest code (or scp again)
git pull  # if using git

# Rebuild and run
docker build -t mission-control-bot .
docker run -d --name mission-control --restart unless-stopped --env-file .env mission-control-bot
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Cloud Server                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Mission Control Bot (Docker)                          │  │
│  │  ├── Telegram Bot (grammy)                             │  │
│  │  │   └── /mission, /tweets, /help                      │  │
│  │  ├── Discord Bot (discord.js)                          │  │
│  │  │   └── Reactions: confirm, vote                      │  │
│  │  ├── Claude API (anthropic-sdk)                        │  │
│  │  │   └── Content generation                            │  │
│  │  └── Notion API (@notionhq/client)                     │  │
│  │       └── Campaign search                              │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather |
| `TELEGRAM_ALLOWED_CHAT_IDS` | No | Restrict to specific chats |
| `DISCORD_BOT_TOKEN` | Yes | From Discord Developer Portal |
| `DISCORD_GUILD_ID` | Yes | Your server ID |
| `DISCORD_MISSION_CHANNEL_ID` | Yes | Channel for missions |
| `DISCORD_RESULTS_CHANNEL_ID` | Yes | Channel for scores |
| `DISCORD_JUDGE_ROLE_IDS` | Yes | Roles that can vote |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `NOTION_TOKEN` | Yes | Notion integration token |
| `NOTION_CAMPAIGNS_DB_ID` | Yes | Campaigns database ID |

## Troubleshooting

**Bot not responding:**
```bash
docker logs mission-control
```

**Restart bot:**
```bash
docker restart mission-control
```

**Check if running:**
```bash
docker ps
```

**Enter container for debugging:**
```bash
docker exec -it mission-control sh
```
