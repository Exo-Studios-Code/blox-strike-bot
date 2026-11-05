import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  APIEmbedField,
} from 'discord.js';
import { Match, Player } from '@prisma/client';
import { COLORS } from '../config/bot';
import { getLevelFromElo } from '../utils/constants';
import { formatEloChange, formatMatchId } from '../utils/formatters';
import { JoinInfo } from '../types/queue.types';

export class MatchEmbed {
  constructor(
    private match: Match,
    private teamA: Player[],
    private teamB: Player[],
    private joinInfo: JoinInfo
  ) {}

  build(): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle(`⚔️ MATCH ${formatMatchId(this.match.id)}`)
      .setDescription(
        '**Match has been found! Both captains must submit the result after playing.**'
      )
      .addFields(
        this.buildTeamField('🔵 Team A', this.teamA),
        this.buildTeamField('🔴 Team B', this.teamB),
        this.buildJoinInfoField(),
        {
          name: '📋 How to Submit',
          value:
            'After the match, both captains use `/match submit` with the final scores.\nIf scores disagree, a dispute will be opened.',
          inline: false,
        }
      )
      .setFooter({
        text: `Auto-resolves in 2h if no result submitted • Match ID: ${formatMatchId(this.match.id)}`,
      })
      .setTimestamp(this.match.matchFoundAt);

    return embed;
  }

  private buildTeamField(name: string, players: Player[]): APIEmbedField {
    const lines = players.map((p) => {
      const bracket = getLevelFromElo(p.elo);
      const captain =
        (name.includes('A') && p.id === this.match.captainAId) ||
        (name.includes('B') && p.id === this.match.captainBId)
          ? ' 👑'
          : '';
      return `${bracket.emoji} <@${p.discordId}> — **${p.elo}** ELO${captain}`;
    });

    const avgElo = Math.round(
      players.reduce((s, p) => s + p.elo, 0) / players.length
    );

    lines.push(`\`Avg ELO: ${avgElo}\``);

    return { name, value: lines.join('\n'), inline: true };
  }

  private buildJoinInfoField(): APIEmbedField {
    const lines: string[] = [];

    switch (this.match.joinMethod ?? this.joinInfo.joinMethod) {
      case 'PRIVATE_SERVER_URL':
        lines.push('🔗 **Private Server Link:**');
        lines.push(this.match.privateServerUrl ?? this.joinInfo.privateServerUrl ?? 'N/A');
        break;
      case 'INVITE_CODE':
        lines.push(`🎟️ **Server Code:** \`${this.match.inviteCode ?? this.joinInfo.inviteCode}\``);
        if (this.match.privateServerUrl ?? this.joinInfo.privateServerUrl) {
          lines.push(`🎮 **Game Link:** ${this.match.privateServerUrl ?? this.joinInfo.privateServerUrl}`);
        }
        break;
      case 'FRIEND_REQUEST':
        lines.push(`👤 **Add on Roblox:** \`${this.match.robloxUsername ?? this.joinInfo.robloxUsername}\``);
        lines.push('Send a friend request then join their game.');
        break;
      default:
        lines.push('*No join info provided.*');
    }

    const instructions =
      this.match.joinInstructions ?? this.joinInfo.joinInstructions;
    if (instructions) {
      lines.push('');
      lines.push(`📝 **Instructions:** ${instructions}`);
    }

    const backup = this.match.backupContact ?? this.joinInfo.backupContact;
    if (backup) {
      lines.push(`🆘 **Backup Contact:** ${backup}`);
    }

    return {
      name: '🎮 Server Information',
      value: lines.join('\n') || '*No join info available.*',
      inline: false,
    };
  }

  buildActionRow(matchId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`match:submit:${matchId}`)
        .setLabel('Submit Result')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📊'),
      new ButtonBuilder()
        .setCustomId(`match:info:${matchId}`)
        .setLabel('Match Info')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('ℹ️')
    );
  }
}
