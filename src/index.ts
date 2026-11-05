import 'dotenv/config';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Events } from 'discord.js';
import { BloxStrikeClient } from './bot/client';
import { handleInteraction } from './bot/handlers/interactionHandler';
import { prisma } from './config/database';
import { connectRedis } from './config/redis';
import { env } from './config/env';
import { logger } from './utils/logger';
import { SlashCommand } from './types/discord.types';

const client = new BloxStrikeClient();

// ─── Command Loader ──────────────────────────────────────────────────────────

async function loadCommands(): Promise<void> {
  const commandsPath = join(__dirname, 'commands');

  const categories = readdirSync(commandsPath).filter((item) =>
    statSync(join(commandsPath, item)).isDirectory()
  );

  for (const category of categories) {
    const categoryPath = join(commandsPath, category);
    const files = readdirSync(categoryPath).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.js')
    );

    for (const file of files) {
      const filePath = join(categoryPath, file);
      const module = await import(filePath);
      const command: SlashCommand = module.default ?? module;

      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        logger.debug(`Loaded command: ${command.data.name}`);
      } else {
        logger.warn(`Skipping invalid command at ${filePath}`);
      }
    }
  }

  logger.info(`✅ Loaded ${client.commands.size} slash commands`);
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

function registerEvents(): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`✅ Logged in as ${readyClient.user.tag}`);
    logger.info(`Serving ${readyClient.guilds.cache.size} guild(s)`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    await handleInteraction(interaction, client);
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    // Sync Discord username changes
    try {
      const { PlayerService } = await import('./services/PlayerService');
      const newTag = newMember.user.username;
      await PlayerService.updateUsername(newMember.user.id, newTag);
    } catch {
      // Non-critical — swallow
    }
  });

  client.on(Events.Error, (error) => {
    logger.error('Discord client error', { error });
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
  });
}

// ─── Background Jobs ─────────────────────────────────────────────────────────

function startBackgroundJobs(): void {
  // Expire stale queue sessions every 60 seconds
  setInterval(async () => {
    try {
      const { QueueService } = await import('./services/QueueService');
      const expired = await QueueService.expireOldSessions();
      if (expired > 0) {
        logger.info('Background: expired queue sessions', { count: expired });
      }
    } catch (error) {
      logger.warn('Background: queue expiry failed', { error });
    }
  }, 60_000);

  // Process queued role update jobs from Redis every 5 seconds
  setInterval(async () => {
    try {
      const { getRedisClient } = await import('./config/redis');
      const redis = getRedisClient();
      const raw = await redis.rpop('roleUpdates');
      if (!raw) return;

      const job = JSON.parse(raw) as {
        discordId: string;
        guildId: string;
        oldLevel: number;
        newLevel: number;
      };

      const guild = client.guilds.cache.get(job.guildId);
      if (!guild) return;

      const member = await guild.members.fetch(job.discordId).catch(() => null);
      if (!member) return;

      const { LEVEL_ROLES } = await import('./config/bot');
      const oldRoleId = LEVEL_ROLES[job.oldLevel];
      const newRoleId = LEVEL_ROLES[job.newLevel];

      if (oldRoleId && member.roles.cache.has(oldRoleId)) {
        await member.roles.remove(oldRoleId).catch(() => null);
      }
      if (newRoleId) {
        await member.roles.add(newRoleId).catch(() => null);
      }
    } catch (error) {
      logger.warn('Background: role update failed', { error });
    }
  }, 5_000);
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  logger.info('Shutting down…');
  client.destroy();
  await prisma.$disconnect();
  const { disconnectRedis } = await import('./config/redis');
  await disconnectRedis();
  process.exit(0);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  logger.info('Starting Blox Strike bot…');

  // Connect to database
  await prisma.$connect();
  logger.info('✅ Prisma connected');

  // Connect to Redis
  await connectRedis();

  // Load slash commands into memory
  await loadCommands();

  // Register Discord event handlers
  registerEvents();

  // Start background maintenance jobs
  startBackgroundJobs();

  // Log in to Discord
  await client.login(env.DISCORD_TOKEN);
}

bootstrap().catch((error) => {
  logger.error('Fatal error during bootstrap', { error });
  process.exit(1);
});