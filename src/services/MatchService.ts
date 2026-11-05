// src/services/MatchService.ts
import { 
  Client, 
  ChannelType, 
  PermissionsBitField, 
  EmbedBuilder, 
  TextChannel 
} from 'discord.js';
import Redis from 'ioredis';
import prisma from '../database/client';
import { QueueService } from './QueueService';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const QUEUE_KEY = 'matchmaking:queue:players';

// Pomocná funkce z tvého Pythonu (přepsaná do TS) pro určení Levelu a barvy
function getFaceitLevelInfo(elo: number) {
  if (elo <= 1100) return { level: 3, emoji: "⚪", color: 0x808080 };
  if (elo <= 1400) return { level: 5, emoji: "🟩", color: 0x57f287 };
  if (elo <= 1850) return { level: 8, emoji: "🟧", color: 0xff9900 };
  return { level: 10, emoji: "🟥", color: 0xed4245 };
}

export class MatchService {
  
  // Tohle je ten tvůj matchmaking_loop z Pythonu (Fáze 3)
  static async checkAndCreateMatch(client: Client) {
    // 1. Zkontrolujeme, jestli je ve frontě 10 lidí
    const queuedIds = await redis.smembers(QUEUE_KEY);
    if (queuedIds.length < 10) return; // Ještě jich není 10, čekáme dál

    console.log('🔥 Fronta naplněna! Generuji zápas...');

    // 2. Vezmeme prvních 10 lidí a okamžitě je zamkneme (vymažeme z fronty)
    const matchPlayersIds = queuedIds.slice(0, 10);
    await redis.srem(QUEUE_KEY, ...matchPlayersIds);
    
    // Update panelu pro ostatní (spadne to z 10/10 na 0/10)
    await QueueService.updateDashboard(client);

    // 3. Načtení dat hráčů z databáze
    const players = await prisma.player.findMany({
      where: { discordId: { in: matchPlayersIds } }
    });

    if (players.length !== 10) {
      console.error('Chyba: Některé hráče z fronty se nepodařilo najít v DB.');
      return;
    }

    // 4. SNAKE DRAFT BALANCER (Nahrazuje ten starý systém z Pythonu)
    // Seřadíme hráče od nejlepšího po nejhoršího podle ELO
    const sortedPlayers = players.sort((a, b) => b.elo - a.elo);
    const teamA = [];
    const teamB = [];
    const snakePattern = ["A", "B", "B", "A", "A", "B", "B", "A", "A", "B"];
    
    for (let i = 0; i < sortedPlayers.length; i++) {
      if (snakePattern[i] === "A") teamA.push(sortedPlayers[i]);
      else teamB.push(sortedPlayers[i]);
    }

    // Zápis zápasu do databáze
    const matchRecord = await prisma.match.create({
      data: {
        status: "ONGOING",
        teamAIds: teamA.map(p => p.discordId),
        teamBIds: teamB.map(p => p.discordId),
      }
    });

    // 5. GENEROVÁNÍ DISCORD KANÁLŮ (Ukradeno a přepsáno z Python 'TeamManagement' cog)
    const guild = client.guilds.cache.first();
    if (!guild) return;

    // Vytvoříme speciální práva - do kategorie uvidí jen těchto 10 lidí a Admini
    const permissionOverwrites = [
      {
        id: guild.id, // @everyone role (zakázán přístup)
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      ...matchPlayersIds.map(id => ({
        id: id,       // Povolení pro 10 hráčů ze zápasu
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.Connect],
      }))
    ];

    try {
      // Vytvoření kategorie zápasu
      const matchCategory = await guild.channels.create({
        name: `🏆 Match #${matchRecord.id}`,
        type: ChannelType.GuildCategory,
        permissionOverwrites: permissionOverwrites
      });

      // Vytvoření textového kanálu pro zápas
      const textChannel = await guild.channels.create({
        name: `💬-match-chat`,
        type: ChannelType.GuildText,
        parent: matchCategory.id
      }) as TextChannel;

      // Vytvoření Voice Roomky pro Team A
      await guild.channels.create({
        name: `🔊 Team A`,
        type: ChannelType.GuildVoice,
        parent: matchCategory.id
      });

      // Vytvoření Voice Roomky pro Team B
      await guild.channels.create({
        name: `🔊 Team B`,
        type: ChannelType.GuildVoice,
        parent: matchCategory.id
      });

      // 6. VYTVOŘENÍ FACEIT OZNÁMENÍ V TEXT KANÁLU
      const formatRoster = (team: any[]) => {
        return team.map((p, i) => {
          const info = getFaceitLevelInfo(p.elo);
          return `\`${i+1}.\` ${info.emoji} <@${p.discordId}> (Lvl ${info.level} | \`${p.elo} ELO\`)`;
        }).join('\n');
      };

      const embed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle(`🎮 MATCH #${matchRecord.id} IS READY!`)
        .setDescription(`Vítejte v zápase! Připojte se do svých Voice kanálů a domluvte se na Roblox serveru.`)
        .addFields(
          { name: '🔵 Team A', value: formatRoster(teamA), inline: true },
          { name: '🔴 Team B', value: formatRoster(teamB), inline: true },
          { name: '📋 Reportování výsledků', value: `Po hře napište příkaz \`/match report ${matchRecord.id} win/loss\`. Obě strany musí výsledek potvrdit.`, inline: false }
        )
        .setTimestamp();

      // Oznámení do kanálu a ping všech hráčů, aby si toho všimli
      const pings = matchPlayersIds.map(id => `<@${id}>`).join(' ');
      await textChannel.send({ content: pings, embeds: [embed] });

    } catch (err: any) {
      console.error('Nepodařilo se vytvořit kanály zápasu. Chybí práva?', err.message);
    }
  }
}