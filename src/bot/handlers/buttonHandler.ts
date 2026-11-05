import { ButtonInteraction } from 'discord.js';
import { BloxStrikeClient } from '../client';
import { logger } from '../../utils/logger';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';
import { QueueService } from '../../services/QueueService';
import { MatchService } from '../../services/MatchService';

export async function handleButton(
  interaction: ButtonInteraction,
  _client: BloxStrikeClient
): Promise<void> {
  const [namespace, action, ...args] = interaction.customId.split(':');

  logger.debug('Button interaction', {
    customId: interaction.customId,
    namespace,
    action,
    userId: interaction.user.id,
  });

  try {
    switch (namespace) {
      case 'queue':
        await handleQueueButton(interaction, action, args);
        break;
      case 'match':
        await handleMatchButton(interaction, action, args);
        break;
      default:
        await interaction.reply({
          embeds: [new ErrorEmbed('Unknown button action.').build()],
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error('Button handler error', { error, customId: interaction.customId });
    const errorEmbed = new ErrorEmbed('An error occurred processing this action.').build();
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
}

async function handleQueueButton(
  interaction: ButtonInteraction,
  action: string,
  args: string[]
): Promise<void> {
  switch (action) {
    case 'leave': {
      const sessionId = args[0];
      await interaction.deferReply({ ephemeral: true });
      const success = await QueueService.leaveQueue(interaction.user.id, sessionId);
      if (success) {
        await interaction.editReply({ content: '✅ You have left the queue.' });
      } else {
        await interaction.editReply({
          embeds: [new ErrorEmbed('Could not find your queue session.').build()],
        });
      }
      break;
    }
    default:
      await interaction.reply({
        embeds: [new ErrorEmbed('Unknown queue action.').build()],
        ephemeral: true,
      });
  }
}

async function handleMatchButton(
  interaction: ButtonInteraction,
  action: string,
  args: string[]
): Promise<void> {
  const matchId = args[0];
  if (!matchId) {
    await interaction.reply({
      embeds: [new ErrorEmbed('Invalid match button.').build()],
      ephemeral: true,
    });
    return;
  }

  switch (action) {
    case 'submit': {
      // Open result submission modal
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } =
        await import('discord.js');

      const modal = new ModalBuilder()
        .setCustomId(`match:result:${matchId}`)
        .setTitle('Submit Match Result');

      const scoreAInput = new TextInputBuilder()
        .setCustomId('scoreA')
        .setLabel('Your Team Score')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. 13')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(3);

      const scoreBInput = new TextInputBuilder()
        .setCustomId('scoreB')
        .setLabel('Enemy Team Score')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. 7')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(3);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(scoreAInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(scoreBInput)
      );

      await interaction.showModal(modal);
      break;
    }
    case 'info': {
      await interaction.deferReply({ ephemeral: true });
      const info = await MatchService.getMatchInfo(matchId);
      if (!info) {
        await interaction.editReply({
          embeds: [new ErrorEmbed('Match not found.').build()],
        });
        return;
      }
      const { MatchEmbed } = await import('../../embeds/MatchEmbed');
      const embed = new MatchEmbed(info.match, info.teamA, info.teamB, {});
      await interaction.editReply({ embeds: [embed.build()] });
      break;
    }
    default:
      await interaction.reply({
        embeds: [new ErrorEmbed('Unknown match action.').build()],
        ephemeral: true,
      });
  }
}
