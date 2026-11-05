import { QueueType } from '@prisma/client';
import { env } from './env';

export const QUEUE_CONFIG = {
  playersPerTeam: {
    [QueueType.SOLO]: 1,
    [QueueType.DUO]: 2,
    [QueueType.FULL_TEAM]: 5,
  } as Record<QueueType, number>,
  eloCooldownMinutes: 5,
  maxQueueMinutes: env.MAX_QUEUE_MINUTES,
  initialEloTolerance: 100,
  eloExpandPerFiveMinutes: 50,
  maxEloTolerance: 500,
};

export const MATCH_CONFIG = {
  autoResolveHours: 2,
  disputeWindowHours: 24,
  channelCleanupMinutes: 5,
};

export const GUILD_CONFIG = {
  guildId: env.DISCORD_GUILD_ID,
  matchesCategoryId: env.MATCHES_CATEGORY_ID ?? '',
  logChannelId: env.LOG_CHANNEL_ID ?? '',
  announcementChannelId: env.ANNOUNCEMENT_CHANNEL_ID ?? '',
  adminRoleId: env.ADMIN_ROLE_ID ?? '',
  modRoleId: env.MOD_ROLE_ID ?? '',
  verifiedRoleId: env.VERIFIED_ROLE_ID ?? '',
};

export const LEVEL_ROLES: Record<number, string | undefined> = {
  1: env.ROLE_IRON_ID,
  2: env.ROLE_BRONZE_ID,
  3: env.ROLE_SILVER_ID,
  4: env.ROLE_GOLD_ID,
  5: env.ROLE_PLATINUM_ID,
  6: env.ROLE_DIAMOND_ID,
  7: env.ROLE_MASTER_ID,
  8: env.ROLE_GRANDMASTER_ID,
  9: env.ROLE_LEGENDARY_ID,
  10: env.ROLE_ELITE_ID,
};

export const COLORS = {
  PRIMARY: 0xff6b00,
  SECONDARY: 0x1a1a2e,
  ACCENT: 0xe94560,
  SUCCESS: 0x10b981,
  WARNING: 0xf59e0b,
  DANGER: 0xef4444,
  INFO: 0x3b82f6,
  MUTED: 0x505060,
};

export const PLACEMENT_GAMES_REQUIRED = 10;
