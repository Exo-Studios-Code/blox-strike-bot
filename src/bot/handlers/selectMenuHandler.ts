import {
  StringSelectMenuInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { BloxStrikeClient } from '../client';
import { logger } from '../../utils/logger';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';

export async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
  _client: BloxStrikeClient
): Promise<void> {
  const [namespace, action, ...args] = interaction.customId.split(':');

  logger.debug('Select menu interaction', {
    customId: interaction.customId,
    selected: interaction.values,
    userId: interaction.user.id,
  });

  try {
    switch (namespace) {
      case 'queue':
        await handleQueueSelectMenu(interaction, action, args);
        break;
      default:
        await interaction.reply({
          embeds: [new ErrorEmbed('Unknown select menu action.').build()],
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error('Select menu handler error', { error, customId: interaction.customId });
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [new ErrorEmbed('An error occurred.').build()],
        ephemeral: true,
      });
    }
  }
}

async function handleQueueSelectMenu(
  interaction: StringSelectMenuInteraction,
  action: string,
  args: string[]
): Promise<void> {
  if (action !== 'method') return;

  const queueType = args[0] as 'SOLO' | 'DUO' | 'FULL_TEAM';
  const selectedMethod = interaction.values[0];

  // Show appropriate modal based on join method
  const modal = buildJoinModal(selectedMethod, queueType);
  await interaction.showModal(modal);
}

function buildJoinModal(method: string, queueType: string): ModalBuilder {
  switch (method) {
    case 'PRIVATE_SERVER_URL': {
      const modal = new ModalBuilder()
        .setCustomId(`queue:url:${queueType}`)
        .setTitle('Private Server Details');

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('serverUrl')
            .setLabel('Private Server URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://www.roblox.com/games/...')
            .setRequired(true)
            .setMaxLength(500)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('instructions')
            .setLabel('Join Instructions (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Click the link and join the server...')
            .setRequired(false)
            .setMaxLength(500)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('backup')
            .setLabel('Backup Contact (optional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('@username or Discord tag')
            .setRequired(false)
            .setMaxLength(100)
        )
      );
      return modal;
    }

    case 'INVITE_CODE': {
      const modal = new ModalBuilder()
        .setCustomId(`queue:code:${queueType}`)
        .setTitle('Invite Code Details');

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('serverCode')
            .setLabel('Private Server Code')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter the server code')
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('gameLink')
            .setLabel('Game Link (optional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://www.roblox.com/games/...')
            .setRequired(false)
            .setMaxLength(500)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('instructions')
            .setLabel('Join Instructions (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Steps to join using the code...')
            .setRequired(false)
            .setMaxLength(500)
        )
      );
      return modal;
    }

    case 'FRIEND_REQUEST':
    default: {
      const modal = new ModalBuilder()
        .setCustomId(`queue:friend:${queueType}`)
        .setTitle('Roblox Friend Request');

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('robloxUsername')
            .setLabel('Your Roblox Username')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Your exact Roblox username')
            .setRequired(true)
            .setMaxLength(20)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('instructions')
            .setLabel('Join Instructions (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Send friend request to X, then join game...')
            .setRequired(false)
            .setMaxLength(500)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('backup')
            .setLabel('Backup Contact (optional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('@discordtag')
            .setRequired(false)
            .setMaxLength(100)
        )
      );
      return modal;
    }
  }
}
