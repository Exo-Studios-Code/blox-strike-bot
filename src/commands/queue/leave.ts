/**
 * src/commands/queue/leave.ts
 *
 * Standalone `/queue leave` command file.
 *
 * NOTE: The queue subcommand group is fully defined in join.ts
 * (which registers `queue join`, `queue leave`, and `queue status`
 * under a single SlashCommandBuilder so Discord receives one
 * `queue` command with three subcommands).
 *
 * This file is kept as the canonical home of the leave-specific
 * business logic and re-exports the shared command definition so
 * the command loader doesn't register a duplicate.  Only one of
 * join.ts / leave.ts should be loaded by the command loader —
 * by convention, the loader picks up join.ts (alphabetically first)
 * and skips this file, or you can adjust the loader to deduplicate
 * by command name.
 *
 * If your project structure requires each subcommand in its own
 * file with its own SlashCommandBuilder, replace the export below
 * with the standalone version.
 */

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { BloxStrikeClient } from '../../bot/client';
import { QueueService } from '../../services/QueueService';
import { SlashCommand } from '../../types/discord.types';
import { ErrorEmbed } from '../../embeds/ErrorEmbed';
import { logger } from '../../utils/logger';

/**
 * Standalone version — registers `/queue leave` as an independent
 * top-level command alias so it works even without the subcommand
 * group approach.  Deploy whichever variant fits your setup.
 */
const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('queue-leave')
    .setDescription('Leave the matchmaking queue you are currently in.'),

  cooldown: 3,

  async execute(
    interaction: ChatInputCommandInteraction,
    _client: BloxStrikeClient
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const success = await QueueService.leaveQueue(interaction.user.id);

    if (success) {
      await interaction.editReply({ content: '✅ You have left the queue.' });
      logger.info('Player left queue via command', { userId: interaction.user.id });
    } else {
      await interaction.editReply({
        embeds: [
          new ErrorEmbed('You are not currently in a queue.').build(),
        ],
      });
    }
  },
};

export default command;
