import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js';
import { BloxStrikeClient } from '../../bot/client';
import { PlayerService } from '../../services/PlayerService';
import { SlashCommand } from '../../types/discord.types';
import { logger } from '../../utils/logger';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';
import { COLORS } from '../../config/bot';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('Match result management.')
    .addSubcommand((sub) =>
      sub
        .setName('submit')
        .setDescription('Submit the result for your active match (captains only).')
        .addIntegerOption((opt) =>
          opt
            .setName('score-my-team')
            .setDescription('Final score for YOUR team.')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(999)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('score-enemy-team')
            .setDescription('Final score for the ENEMY team.')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(999)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('View details about your current or a specific match.')
        .addStringOption((opt) =>
          opt
            .setName('match-id')
            .setDescription('Match ID (leave blank for your current match).')
            .setRequired(false)
        )
    ) as SlashCommandBuilder,

  cooldown: 5,

  async execute(
    interaction: ChatInputCommandInteraction,
    _client: BloxStrikeClient
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'submit') {
      await handleSubmit(interaction);
    } else if (subcommand === 'info') {
      await handleInfo(interaction);
    }
  },
};

// ─── /match submit ────────────────────────────────────────────────────────────

async function handleSubmit(interaction: ChatInputCommandInteraction): Promise<void> {
  const scoreMyTeam = interaction.options.getInteger('score-my-team', true);
  const scoreEnemyTeam = interaction.options.getInteger('score-enemy-team', true);

  await interaction.deferReply({ ephemeral: true });

  // Resolve player
  const player = await PlayerService.getByDiscordId(interaction.user.id);
  if (!player) {
    await interaction.editReply({
      embeds: [new ErrorEmbed('You are not registered. Use `/register` first.').build()],
    });
    return;
  }

  // Find the player's active match
  const { prisma } = await import('../../config/database');
  const activeMatch = await prisma.match.findFirst({
    where: {
      status: { in: ['ACTIVE', 'AWAITING_RESULTS'] },
      OR: [
        { teamAPlayerIds: { has: interaction.user.id } },
        { teamBPlayerIds: { has: interaction.user.id } },
      ],
    },
    include: {
      captainA: true,
      captainB: true,
    },
  });

  if (!activeMatch) {
    await interaction.editReply({
      embeds: [new ErrorEmbed('You are not currently in an active match.').build()],
    });
    return;
  }

  // Verify caller is a captain
  const isCaptainA = activeMatch.captainA?.discordId === interaction.user.id;
  const isCaptainB = activeMatch.captainB?.discordId === interaction.user.id;

  if (!isCaptainA && !isCaptainB) {
    await interaction.editReply({
      embeds: [
        new ErrorEmbed(
          'Only the **team captain** can submit match results.\n' +
          `Captain A: <@${activeMatch.captainA?.discordId}>\n` +
          `Captain B: <@${activeMatch.captainB?.discordId}>`
        ).build(),
      ],
    });
    return;
  }

  // Check if this captain already submitted
  const alreadySubmittedA = isCaptainA && activeMatch.submittedByA;
  const alreadySubmittedB = isCaptainB && activeMatch.submittedByB;

  if (alreadySubmittedA || alreadySubmittedB) {
    await interaction.editReply({
      embeds: [
        new ErrorEmbed(
          'You have already submitted a result for this match. Waiting for the other captain.'
        ).build(),
      ],
    });
    return;
  }

  // Delegate to MatchEngine for result processing
  const { MatchEngine } = await import('../../engines/match/MatchEngine');
  const engine = new MatchEngine(interaction.guild!);

  const outcome = await engine.processResult(
    activeMatch.id,
    interaction.user.id,
    scoreMyTeam,
    scoreEnemyTeam
  );

  logger.info('Match result submitted', {
    matchId: activeMatch.id,
    submitter: interaction.user.id,
    scoreMyTeam,
    scoreEnemyTeam,
    outcome,
  });

  switch (outcome) {
    case 'WAITING': {
      const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('⏳ Result Submitted — Waiting for Other Captain')
        .setDescription(
          `Your score has been recorded: **${scoreMyTeam}** — **${scoreEnemyTeam}**\n\n` +
          'The other team captain must also submit before the match is resolved.'
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case 'CONFIRMED': {
      const winner =
        scoreMyTeam > scoreEnemyTeam
          ? (isCaptainA ? 'A' : 'B')
          : scoreMyTeam < scoreEnemyTeam
          ? (isCaptainA ? 'B' : 'A')
          : null;

      const winnerText =
        winner === null
          ? '🤝 **Draw!**'
          : winner === 'A'
          ? '🔵 **Team A Wins!**'
          : '🔴 **Team B Wins!**';

      const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle('✅ Match Result Confirmed')
        .setDescription(
          `${winnerText}\n\n` +
          `Both captains agree on the score. Elo has been updated.`
        )
        .addFields({
          name: 'Final Score',
          value: isCaptainA
            ? `Team A **${scoreMyTeam}** — **${scoreEnemyTeam}** Team B`
            : `Team A **${scoreEnemyTeam}** — **${scoreMyTeam}** Team B`,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case 'DISPUTED': {
      const embed = new EmbedBuilder()
        .setColor(COLORS.DANGER)
        .setTitle('⚠️ Score Dispute Opened')
        .setDescription(
          'The two captains submitted different scores. ' +
          'A dispute has been opened and admins have been notified.\n\n' +
          'Please do not delete match evidence.'
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case 'UNAUTHORIZED': {
      await interaction.editReply({
        embeds: [new ErrorEmbed('You are not authorized to submit results for this match.').build()],
      });
      break;
    }

    default: {
      await interaction.editReply({
        embeds: [new ErrorEmbed('An unexpected error occurred processing the result.').build()],
      });
    }
  }
}

// ─── /match info ──────────────────────────────────────────────────────────────

async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const specifiedId = interaction.options.getString('match-id');

  const { prisma } = await import('../../config/database');

  let matchId: string | null = specifiedId;

  // No ID provided — look up caller's active match
  if (!matchId) {
    const active = await prisma.match.findFirst({
      where: {
        status: { in: ['ACTIVE', 'AWAITING_RESULTS'] },
        OR: [
          { teamAPlayerIds: { has: interaction.user.id } },
          { teamBPlayerIds: { has: interaction.user.id } },
        ],
      },
    });

    if (!active) {
      await interaction.editReply({
        embeds: [new ErrorEmbed('You have no active match. Provide a match ID to look up a past match.').build()],
      });
      return;
    }

    matchId = active.id;
  }

  const { MatchService } = await import('../../services/MatchService');
  const info = await MatchService.getMatchInfo(matchId);

  if (!info) {
    await interaction.editReply({
      embeds: [new ErrorEmbed(`Match \`${matchId}\` not found.`).build()],
    });
    return;
  }

  const { MatchEmbed } = await import('../../embeds/MatchEmbed');
  const embed = new MatchEmbed(info.match, info.teamA, info.teamB, {});

  await interaction.editReply({ embeds: [embed.build()] });

  logger.debug('Match info viewed', {
    userId: interaction.user.id,
    matchId,
  });
}

export default command;
