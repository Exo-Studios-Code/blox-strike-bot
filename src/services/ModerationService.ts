import { Ban } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

export class ModerationService {
  static async getActiveBan(discordId: string): Promise<Ban | null> {
    const player = await prisma.player.findUnique({ where: { discordId } });
    if (!player) return null;

    return prisma.ban.findFirst({
      where: {
        playerId: player.id,
        liftedAt: null,
        OR: [
          { isPermanent: true },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async isUserBanned(discordId: string): Promise<Ban | null> {
    return this.getActiveBan(discordId);
  }

  static async banPlayer(
    targetDiscordId: string,
    adminDiscordId: string,
    reason: string,
    durationHours?: number,
    evidence: string[] = []
  ): Promise<{ success: boolean; error?: string }> {
    const player = await prisma.player.findUnique({ where: { discordId: targetDiscordId } });
    if (!player) return { success: false, error: 'Player not found.' };

    const isPermanent = !durationHours;
    const expiresAt = durationHours
      ? new Date(Date.now() + durationHours * 3_600_000)
      : null;

    await prisma.$transaction([
      prisma.ban.create({
        data: {
          playerId: player.id,
          adminId: adminDiscordId,
          reason,
          evidence,
          isPermanent,
          expiresAt,
        },
      }),
      prisma.player.update({
        where: { id: player.id },
        data: {
          status: isPermanent ? 'BANNED' : 'SUSPENDED',
          banReason: reason,
          banExpiresAt: expiresAt,
        },
      }),
    ]);

    logger.info('Player banned', {
      targetDiscordId,
      adminDiscordId,
      reason,
      isPermanent,
      expiresAt,
    });

    return { success: true };
  }

  static async unbanPlayer(
    targetDiscordId: string,
    adminDiscordId: string
  ): Promise<{ success: boolean; error?: string }> {
    const player = await prisma.player.findUnique({ where: { discordId: targetDiscordId } });
    if (!player) return { success: false, error: 'Player not found.' };

    const activeBan = await this.getActiveBan(targetDiscordId);
    if (!activeBan) return { success: false, error: 'Player is not currently banned.' };

    await prisma.$transaction([
      prisma.ban.update({
        where: { id: activeBan.id },
        data: { liftedAt: new Date(), liftedById: adminDiscordId },
      }),
      prisma.player.update({
        where: { id: player.id },
        data: {
          status: 'ACTIVE',
          banReason: null,
          banExpiresAt: null,
        },
      }),
    ]);

    logger.info('Player unbanned', { targetDiscordId, adminDiscordId });
    return { success: true };
  }

  static async resetElo(
    targetDiscordId: string,
    adminDiscordId: string
  ): Promise<{ success: boolean; error?: string }> {
    const player = await prisma.player.findUnique({ where: { discordId: targetDiscordId } });
    if (!player) return { success: false, error: 'Player not found.' };

    const prevElo = player.elo;

    await prisma.$transaction([
      prisma.player.update({
        where: { id: player.id },
        data: {
          elo: 1000,
          mmr: 1000,
          level: 3,
          wins: 0,
          losses: 0,
          draws: 0,
          totalMatches: 0,
          winStreak: 0,
          longestWinStreak: 0,
          isPlaced: false,
          placementGamesLeft: 10,
          placementWins: 0,
          placementLosses: 0,
          status: 'PLACEMENT',
        },
      }),
      prisma.eloHistory.create({
        data: {
          playerId: player.id,
          eloBefore: prevElo,
          eloAfter: 1000,
          eloDelta: 1000 - prevElo,
          mmrBefore: player.mmr,
          mmrAfter: 1000,
          levelBefore: player.level,
          levelAfter: 3,
          reason: 'RESET',
        },
      }),
    ]);

    logger.info('Player Elo reset', { targetDiscordId, adminDiscordId, prevElo });
    return { success: true };
  }
}
