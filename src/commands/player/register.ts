import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { BloxStrikeClient } from '../../bot/client';
import { PlayerService } from '../../services/PlayerService';
import { SlashCommand } from '../../types/discord.types';
import { logger } from '../../utils/logger';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register your account and link your Roblox username to compete.'),

  cooldown: 10,

  async execute(
    interaction: ChatInputCommandInteraction,
    _client: BloxStrikeClient
  ): Promise<void> {
    // Check if already registered — give fast feedback before showing modal
    const existing = await PlayerService.getByDiscordId(interaction.user.id);

    if (existing?.robloxUsername) {
      await interaction.reply({
        embeds: [
          new ErrorEmbed(
            `You are already registered as **${existing.robloxUsername}**.\nUse \`/profile\` to view your stats.`
          ).build(),
        ],
        ephemeral: true,
      });
      return;
    }

    // If player exists but hasn't linked Roblox yet, show modal to link
    // If player doesn't exist at all, the modal handler creates them on submit
    const modal = new ModalBuilder()
      .setCustomId('register:link')
      .setTitle('Link Your Roblox Account');

    const usernameInput = new TextInputBuilder()
      .setCustomId('robloxUsername')
      .setLabel('Roblox Username')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Your exact Roblox username (case-sensitive)')
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(20);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput)
    );

    await interaction.showModal(modal);

    logger.debug('Register modal shown', { userId: interaction.user.id });
  },
};

export default command;
