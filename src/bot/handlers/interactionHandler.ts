import {
  Interaction,
  ChatInputCommandInteraction,
  Collection,
} from 'discord.js';
import { BloxStrikeClient } from '../client';
import { logger } from '../../utils/logger';
import { handleButton } from './buttonHandler';
import { handleModal } from './modalHandler';
import { handleSelectMenu } from './selectMenuHandler';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';
import { ModerationService } from '../../services/ModerationService';

export async function handleInteraction(
  interaction: Interaction,
  client: BloxStrikeClient
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, client);
    } else if (interaction.isButton()) {
      await handleButton(interaction, client);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction, client);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction, client);
    }
  } catch (error) {
    logger.error('Interaction handler error', {
      error,
      interactionId: interaction.id,
      type: interaction.type,
    });

    const errorEmbed = new ErrorEmbed('An internal error occurred. Please try again.').build();

    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({ embeds: [errorEmbed], ephemeral: true })
          .catch(() => null);
      } else {
        await interaction
          .reply({ embeds: [errorEmbed], ephemeral: true })
          .catch(() => null);
      }
    }
  }
}

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  client: BloxStrikeClient
): Promise<void> {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Check ban for non-admin commands
  if (!command.adminOnly) {
    const ban = await ModerationService.getActiveBan(interaction.user.id);
    if (ban) {
      const msg = ban.isPermanent
        ? `You are permanently banned. Reason: **${ban.reason}**`
        : `You are suspended until <t:${Math.floor((ban.expiresAt?.getTime() ?? 0) / 1000)}:F>. Reason: **${ban.reason}**`;

      await interaction.reply({
        embeds: [new ErrorEmbed(msg).build()],
        ephemeral: true,
      });
      return;
    }
  }

  // Admin-only guard
  if (command.adminOnly && interaction.guild) {
    const member = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    const { isAdmin } = await import('../../utils/permissions');
    if (!member || !isAdmin(member)) {
      await interaction.reply({
        embeds: [new ErrorEmbed('This command requires Administrator permissions.').build()],
        ephemeral: true,
      });
      return;
    }
  }

  // Cooldown enforcement
  if (!client.cooldowns.has(command.data.name)) {
    client.cooldowns.set(command.data.name, new Collection());
  }
  const now = Date.now();
  const timestamps = client.cooldowns.get(command.data.name)!;
  const cooldownAmount = (command.cooldown ?? 3) * 1000;

  if (timestamps.has(interaction.user.id)) {
    const expirationTime = timestamps.get(interaction.user.id)! + cooldownAmount;
    if (now < expirationTime) {
      const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
      await interaction.reply({
        content: `⏳ Please wait **${timeLeft}s** before using \`/${command.data.name}\` again.`,
        ephemeral: true,
      });
      return;
    }
  }

  timestamps.set(interaction.user.id, now);
  setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

  await command.execute(interaction, client);
}
