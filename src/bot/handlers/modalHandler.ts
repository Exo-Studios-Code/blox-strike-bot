import { ModalSubmitInteraction } from 'discord.js';
import { BloxStrikeClient } from '../client';
import { logger } from '../../utils/logger';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';
import { QueueService } from '../../services/QueueService';
import { MatchService } from '../../services/MatchService';
import { PlayerService } from '../../services/PlayerService';

export async function handleModal(
  interaction: ModalSubmitInteraction,
  _client: BloxStrikeClient
): Promise<void> {
  const [namespace, action, ...args] = interaction.customId.split(':');

  logger.debug('Modal submission', {
    customId: interaction.customId,
    userId: interaction.user.id,
  });

  try {
    switch (namespace) {
      case 'queue':
        await handleQueueModal(interaction, action, args);
        break;
      case 'match':
        await handleMatchModal(interaction, action, args);
        break;
      case 'register':
        await handleRegisterModal(interaction, action, args);
        break;
      default:
        await interaction.reply({
          embeds: [new ErrorEmbed('Unknown modal submission.').build()],
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error('Modal handler error', { error, customId: interaction.customId });
    const errorEmbed = new ErrorEmbed('An error occurred processing your submission.').build();
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  }
}

async function handleQueueModal(
  interaction: ModalSubmitInteraction,
  action: string,
  args: string[]
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const queueType = args[0] as 'SOLO' | 'DUO' | 'FULL_TEAM';
  const joinMethod = action.toUpperCase() as 'URL' | 'CODE' | 'FRIEND';

  const player = await PlayerService.getByDiscordId(interaction.user.id);
  if (!player) {
    await interaction.editReply({
      embeds: [new ErrorEmbed('You need to `/register` first.').build()],
    });
    return;
  }

  let joinInfo: Record<string, string> = {};

  switch (joinMethod) {
    case 'URL':
      joinInfo = {
        joinMethod: 'PRIVATE_SERVER_URL',
        privateServerUrl: interaction.fields.getTextInputValue('serverUrl'),
        joinInstructions: interaction.fields.getTextInputValue('instructions') || '',
        backupContact: interaction.fields.getTextInputValue('backup') || '',
      };
      break;
    case 'CODE':
      joinInfo = {
        joinMethod: 'INVITE_CODE',
        inviteCode: interaction.fields.getTextInputValue('serverCode'),
        privateServerUrl: interaction.fields.getTextInputValue('gameLink') || '',
        joinInstructions: interaction.fields.getTextInputValue('instructions') || '',
      };
      break;
    case 'FRIEND':
      joinInfo = {
        joinMethod: 'FRIEND_REQUEST',
        robloxUsername: interaction.fields.getTextInputValue('robloxUsername'),
        joinInstructions: interaction.fields.getTextInputValue('instructions') || '',
        backupContact: interaction.fields.getTextInputValue('backup') || '',
      };
      break;
  }

  const result = await QueueService.joinQueue(player.id, queueType, joinInfo);

  if (!result.success) {
    await interaction.editReply({
      embeds: [new ErrorEmbed(result.error ?? 'Failed to join queue.').build()],
    });
    return;
  }

  const { QueueEmbed } = await import('../../embeds/QueueEmbed');
  const embed = new QueueEmbed(result.session!, player);
  await interaction.editReply({
    embeds: [embed.build()],
    components: [embed.buildCancelRow()],
  });
}

async function handleMatchModal(
  interaction: ModalSubmitInteraction,
  action: string,
  args: string[]
): Promise<void> {
  if (action !== 'result') return;

  await interaction.deferReply({ ephemeral: true });

  const matchId = args[0];
  const scoreAStr = interaction.fields.getTextInputValue('scoreA');
  const scoreBStr = interaction.fields.getTextInputValue('scoreB');

  const scoreA = parseInt(scoreAStr, 10);
  const scoreB = parseInt(scoreBStr, 10);

  if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
    await interaction.editReply({
      embeds: [new ErrorEmbed('Invalid scores. Please enter non-negative integers.').build()],
    });
    return;
  }

  const result = await MatchService.submitResult(
    matchId,
    interaction.user.id,
    scoreA,
    scoreB
  );

  if (!result.success) {
    await interaction.editReply({
      embeds: [new ErrorEmbed(result.error ?? 'Failed to submit result.').build()],
    });
    return;
  }

  const { ResultEmbed } = await import('../../embeds/ResultEmbed');
  const embed = new ResultEmbed(result.status!, matchId, scoreA, scoreB);
  await interaction.editReply({ embeds: [embed.build()] });
}

async function handleRegisterModal(
  interaction: ModalSubmitInteraction,
  _action: string,
  _args: string[]
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const robloxUsername = interaction.fields.getTextInputValue('robloxUsername').trim();

  if (!robloxUsername || robloxUsername.length < 3 || robloxUsername.length > 20) {
    await interaction.editReply({
      embeds: [new ErrorEmbed('Roblox username must be 3-20 characters.').build()],
    });
    return;
  }

  const result = await PlayerService.linkRoblox(interaction.user.id, robloxUsername);

  if (!result.success) {
    await interaction.editReply({
      embeds: [new ErrorEmbed(result.error ?? 'Failed to link Roblox account.').build()],
    });
    return;
  }

  const { ProfileEmbed } = await import('../../embeds/ProfileEmbed');
  const player = await PlayerService.getByDiscordId(interaction.user.id);
  if (!player) return;

  const embed = new ProfileEmbed(player, interaction.user);
  await interaction.editReply({
    content: '✅ Roblox account linked successfully!',
    embeds: [embed.build()],
  });
}
