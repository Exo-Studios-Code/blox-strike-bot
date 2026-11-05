import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { BloxStrikeClient } from '../bot/client';

export interface SlashCommand {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  cooldown?: number;
  adminOnly?: boolean;
  modOnly?: boolean;
  execute: (
    interaction: ChatInputCommandInteraction,
    client: BloxStrikeClient
  ) => Promise<void>;
}
