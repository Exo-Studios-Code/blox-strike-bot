import { EmbedBuilder } from 'discord.js';

export class ErrorEmbed {
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  public build(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('❌ Chyba systému')
      .setDescription(this.message)
      .setColor(0xEF4444) // Danger červená podle tvé specifikace
      .setTimestamp();
  }
}