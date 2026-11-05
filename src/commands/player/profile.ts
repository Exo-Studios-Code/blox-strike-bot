import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  GuildMember,
} from 'discord.js';
import { BloxStrikeClient } from '../../bot/client';
import { PlayerService } from '../../services/PlayerService';
import { SlashCommand } from '../../types/discord.types';
import { logger } from '../../utils/logger';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your competitive profile or another player\'s.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The Discord user whose profile you want to view.')
        .setRequired(false)
    ) as SlashCommandBuilder,

  cooldown: 5,

  async execute(
    interaction: ChatInputCommandInteraction,
    _client: BloxStrikeClient
  ): Promise<void> {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const isSelf = targetUser.id === interaction.user.id;

    const player = await PlayerService.getWithStats(targetUser.id);

    if (!player) {
      const msg = isSelf
        ? 'You are not registered yet. Use `/register` to create your profile.'
        : `<@${targetUser.id}> hasn't registered yet.`;

      await interaction.editReply({
        embeds: [new ErrorEmbed(msg).build()],
      });
      return;
    }

    const rank = player.isPlaced ? await PlayerService.getRank(player.id) : null;

    // Resolve guild member for avatar (may fail in DMs)
    let member: GuildMember | null = null;
    if (interaction.guild) {
      member = await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null);
    }

    const { ProfileEmbed } = await import('../../embeds/ProfileEmbed');
    const embed = new ProfileEmbed(player, targetUser, rank ?? undefined);

    await interaction.editReply({ embeds: [embed.build()] });

    logger.debug('Profile viewed', {
      requesterId: interaction.user.id,
      targetId: targetUser.id,
    });
  },
};

export default command;
