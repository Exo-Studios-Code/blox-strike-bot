import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
} from 'discord.js';
import { SlashCommand } from '../types/discord.types';

export class BloxStrikeClient extends Client {
  public commands: Collection<string, SlashCommand> = new Collection();
  public cooldowns: Collection<string, Collection<string, number>> = new Collection();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
  }
}
