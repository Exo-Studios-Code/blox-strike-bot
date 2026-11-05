import { EmbedBuilder, User } from 'discord.js';
import { Player } from '@prisma/client';

export class ProfileEmbed {
  private player: Player;
  private discordUser: User;

  constructor(player: Player, discordUser: User) {
    this.player = player;
    this.discordUser = discordUser;
  }

  public build(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`👤 PLAYER PROFILE — ${this.player.robloxUsername}`)
      .setThumbnail(this.discordUser.displayAvatarURL())
      .setColor(0x3B82F6) // Clean blue profile theme
      .addFields(
        { name: '🎮 Roblox Account', value: `\`${this.player.robloxUsername}\``, inline: true },
        { name: '💬 Discord', value: `<@${this.player.discordId}>`, inline: true },
        { name: '\u200B', value: '\u200B', inline: false }, // Empty spacer row
        { name: '🏆 ELO Rating', value: `\`${this.player.elo}\` ELO`, inline: true },
        { name: '📊 Level / Rank', value: `Level ${this.player.level}`, inline: true },
        { name: '📋 Player Status', value: `\`${this.player.status}\``, inline: true }
      )
      .setFooter({ text: 'Blox Strike Competitive System' })
      .setTimestamp();
  }
}