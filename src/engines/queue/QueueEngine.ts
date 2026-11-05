import Redis from 'ioredis';
import { QueueType } from '@prisma/client';
import { MatchEngine } from '../match/MatchEngine';
import { logger } from '../../utils/logger';
import { QUEUE_CONFIG } from '../../config/bot';
import { QueueEntry, JoinInfo } from '../../types/queue.types';

export class QueueEngine {
  private static readonly PREFIX = 'queue:';
  private static matchEngine: MatchEngine | null = null;

  static setMatchEngine(engine: MatchEngine): void {
    this.matchEngine = engine;
  }

  static async addToQueue(redis: Redis, entry: QueueEntry): Promise<void> {
    const key = `${this.PREFIX}${entry.type}`;
    await redis.zadd(key, entry.averageElo, JSON.stringify(entry));

    logger.info('Player added to queue', {
      sessionId: entry.sessionId,
      elo: entry.averageElo,
      type: entry.type,
    });

    await this.tryMatch(redis, entry.type);
  }

  static async removeFromQueue(
    redis: Redis,
    sessionId: string,
    type: QueueType
  ): Promise<boolean> {
    const key = `${this.PREFIX}${type}`;
    const members = await redis.zrange(key, 0, -1);

    for (const member of members) {
      const entry: QueueEntry = JSON.parse(member);
      if (entry.sessionId === sessionId) {
        await redis.zrem(key, member);
        logger.info('Player removed from queue', { sessionId, type });
        return true;
      }
    }
    return false;
  }

  static async tryMatch(redis: Redis, type: QueueType): Promise<void> {
    if (!this.matchEngine) {
      logger.warn('QueueEngine: MatchEngine not set');
      return;
    }

    const key = `${this.PREFIX}${type}`;
    const playersPerTeam = QUEUE_CONFIG.playersPerTeam[type];
    const totalRequired = playersPerTeam * 2;

    // Use Redis sorted set range to get entries sorted by Elo
    const rawEntries = await redis.zrange(key, 0, -1);
    if (rawEntries.length < 2) return;

    const parsed: QueueEntry[] = rawEntries.map((r) => JSON.parse(r));

    for (let i = 0; i < parsed.length; i++) {
      const anchor = parsed[i];
      const compatible: QueueEntry[] = [anchor];
      const tolerance = this.calculateEloTolerance(anchor.queuedAt);

      for (let j = 0; j < parsed.length; j++) {
        if (i === j) continue;
        const candidate = parsed[j];

        // Elo range check
        if (Math.abs(candidate.averageElo - anchor.averageElo) > tolerance) continue;

        // Duplicate player check
        const existingIds = compatible.flatMap((e) => e.playerIds);
        const hasOverlap = candidate.playerIds.some((id) => existingIds.includes(id));
        if (hasOverlap) continue;

        compatible.push(candidate);

        const totalPlayers = compatible.reduce((s, e) => s + e.playerIds.length, 0);
        if (totalPlayers >= totalRequired) {
          await this.formMatch(redis, compatible, type, totalRequired);
          return;
        }
      }
    }
  }

  private static calculateEloTolerance(queuedAt: number): number {
    const waitMinutes = (Date.now() - queuedAt) / 60_000;
    const expand = Math.floor(waitMinutes / 5) * QUEUE_CONFIG.eloExpandPerFiveMinutes;
    return Math.min(QUEUE_CONFIG.initialEloTolerance + expand, QUEUE_CONFIG.maxEloTolerance);
  }

  private static async formMatch(
    redis: Redis,
    entries: QueueEntry[],
    type: QueueType,
    totalRequired: number
  ): Promise<void> {
    const selected: QueueEntry[] = [];
    let playerCount = 0;

    for (const entry of entries) {
      selected.push(entry);
      playerCount += entry.playerIds.length;
      if (playerCount >= totalRequired) break;
    }

    // Remove from Redis atomically
    const key = `${this.PREFIX}${type}`;
    const pipeline = redis.pipeline();
    for (const entry of selected) {
      pipeline.zrem(key, JSON.stringify(entry));
    }
    await pipeline.exec();

    // Use first (lowest Elo) entry's join info as the match join method
    const creator = selected[0];
    const joinInfo: JoinInfo = {
      joinMethod: creator.joinMethod,
      privateServerUrl: creator.privateServerUrl,
      inviteCode: creator.inviteCode,
      robloxUsername: creator.robloxUsername,
      joinInstructions: creator.joinInstructions,
      backupContact: creator.backupContact,
    };

    logger.info('Forming match', {
      type,
      sessions: selected.map((e) => e.sessionId),
      totalPlayers: playerCount,
    });

    await this.matchEngine!.createMatch(selected, type, joinInfo);
  }

  static async getQueueStatus(
    redis: Redis,
    type: QueueType
  ): Promise<{ count: number; entries: QueueEntry[] }> {
    const key = `${this.PREFIX}${type}`;
    const raw = await redis.zrange(key, 0, -1);
    const entries = raw.map((r) => JSON.parse(r) as QueueEntry);
    return { count: entries.length, entries };
  }

  static async getAllQueueCounts(redis: Redis): Promise<Record<QueueType, number>> {
    const [solo, duo, full] = await Promise.all([
      redis.zcard(`${this.PREFIX}SOLO`),
      redis.zcard(`${this.PREFIX}DUO`),
      redis.zcard(`${this.PREFIX}FULL_TEAM`),
    ]);

    return {
      [QueueType.SOLO]: solo,
      [QueueType.DUO]: duo,
      [QueueType.FULL_TEAM]: full,
    };
  }
}
