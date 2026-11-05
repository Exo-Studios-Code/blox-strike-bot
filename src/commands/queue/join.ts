import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
} from 'discord.js';
import { QueueType } from '@prisma/client';
import { BloxStrikeClient } from '../../bot/client';
import { PlayerService } from '../../services/PlayerService';
import { SlashCommand } from '../../types/discord.types';
import { logger } from '../../utils/logger';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';

const QUEUE_TYPE_LABELS: Record<QueueType, { label: string; description: string }> = {
  [QueueType.SOLO]: {
    label: '1v1 Solo',
    description: 'Queue as a solo player. Matched 1v1.',
  },
  [QueueType.DUO]: {
    label: '2v2 Duo',
    description: 'Queue with a partner. Matched as a duo.',
  },
  [QueueType.FULL_TEAM]: {
    label: '5v5 Full Team',
    description: 'Queue with your full squad of 5.',
  },
};

const JOIN_METHOD_OPTIONS = [
  new StringSelectMenuOptionBuilder()
    .setValue('PRIVATE_SERVER_URL')
    .setLabel('Private Server URL')
    .setDescription('Share a direct Roblox private server link.')
    .setEmoji('🔗'),
  new StringSelectMenuOptionBuilder()
    .setValue('INVITE_CODE')
    .setLabel('Invite Code')
    .setDescription('Share a Roblox private server code.')
    .setEmoji('🎟️'),
  new StringSelectMenuOptionBuilder()
    .setValue('FRIEND_REQUEST')
    .setLabel('Friend Request')
    .setDescription('Players friend-request your Roblox account to join.')
    .setEmoji('👤'),
];

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Competitive queue management.')
    .addSubcommand((sub) =>
      sub
        .setName('join')
        .setDescription('Join the matchmaking queue.')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Queue mode to enter.')
            .setRequired(true)
            .addChoices(
              { name: '1v1 Solo', value: QueueType.SOLO },
              { name: '2v2 Duo', value: QueueType.DUO },
              { name: '5v5 Full Team', value: QueueType.FULL_TEAM }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('leave')
        .setDescription('Leave the current matchmaking queue.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Check your current queue status.')
    ) as SlashCommandBuilder,

  cooldown: 5,

  async execute(
    interaction: ChatInputCommandInteraction,
    _client: BloxStrikeClient
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'join') {
      await handleJoin(interaction);
    } else if (subcommand === 'leave') {
      await handleLeave(interaction);
    } else if (subcommand === 'status') {
      await handleStatus(interaction);
    }
  },
};

// ─── /queue join ─────────────────────────────────────────────────────────────

async function handleJoin(interaction: ChatInputCommandInteraction): Promise<void> {
  const queueType = interaction.options.getString('type', true) as QueueType;

  // Validate player is registered
  const player = await PlayerService.getByDiscordId(interaction.user.id);
  if (!player) {
    await interaction.reply({
      embeds: [new ErrorEmbed('You need to `/register` before joining the queue.').build()],
      ephemeral: true,
    });
    return;
  }

  if (!player.robloxUsername) {
    await interaction.reply({
      embeds: [new ErrorEmbed('You need to link your Roblox account via `/register` first.').build()],
      ephemeral: true,
    });
    return;
  }

  if (player.status === 'BANNED' || player.status === 'SUSPENDED') {
    await interaction.reply({
      embeds: [new ErrorEmbed('You are banned or suspended from competitive play.').build()],
      ephemeral: true,
    });
    return;
  }

  // Check already in queue
  const inQueue = await PlayerService.isInQueue(player.id);
  if (inQueue) {
    await interaction.reply({
      embeds: [new ErrorEmbed('You are already in a queue. Use `/queue leave` first.').build()],
      ephemeral: true,
    });
    return;
  }

  // Check in active match
  const inMatch = await PlayerService.isInActiveMatch(interaction.user.id);
  if (inMatch) {
    await interaction.reply({
      embeds: [new ErrorEmbed('You are currently in an active match.').build()],
      ephemeral: true,
    });
    return;
  }

  // Build join method select menu
  const typeLabel = QUEUE_TYPE_LABELS[queueType];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`queue:method:${queueType}`)
    .setPlaceholder('How will opponents join your game?')
    .addOptions(JOIN_METHOD_OPTIONS);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    content: `**${typeLabel.label}** — Select your preferred join method:`,
    components: [row],
    ephemeral: true,
  });

  logger.debug('Queue join method prompt shown', {
    userId: interaction.user.id,
    queueType,
  });
}

// ─── /queue leave ─────────────────────────────────────────────────────────────

async function handleLeave(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const { QueueService } = await import('../../services/QueueService');
  const success = await QueueService.leaveQueue(interaction.user.id);

  if (success) {
    await interaction.editReply({ content: '✅ You have left the queue.' });
  } else {
    await interaction.editReply({
      embeds: [new ErrorEmbed('You are not currently in a queue.').build()],
    });
  }
}

// ─── /queue status ────────────────────────────────────────────────────────────

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const { QueueService } = await import('../../services/QueueService');
  const session = await QueueService.getActiveSession(interaction.user.id);

  if (!session) {
    await interaction.editReply({
      embeds: [new ErrorEmbed('You are not currently in a queue.').build()],
    });
    return;
  }

  const waitSeconds = Math.floor((Date.now() - session.queuedAt.getTime()) / 1000);
  const mins = Math.floor(waitSeconds / 60);
  const secs = waitSeconds % 60;
  const waitStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  await interaction.editReply({
    content: [
      `⏳ **In Queue** — ${session.type.replace('_', ' ')}`,
      `Wait time: **${waitStr}**`,
      `MMR range: **${session.eloMin}–${session.eloMax}**`,
    ].join('\n'),
  });
}

export default command;
