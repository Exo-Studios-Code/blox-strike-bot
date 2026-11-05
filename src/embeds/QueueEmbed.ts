import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { QueueSession, Player } from '@prisma/client';
import { COLORS } from '../config/bot';
import { getLevelFromElo } from '../utils/constants';

const QUEUE_TYPE_DISPLAY: Record<string, string> = {
  SOLO: '1v1 Solo',
  DUO: '2v2 Duo',
  FULL_TEAM: '5v5 Full Team',
};

const JOIN_METHOD_DISPLAY: Record<string, string> = {
  PRIVATE_SERVER_URL: '🔗 Private Server URL',
  INVITE_CODE: '🎟️ Invite Code',
  FRIEND_REQUEST: '👤 Friend Request',
  GAME_LINK: '🎮 Game Link',
};

export class QueueEmbed {
  constructor(
    private session: QueueSession,
    private player: Player
  ) {}

  build(): EmbedBuilder {
    const bracket = getLevelFromElo(this.player.mmr);
    const expiresUnix = Math.floor(this.session.expiresAt.getTime() / 1000);
    const joinMethodDisplay =
      JOIN_METHOD_DISPLAY[this.session.joinMethod ?? ''] ?? 'Unknown';

    return new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('🔍 Searching for Match…')
      .setDescription(
        `You are in the **${QUEUE_TYPE_DISPLAY[this.session.type]}** queue.\nA match will be found when compatible opponents are available.`
      )
      .addFields(
        {
          name: '📊 Your MMR',
          value: `${bracket.emoji} **${this.player.mmr}** (${bracket.name})`,
          inline: true,
        },
        {
          name: '🎯 ELO Search Range',
          value: `${this.session.eloMin} — ${this.session.eloMax}`,
          inline: true,
        },
        {
          name: '🎮 Join Method',
          value: joinMethodDisplay,
          inline: true,
        },
        {
          name: '⏰ Queue Expires',
          value: `<t:${expiresUnix}:R>`,
          inline: true,
        }
      )
      .setFooter({
        text: `Session ID: ${this.session.id.slice(0, 8).toUpperCase()} • Use /queue status to check`,
      })
      .setTimestamp();
  }

  buildCancelRow(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:leave:${this.session.id}`)
        .setLabel('Leave Queue')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('✖️')
    );
  }
}
