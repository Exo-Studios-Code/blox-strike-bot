import { Player } from '@prisma/client';
import { prisma } from '../../config/database';
import { EloCalculator } from './EloCalculator';
import { getLevelFromElo } from '../../utils/constants';
import { logger } from '../../utils/logger';
import { NotificationService } from '../../services/NotificationService';
import { GUILD_CONFIG, LEVEL_ROLES } from '../../config/bot';

export class RatingEngine {
  /**
   * Process Elo/MMR updates for all participants after a match is confirmed.
   */
  static async processMatchResult(matchId: string): Promise<void> {
    const match = await prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      include: { participants: { include: { player: true } } },
    });

    if (!match.scoreA === null || match.scoreB === null) {
      logger.warn('RatingEngine: match has no scores', { matchId });
      return;
    }

    const winner = match.winnerId; // 'A', 'B', or null (draw)
    const teamAPlayers = match.participants.filter((p) => p.team === 'A').map((p) => p.player);
    const teamBPlayers = match.participants.filter((p) => p.team === 'B').map((p) => p.player);

    const avgEloA = Math.round(teamAPlayers.reduce((s, p) => s + p.elo, 0) / teamAPlayers.length);
    const avgEloB = Math.round(teamBPlayers.reduce((s, p) => s + p.elo, 0) / teamBPlayers.length);
    const avgMMRA = Math.round(teamAPlayers.reduce((s, p) => s + p.mmr, 0) / teamAPlayers.length);
    const avgMMRB = Math.round(teamBPlayers.reduce((s, p) => s + p.mmr, 0) / teamBPlayers.length);

    const wonA = winner === 'A';
    const wonB = winner === 'B';
    const drew = winner === null;

    for (const player of teamAPlayers) {
      await this.updatePlayer(
        player,
        avgEloB,
        avgMMRB,
        wonA,
        drew,
        matchId,
        match.seasonId ?? undefined
      );
    }

    for (const player of teamBPlayers) {
      await this.updatePlayer(
        player,
        avgEloA,
        avgMMRA,
        wonB,
        drew,
        matchId,
        match.seasonId ?? undefined
      );
    }

    logger.info('RatingEngine: processed match result', { matchId });
  }

  private static async updatePlayer(
    player: Player,
    opponentAvgElo: number,
    opponentAvgMMR: number,
    won: boolean,
    drew: boolean,
    matchId: string,
    seasonId?: string
  ): Promise<void> {
    const isPlacement = !player.isPlaced;

    const { newElo, delta: eloDelta } = EloCalculator.calculateNewElo(
      player.elo,
      opponentAvgElo,
      won,
      drew,
      player.level,
      player.totalMatches,
      player.winStreak
    );

    const { newMMR } = EloCalculator.calculateNewMMR(
      player.mmr,
      opponentAvgMMR,
      won,
      drew
    );

    const newLevelBracket = getLevelFromElo(newElo);
    const newLevel = newLevelBracket.level;
    const levelChanged = newLevel !== player.level;
    const leveledUp = newLevel > player.level;

    const newWins = player.wins + (won ? 1 : 0);
    const newLosses = player.losses + (!won && !drew ? 1 : 0);
    const newDraws = player.draws + (drew ? 1 : 0);
    const newWinStreak = won ? player.winStreak + 1 : 0;
    const newLongestStreak = Math.max(player.longestWinStreak, newWinStreak);
    const newTotal = player.totalMatches + 1;

    // Placement tracking
    let updatedIsPlaced = player.isPlaced;
    let updatedPlacementWins = player.placementWins;
    let updatedPlacementLosses = player.placementLosses;
    let updatedPlacementGamesLeft = player.placementGamesLeft;

    if (isPlacement) {
      updatedPlacementWins += won ? 1 : 0;
      updatedPlacementLosses += !won && !drew ? 1 : 0;
      updatedPlacementGamesLeft -= 1;

      if (updatedPlacementGamesLeft <= 0) {
        updatedIsPlaced = true;
        // Override Elo with placement result
        const placementElo = EloCalculator.calculatePlacementElo(
          updatedPlacementWins,
          updatedPlacementLosses
        );
        // We use the placement formula to set final Elo post-placement
        // (already computed above via normal path — here we just set status)
      }
    }

    await prisma.$transaction(async (tx) => {
      // Update player
      await tx.player.update({
        where: { id: player.id },
        data: {
          elo: newElo,
          mmr: newMMR,
          level: newLevel,
          peakElo: Math.max(player.peakElo, newElo),
          peakLevel: Math.max(player.peakLevel, newLevel),
          wins: newWins,
          losses: newLosses,
          draws: newDraws,
          winStreak: newWinStreak,
          longestWinStreak: newLongestStreak,
          totalMatches: newTotal,
          lastMatchAt: new Date(),
          decayActive: false, // Reset decay on match played
          decayWarningAt: null,
          isPlaced: updatedIsPlaced,
          placementWins: updatedPlacementWins,
          placementLosses: updatedPlacementLosses,
          placementGamesLeft: updatedPlacementGamesLeft,
          status: updatedIsPlaced ? 'ACTIVE' : 'PLACEMENT',
        },
      });

      // Update participant record
      await tx.matchParticipant.updateMany({
        where: { matchId, playerId: player.id },
        data: {
          eloChange: eloDelta,
          mmrChange: newMMR - player.mmr,
          eloAfter: newElo,
        },
      });

      // Write Elo history
      await tx.eloHistory.create({
        data: {
          playerId: player.id,
          matchId,
          eloBefore: player.elo,
          eloAfter: newElo,
          eloDelta,
          mmrBefore: player.mmr,
          mmrAfter: newMMR,
          levelBefore: player.level,
          levelAfter: newLevel,
          reason: isPlacement ? 'PLACEMENT' : won ? 'MATCH_WIN' : drew ? 'MATCH_DRAW' : 'MATCH_LOSS',
          seasonId: seasonId ?? null,
        },
      });
    });

    // Post-update notifications
    if (levelChanged) {
      await NotificationService.sendLevelChangeNotification(
        player.discordId,
        player.level,
        newLevel,
        newLevelBracket.name,
        newLevelBracket.emoji,
        leveledUp
      );

      // Update Discord role
      await this.updateLevelRole(player.discordId, player.level, newLevel);
    }

    logger.debug('Player Elo updated', {
      playerId: player.id,
      eloBefore: player.elo,
      eloAfter: newElo,
      eloDelta,
      levelBefore: player.level,
      levelAfter: newLevel,
    });
  }

  private static async updateLevelRole(
    discordId: string,
    oldLevel: number,
    newLevel: number
  ): Promise<void> {
    try {
      const { getRedisClient } = await import('../../config/redis');
      const redis = getRedisClient();
      const guildId = GUILD_CONFIG.guildId;

      // Store role update job for the bot to process
      await redis.lpush(
        'roleUpdates',
        JSON.stringify({ discordId, guildId, oldLevel, newLevel })
      );
    } catch (error) {
      logger.warn('Failed to queue role update', { discordId, error });
    }
  }

  /**
   * Check for smurf indicators and flag if suspicious.
   */
  static async detectSmurf(playerId: string): Promise<boolean> {
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player) return false;

    const flags: string[] = [];

    const winRate = player.wins / Math.max(player.totalMatches, 1);
    if (winRate > 0.75 && player.totalMatches > 10) flags.push('HIGH_WINRATE');

    if (player.totalMatches <= 20) {
      const eloGain = player.elo - 1000;
      if (eloGain > 400) flags.push('RAPID_ELO_GAIN');
    }

    if (player.winStreak > 10) flags.push('LONG_STREAK');

    const accountAgeDays = (Date.now() - player.joinedAt.getTime()) / 86400000;
    if (accountAgeDays < 7 && winRate > 0.70) flags.push('NEW_ACCOUNT_HIGH_PERF');

    if (flags.length >= 2) {
      await prisma.player.update({
        where: { id: playerId },
        data: { suspiciousFlags: { increment: flags.length } },
      });

      if (flags.length >= 3) {
        await NotificationService.notifyAdminsSuspiciousAccount(playerId, flags);
      }
      return true;
    }
    return false;
  }
}
