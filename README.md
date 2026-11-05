# Blox Strike Bot

A competitive PUG Discord bot built with TypeScript. It handles queues, balanced matchmaking, Elo ratings and moderation for a Blox Strike community.

## Features

- Queue system with join/leave commands and live queue embeds
- Automatic team balancing and match creation
- Elo-based rating engine with rank roles (Iron to Legendary)
- Player registration and profile embeds
- Match result submission with dispute handling
- Seasons, leagues, tournaments and team management
- Moderation tools: reports, bans and log channel
- Temporary voice rooms for matches
- Background matchmaking worker powered by BullMQ

## Tech Stack

- Node.js and TypeScript
- discord.js v14
- Prisma ORM with PostgreSQL
- Redis (ioredis) and BullMQ
- Winston (logging)
- Zod (env validation)
- node-cron

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Redis instance
- A Discord application with a bot token

### Installation

```bash
git clone https://github.com/<user>/blox-strike-bot.git
cd blox-strike-bot
npm install
```

### Configuration

Copy the example file and fill in your values:

```bash
cp env.example .env
```

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id

ADMIN_ROLE_ID=
MOD_ROLE_ID=
VERIFIED_ROLE_ID=

MATCHES_CATEGORY_ID=
LOG_CHANNEL_ID=
ANNOUNCEMENT_CHANNEL_ID=

DATABASE_URL=postgresql://user:password@localhost:5432/bloxstrike
REDIS_URL=redis://localhost:6379

NODE_ENV=development
BOT_PREFIX=!
DEFAULT_REGION=EU
MAX_QUEUE_MINUTES=45
LOG_LEVEL=info
```

Level role IDs (`ROLE_IRON_ID`, `ROLE_BRONZE_ID`, ... `ROLE_ELITE_ID`) are optional.

### Database

```bash
npm run prisma:generate
npx prisma db push
```

### Run

```bash
npm run deploy-commands   # register slash commands
npm run dev               # development mode
```

Production:

```bash
npm run build
npm start
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with auto-reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run the compiled bot |
| `npm run deploy-commands` | Register slash commands |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run typecheck` | Type-check without emitting |
