/**
 * src/engines/queue/MatchmakingWorker.ts
 *
 * Standalone matchmaking tick function.  Called on a fixed interval from
 * src/index.ts.  On every tick it:
 *
 *   1. Reads all SEARCHING sessions from the DB (source of truth).
 *   2. Groups them by QueueType.
 *   3. Within each type, sorts by wait time (oldest first) and greedily
 *      pairs sessions whose MMR ranges overlap sufficiently.
 *   4. When enough sessions have been collected to fill both teams it calls
 *      MatchEngine.createMatch() and marks every participating session as
 *      FOUND in a single transaction.
 *
 * ELO tolerance expands automatically the longer a player waits, matching
 * the formula already used when sessions are created in QueueService:
 *
 *   toleranceAtT = initialEloTolerance + floor(waitMinutes / 5) * eloExpandPerFiveMinutes
 *   capped at maxEloTolerance
 *
 * This file has NO side-effects on import — call startMatchmakingLoop() once
 * from index.ts to activate the interval, and stopMatchmakingLoop() on shutdown.
 */

import { Guild } from 'discord.js';
import { QueueType, QueueStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { QUEUE_CONFIG } from '../../config/bot';
import { logger } from '../../utils/logger';
import { JoinInfo } from '../../types/queue.types';
import { getMatchEngine } from '../../bot/matchEngineRegistry';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  type: QueueType;
  averageElo: number;
  eloMin: number;
  eloMax: number;
  playerIds: string[];
  queuedAt: Date;
  joinMethod: string | null;
  privateServerUrl: string | null;
  inviteCode: string | null;
  robloxUsername: string | null;
  joinInstructions: string | null;
  backupContact: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the effective MMR tolerance for a session given its age.
 * Mirrors the expansion policy defined in QUEUE_CONFIG.
 */
function effectiveTolerance(session: SessionRow): number {
  const waitMs = Date.now() - session.queuedAt.getTime();
  const waitMinutes = waitMs / 60_000;
  const expansions = Math.floor(waitMinutes / 5);
  const tolerance =
    QUEUE_CONFIG.initialEloTolerance +
    expansions * QUEUE_CONFIG.eloExpandPerFiveMinutes;
  return Math.min(tolerance, QUEUE_CONFIG.maxEloTolerance);
}

/**
 * Returns true when two sessions are MMR-compatible for matching.
 * Both sessions must accept each other's average MMR within their
 * respective (expanded) tolerance windows.
 */
function areCompatible(a: SessionRow, b: SessionRow): boolean {
  const tolA = effectiveTolerance(a);
  const tolB = effectiveTolerance(b);

  const aAcceptsB =
    b.averageElo >= a.averageElo - tolA &&
    b.averageElo <= a.averageElo + tolA;
  const bAcceptsA =
    a.averageElo >= b.averageElo - tolB &&
    a.averageElo <= b.averageElo + tolB;

  return aAcceptsB && bAcceptsA;
}

/**
 * Build a JoinInfo object from the session that will host the match.
 * We prefer the session with a private server URL or invite code (i.e.
 * the host), falling back to the first session in the group.
 */
function buildJoinInfo(sessions: SessionRow[]): JoinInfo {
  const host =
    sessions.find(
      (s) => s.privateServerUrl || s.inviteCode || s.robloxUsername
    ) ?? sessions[0];

  return {
    joinMethod: (host.joinMethod as JoinInfo['joinMethod']) ?? undefined,
    privateServerUrl: host.privateServerUrl ?? undefined,
    inviteCode: host.inviteCode ?? undefined,
    robloxUsername: host.robloxUsername ?? undefined,
    joinInstructions: host.joinInstructions ?? undefined,
    backupContact: host.backupContact ?? undefined,
  };
}

// ─── Core tick ───────────────────────────────────────────────────────────────

/**
 * One matchmaking tick.  Should be called every 10–15 seconds.
 *
 * @param guild  The Discord guild instance needed by MatchEngine.
 */
export async function runMatchmakingTick(guild: Guild): Promise<void> {
  // 1. Load all active sessions from DB
  const sessions = await prisma.queueSession.findMany({
    where: { status: QueueStatus.SEARCHING },
    orderBy: { queuedAt: 'asc' }, // oldest first = priority
  });

  if (sessions.length === 0) return;

  // 2. Group by type
  const byType = new Map<QueueType, SessionRow[]>();
  for (const s of sessions as SessionRow[]) {
    const bucket = byType.get(s.type) ?? [];
    bucket.push(s);
    byType.set(s.type, bucket);
  }

  const engine = getMatchEngine();
  if (!engine) {
    logger.warn('MatchmakingWorker: MatchEngine not registered — skipping tick');
    return;
  }

  // 3. Process each queue type independently
  for (const [type, pool] of byType.entries()) {
    const playersNeeded = QUEUE_CONFIG.playersPerTeam[type] * 2; // both teams

    // Greedy pairing: try to fill a match from the oldest session outward
    const used = new Set<string>();

    for (let i = 0; i < pool.length; i++) {
      if (used.has(pool[i].id)) continue;

      const group: SessionRow[] = [pool[i]];
      let totalPlayers = pool[i].playerIds.length;

      for (let j = i + 1; j < pool.length; j++) {
        if (used.has(pool[j].id)) continue;
        if (!areCompatible(pool[i], pool[j])) continue;

        const wouldAdd = pool[j].playerIds.length;
        if (totalPlayers + wouldAdd > playersNeeded) continue;

        group.push(pool[j]);
        totalPlayers += wouldAdd;

        if (totalPlayers === playersNeeded) break;
      }

      if (totalPlayers < playersNeeded) continue; // not enough players yet

      // 4. We have a full group — mark them all as used
      for (const s of group) used.add(s.id);

      // 5. Fire match creation (non-blocking — errors logged, loop continues)
      void createMatchFromGroup(engine, guild, group, type);
    }
  }
}

/**
 * Creates a match from a resolved group of sessions and updates DB state.
 * Isolated so that a single failed match attempt never breaks the whole tick.
 */
async function createMatchFromGroup(
  engine: import('../../engines/match/MatchEngine').MatchEngine,
  guild: Guild,
  group: SessionRow[],
  type: QueueType
): Promise<void> {
  const sessionIds = group.map((s) => s.id);

  try {
    // Mark sessions FOUND atomically before calling createMatch so that a
    // crash during channel creation doesn't leave them re-matched next tick.
    await prisma.queueSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { status: QueueStatus.FOUND },
    });

    // Build QueueEntry objects that MatchEngine expects
    const entries = group.map((s) => ({
      sessionId: s.id,
      playerIds: s.playerIds,
      averageElo: s.averageElo,
      type: s.type,
      queuedAt: s.queuedAt.getTime(),
      joinMethod: (s.joinMethod as JoinInfo['joinMethod']) ?? undefined,
      privateServerUrl: s.privateServerUrl ?? undefined,
      inviteCode: s.inviteCode ?? undefined,
      robloxUsername: s.robloxUsername ?? undefined,
      joinInstructions: s.joinInstructions ?? undefined,
      backupContact: s.backupContact ?? undefined,
    }));

    const joinInfo = buildJoinInfo(group);
    const match = await engine.createMatch(entries, type, joinInfo);

    // Link sessions → match in DB
    await prisma.queueSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { matchId: match.id, matchedAt: new Date() },
    });

    logger.info('MatchmakingWorker: match created', {
      matchId: match.id,
      type,
      sessions: sessionIds,
    });
  } catch (error) {
    // Roll sessions back to SEARCHING so they can be re-matched next tick
    logger.error('MatchmakingWorker: match creation failed — rolling back sessions', {
      sessionIds,
      error,
    });

    await prisma.queueSession
      .updateMany({
        where: {
          id: { in: sessionIds },
          status: QueueStatus.FOUND, // only roll back if we set it
        },
        data: { status: QueueStatus.SEARCHING },
      })
      .catch((rollbackErr) =>
        logger.error('MatchmakingWorker: rollback also failed', { rollbackErr })
      );
  }
}

// ─── Loop management ─────────────────────────────────────────────────────────

let loopHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the matchmaking background loop.
 *
 * @param guild         Discord guild instance (fetched once in ClientReady).
 * @param intervalMs    How often to tick.  Default: 12 000 ms (12 s).
 */
export function startMatchmakingLoop(
  guild: Guild,
  intervalMs = 12_000
): void {
  if (loopHandle) {
    logger.warn('MatchmakingWorker: loop already running — ignoring duplicate start');
    return;
  }

  logger.info(`MatchmakingWorker: starting loop (interval ${intervalMs}ms)`);

  // Run immediately on first start, then on every interval
  void runFirstTick(guild);

  loopHandle = setInterval(() => {
    runMatchmakingTick(guild).catch((err) =>
      logger.error('MatchmakingWorker: unhandled tick error', { err })
    );
  }, intervalMs);
}

async function runFirstTick(guild: Guild): Promise<void> {
  // Small delay so the rest of bootstrap finishes before the first tick
  await new Promise((r) => setTimeout(r, 2_000));
  await runMatchmakingTick(guild).catch((err) =>
    logger.error('MatchmakingWorker: unhandled first-tick error', { err })
  );
}

/**
 * Stop the matchmaking loop (call during graceful shutdown).
 */
export function stopMatchmakingLoop(): void {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
    logger.info('MatchmakingWorker: loop stopped');
  }
}
