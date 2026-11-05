import { PrismaClient, QueueSession, Prisma } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Redis client (singleton export so MatchmakingWorker can share it)
// ─────────────────────────────────────────────────────────────────────────────

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  enableReadyCheck: true,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
});

redis.on("error", (err: Error) =>
  console.error(`[Redis] Connection error: ${err.message}`)
);

// ─────────────────────────────────────────────────────────────────────────────
// Redis keys
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_KEY = "matchmaking:queue";                  // Redis Set of discordIds
const DASHBOARD_KEY = "matchmaking:dashboard";          // Hash storing { channelId, messageId, guildId }
const QUEUE_LOCKED_KEY = "matchmaking:locked";          // "1" when match is being formed

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface JoinQueueResult {
  success: boolean;
  error?:
    | "NOT_REGISTERED"
    | "ALREADY_IN_QUEUE"
    | "QUEUE_LOCKED"
    | "DB_ERROR";
  message?: string;
  queueCount?: number;
}

export interface LeaveQueueResult {
  success: boolean;
  error?: "NOT_IN_QUEUE" | "DB_ERROR";
  message?: string;
  queueCount?: number;
}

export interface DashboardRef {
  channelId: string;
  messageId: string;
  guildId: string;
}

export interface QueuePlayerInfo {
  discordId: string;
  mmr: number;
  robloxUsername: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// QueueService
// ─────────────────────────────────────────────────────────────────────────────

export class QueueService {
  // ── Queue State ─────────────────────────────────────────────────────────────

  static async isQueueLocked(): Promise<boolean> {
    try {
      const val = await redis.get(QUEUE_LOCKED_KEY);
      return val === "1";
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.isQueueLocked] Redis error: ${msg}`);
      return false;
    }
  }

  static async lockQueue(): Promise<void> {
    try {
      await redis.set(QUEUE_LOCKED_KEY, "1", "EX", 60); // 60s auto-expire safety
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.lockQueue] Redis error: ${msg}`);
    }
  }

  static async unlockQueue(): Promise<void> {
    try {
      await redis.del(QUEUE_LOCKED_KEY);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.unlockQueue] Redis error: ${msg}`);
    }
  }

  // ── Join Queue ───────────────────────────────────────────────────────────────

  static async joinQueue(
    discordId: string,
    privateServerUrl?: string
  ): Promise<JoinQueueResult> {
    try {
      // 1. Queue lock check
      if (await QueueService.isQueueLocked()) {
        return {
          success: false,
          error: "QUEUE_LOCKED",
          message:
            "A match is currently being formed. Please wait a moment and try again.",
        };
      }

      // 2. Registration check
      const player = await prisma.player.findUnique({ where: { discordId } });
      if (!player) {
        return {
          success: false,
          error: "NOT_REGISTERED",
          message:
            "You are not registered. Please use `/register` first.",
        };
      }

      // 3. Already in queue check (Redis fast path)
      const alreadyInRedis = await redis.sismember(QUEUE_KEY, discordId);
      if (alreadyInRedis) {
        const count = await redis.scard(QUEUE_KEY);
        return {
          success: false,
          error: "ALREADY_IN_QUEUE",
          message: "You are already in the queue.",
          queueCount: count,
        };
      }

      // 4. Upsert QueueSession in Prisma
      await prisma.queueSession.upsert({
        where: { discordId },
        update: {
          status: "SEARCHING",
          privateServerUrl: privateServerUrl ?? null,
          joinedAt: new Date(),
        },
        create: {
          discordId,
          status: "SEARCHING",
          privateServerUrl: privateServerUrl ?? null,
          joinedAt: new Date(),
        },
      });

      // 5. Add to Redis set
      await redis.sadd(QUEUE_KEY, discordId);
      const queueCount = await redis.scard(QUEUE_KEY);

      return { success: true, queueCount };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.joinQueue] DB error: ${msg}`);
      return {
        success: false,
        error: "DB_ERROR",
        message: "A database error occurred. Please try again later.",
      };
    }
  }

  // ── Leave Queue ──────────────────────────────────────────────────────────────

  static async leaveQueue(discordId: string): Promise<LeaveQueueResult> {
    try {
      // 1. Check if actually in queue
      const inQueue = await redis.sismember(QUEUE_KEY, discordId);
      if (!inQueue) {
        return {
          success: false,
          error: "NOT_IN_QUEUE",
          message: "You are not currently in the queue.",
        };
      }

      // 2. Cancel QueueSession in Prisma
      await prisma.queueSession.updateMany({
        where: { discordId, status: "SEARCHING" },
        data: { status: "CANCELLED" },
      });

      // 3. Remove from Redis
      await redis.srem(QUEUE_KEY, discordId);
      const queueCount = await redis.scard(QUEUE_KEY);

      return { success: true, queueCount };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.leaveQueue] DB error: ${msg}`);
      return {
        success: false,
        error: "DB_ERROR",
        message: "A database error occurred. Please try again later.",
      };
    }
  }

  // ── Queue Info ───────────────────────────────────────────────────────────────

  static async getQueueCount(): Promise<number> {
    try {
      return await redis.scard(QUEUE_KEY);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.getQueueCount] Redis error: ${msg}`);
      return 0;
    }
  }

  static async getQueueMembers(): Promise<string[]> {
    try {
      return await redis.smembers(QUEUE_KEY);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.getQueueMembers] Redis error: ${msg}`);
      return [];
    }
  }

  /**
   * Returns full player info for all queued members, sorted by MMR descending.
   */
  static async getQueuePlayerInfos(): Promise<QueuePlayerInfo[]> {
    try {
      const discordIds = await QueueService.getQueueMembers();
      if (discordIds.length === 0) return [];

      const players = await prisma.player.findMany({
        where: { discordId: { in: discordIds } },
        select: { discordId: true, mmr: true, robloxUsername: true },
      });

      return players.sort((a, b) => b.mmr - a.mmr);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.getQueuePlayerInfos] DB error: ${msg}`);
      return [];
    }
  }

  /**
   * Atomically pop exactly 10 players from the queue for match formation.
   * Returns null if fewer than 10 players are available.
   */
  static async popTenPlayers(): Promise<string[] | null> {
    try {
      const count = await redis.scard(QUEUE_KEY);
      if (count < 10) return null;

      // Use a Lua script for atomicity
      const luaScript = `
        local members = redis.call('SMEMBERS', KEYS[1])
        if #members < 10 then return {} end
        local popped = {}
        for i = 1, 10 do
          table.insert(popped, members[i])
          redis.call('SREM', KEYS[1], members[i])
        end
        return popped
      `;

      const result = await redis.eval(luaScript, 1, QUEUE_KEY) as string[];
      if (!result || result.length < 10) return null;

      return result;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.popTenPlayers] Redis error: ${msg}`);
      return null;
    }
  }

  /**
   * Restore players back to the queue (used on match formation failure).
   */
  static async restorePlayers(discordIds: string[]): Promise<void> {
    try {
      if (discordIds.length > 0) {
        await redis.sadd(QUEUE_KEY, ...discordIds);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.restorePlayers] Redis error: ${msg}`);
    }
  }

  // ── Dashboard Reference ──────────────────────────────────────────────────────

  static async saveDashboardRef(ref: DashboardRef): Promise<void> {
    try {
      await redis.hset(DASHBOARD_KEY, {
        channelId: ref.channelId,
        messageId: ref.messageId,
        guildId: ref.guildId,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.saveDashboardRef] Redis error: ${msg}`);
    }
  }

  static async getDashboardRef(): Promise<DashboardRef | null> {
    try {
      const data = await redis.hgetall(DASHBOARD_KEY);
      if (!data?.channelId || !data?.messageId || !data?.guildId) return null;
      return data as DashboardRef;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.getDashboardRef] Redis error: ${msg}`);
      return null;
    }
  }

  static async clearDashboardRef(): Promise<void> {
    try {
      await redis.del(DASHBOARD_KEY);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.clearDashboardRef] Redis error: ${msg}`);
    }
  }

  // ── Queue Session DB helpers ─────────────────────────────────────────────────

  static async markSessionsAsFound(discordIds: string[]): Promise<void> {
    try {
      await prisma.queueSession.updateMany({
        where: { discordId: { in: discordIds }, status: "SEARCHING" },
        data: { status: "FOUND" },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.markSessionsAsFound] DB error: ${msg}`);
    }
  }

  static async resetQueueSessions(discordIds: string[]): Promise<void> {
    try {
      await prisma.queueSession.updateMany({
        where: { discordId: { in: discordIds } },
        data: { status: "CANCELLED" },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[QueueService.resetQueueSessions] DB error: ${msg}`);
    }
  }

  // ── Progress Bar Builder ─────────────────────────────────────────────────────

  static buildProgressBar(current: number, max: number = 10): string {
    const filled = Math.min(current, max);
    const empty = max - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    return `\`[${bar}]\` **${current}/${max}**`;
  }
}
