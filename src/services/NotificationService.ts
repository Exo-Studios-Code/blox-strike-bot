import { logger } from '../utils/logger';
import { GUILD_CONFIG } from '../config/bot';

// Circular-dependency-safe: lazy import of client
let discordClient: import('discord.js').Client | null = null;

export function setNotificationClient(client: import('discord.js').Client): void {
  discordClient = client;
}

export class NotificationService {
  static async sendDM(discordId: string, content: string): Promise<boolean> {
    if (!discordClient) return false;
    try {
      const user = await discordClient.users.fetch(discordId);
      await user.send(content);
      return true;
    } catch {
      logger.debug('Could not DM user', { discordId });
      return false;
    }
  }

  static async sendDMEmbed(
    discordId: string,
    embed: import('discord.js').EmbedBuilder
  ): Promise<boolean> {
    if (!discordClient) return false;
    try {
      const user = await discordClient.users.fetch(discordId);
      await user.send({ embeds: [embed] });
      return true;
    } catch {
      return false;
    }
  }

  static async notifyMatchFound(
    discordIds: string[],
    matchId: string
  ): Promise<void> {
    const shortId = matchId.slice(0, 8).toUpperCase();
    for (const id of discordIds) {
      await this.sendDM(
        id,
        `🎮 **Match Found!** \`#${shortId}\`\nHead to your match channel to see your team and join info.`
      );
    }
  }

  static async sendLevelChangeNotification(
    discordId: string,
    oldLevel: number,
    newLevel: number,
    levelName: string,
    emoji: string,
    leveledUp: boolean
  ): Promise<void> {
    const msg = leveledUp
      ? `${emoji} **Level Up!** You reached **${levelName}** (Level ${newLevel})! 🎉`
      : `📉 **Level Down** — You dropped to **${levelName}** (Level ${newLevel}).`;

    await this.sendDM(discordId, msg);
  }

  static async sendDecayWarning(discordId: string): Promise<void> {
    await this.sendDM(
      discordId,
      `⚠️ **Inactivity Warning** — Your rank will start decaying in 7 days if you don't play a match. Jump back in!`
    );
  }

  static async notifyAdminsDispute(
    matchId: string,
    aClaimA?: number,
    aClaimB?: number,
    bClaimA?: number,
    bClaimB?: number
  ): Promise<void> {
    if (!discordClient || !GUILD_CONFIG.logChannelId) return;

    try {
      const channel = discordClient.channels.cache.get(GUILD_CONFIG.logChannelId) as
        | import('discord.js').TextChannel
        | undefined;

      if (!channel) return;

      const shortId = matchId.slice(0, 8).toUpperCase();
      const scoreInfo =
        aClaimA !== undefined
          ? `\nCaptain A claimed: **${aClaimA}–${aClaimB}**\nCaptain B claimed: **${bClaimA}–${bClaimB}**`
          : '';

      await channel.send(
        `🚨 **Dispute Opened** | Match \`#${shortId}\`${scoreInfo}\nUse \`/admin resolve ${matchId}\` to review.`
      );
    } catch (error) {
      logger.warn('Failed to notify admins of dispute', { matchId, error });
    }
  }

  static async notifyAdminsSuspiciousAccount(
    playerId: string,
    flags: string[]
  ): Promise<void> {
    if (!discordClient || !GUILD_CONFIG.logChannelId) return;

    try {
      const channel = discordClient.channels.cache.get(GUILD_CONFIG.logChannelId) as
        | import('discord.js').TextChannel
        | undefined;

      if (!channel) return;

      await channel.send(
        `🔍 **Smurf Alert** | Player ID: \`${playerId}\`\nFlags: ${flags.map((f) => `\`${f}\``).join(', ')}\nUse \`/admin ban\` if confirmed.`
      );
    } catch (error) {
      logger.warn('Failed to notify admins of suspicious account', { playerId, error });
    }
  }

  static async sendToLogChannel(content: string): Promise<void> {
    if (!discordClient || !GUILD_CONFIG.logChannelId) return;
    try {
      const channel = discordClient.channels.cache.get(GUILD_CONFIG.logChannelId) as
        | import('discord.js').TextChannel
        | undefined;
      await channel?.send(content);
    } catch {
      // Silent fail for log channel errors
    }
  }
}
