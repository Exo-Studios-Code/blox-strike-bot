import { PrismaClient, Player, Prisma } from "@prisma/client";
import { EmbedBuilder, ColorResolvable } from "discord.js";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterResult {
  success: boolean;
  player?: Player;
  error?: "ALREADY_REGISTERED" | "USERNAME_TAKEN" | "DB_ERROR";
  message?: string;
}

export interface ProfileData {
  discordId: string;
  robloxUsername: string;
  elo: number;
  mmr: number;
  level: number;
  status: string;
  placementGamesLeft: number;
  wins: number;
  losses: number;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Official FACEIT Elo Brackets Function
// ─────────────────────────────────────────────────────────────────────────────

export function getFaceitLevel(elo: number): number {
  if (elo <= 800) return 1;
  if (elo <= 950) return 2;
  if (elo <= 1100) return 3; // Výchozí startovní bod (1000 Elo)
  if (elo <= 1250) return 4;
  if (elo <= 1400) return 5;
  if (elo <= 1550) return 6;
  if (elo <= 1700) return 7;
  if (elo <= 1850) return 8;
  if (elo <= 2000) return 9;
  return 10; // 2001+ Elo je Level 10
}

// ─────────────────────────────────────────────────────────────────────────────
// PlayerService
// ─────────────────────────────────────────────────────────────────────────────

export class PlayerService {
  /**
   * Register a new player. Enforces unique Discord ID and unique Roblox username (case-insensitive).
   */
  static async register(
    discordId: string,
    robloxUsername: string
  ): Promise<RegisterResult> {
    try {
      // 1. Check if Discord ID already registered
      const existingByDiscord = await prisma.player.findUnique({
        where: { discordId },
      });

      if (existingByDiscord) {
        return {
          success: false,
          error: "ALREADY_REGISTERED",
          message: `You are already registered as **${existingByDiscord.robloxUsername}**. You cannot register twice.`,
        };
      }

      // 2. Check if Roblox username already taken (case-insensitive)
      const existingByUsername = await prisma.player.findFirst({
        where: {
          robloxUsername: {
            equals: robloxUsername,
            mode: "insensitive",
          },
        },
      });

      if (existingByUsername) {
        return {
          success: false,
          error: "USERNAME_TAKEN",
          message: `The Roblox username **${robloxUsername}** is already linked to another Discord account.`,
        };
      }

      // 3. Create new player with default competitive stats (FACEIT Level 3)
      const player = await prisma.player.create({
        data: {
          discordId,
          robloxUsername,
          elo: 1000,
          mmr: 1000,
          level: 3,
          status: "PLACEMENT",
          placementGamesLeft: 10,
          wins: 0,
          losses: 0,
        },
      });

      return { success: true, player };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PlayerService.register] DB error: ${msg}`);
      return {
        success: false,
        error: "DB_ERROR",
        message: "A database error occurred. Please try again later.",
      };
    }
  }

  /**
   * Fetch a player by their Discord ID.
   */
  static async getByDiscordId(discordId: string): Promise<Player | null> {
    try {
      return await prisma.player.findUnique({ where: { discordId } });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PlayerService.getByDiscordId] DB error: ${msg}`);
      return null;
    }
  }

  /**
   * Fetch a player by their Roblox username (case-insensitive).
   */
  static async getByRobloxUsername(
    robloxUsername: string
  ): Promise<Player | null> {
    try {
      return await prisma.player.findFirst({
        where: {
          robloxUsername: { equals: robloxUsername, mode: "insensitive" },
        },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PlayerService.getByRobloxUsername] DB error: ${msg}`);
      return null;
    }
  }

  /**
   * Update player stats after a match result.
   */
  static async updateStats(
    discordId: string,
    data: Partial<
      Pick<
        Player,
        "elo" | "mmr" | "wins" | "losses" | "level" | "status" | "placementGamesLeft"
      >
    >
  ): Promise<boolean> {
    try {
      await prisma.player.update({ where: { discordId }, data });
      return true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PlayerService.updateStats] DB error: ${msg}`);
      return false;
    }
  }

  /**
   * Safe GuildMemberUpdate handler — silently skips if player doesn't exist.
   */
  static async safeGuildMemberUpdate(discordId: string): Promise<void> {
    try {
      await prisma.player.updateMany({
        where: { discordId },
        data: { updatedAt: new Date() },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[PlayerService.safeGuildMemberUpdate] DB error: ${msg}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACEIT ProfileEmbed Utility
// ─────────────────────────────────────────────────────────────────────────────

export function buildProfileEmbed(player: Player, discordTag: string): EmbedBuilder {
  const wins = player.wins ?? 0;
  const losses = player.losses ?? 0;
  const totalGames = wins + losses;
  const winRate =
    totalGames > 0 ? `${((wins / totalGames) * 100).toFixed(1)}%` : "N/A";

  // Vypočteme aktuální pravou FACEIT úroveň podle ELO v databázi
  const currentLevel = getFaceitLevel(player.elo);
  const rankColor = getFaceitColor(currentLevel);
  const rankLabel = getFaceitLabel(player.status, currentLevel);

  return new EmbedBuilder()
    .setColor(rankColor)
    .setTitle(`🎮  ${player.robloxUsername}`)
    .setDescription(`**Discord:** ${discordTag}\n**Roblox:** \`${player.robloxUsername}\``)
    .addFields(
      {
        name: "🏆  Matchmaking Rank",
        value: `**${rankLabel}**`,
        inline: true,
      },
      {
        name: "🎯  FACEIT Level",
        value: `**✨ Level ${currentLevel}**`,
        inline: true,
      },
      {
        name: "⚡  Current ELO",
        value: `\`${player.elo}\``,
        inline: true,
      },
      {
        name: "📊  MMR Rating",
        value: `\`${player.mmr}\``,
        inline: true,
      },
      {
        name: "✅  Wins",
        value: `\`${wins}\``,
        inline: true,
      },
      {
        name: "❌  Losses",
        value: `\`${losses}\``,
        inline: true,
      },
      {
        name: "📈  Win Rate",
        value: `\`${winRate}\``,
        inline: true,
      },
      {
        name: "🎮  Total Matches",
        value: `\`${totalGames}\``,
        inline: true,
      },
      ...(player.status === "PLACEMENT"
        ? [
            {
              name: "📋  Placement Games Left",
              value: `\`${player.placementGamesLeft ?? 10}\``,
              inline: true,
            },
          ]
        : [])
    )
    .setFooter({
      text: `Blox Strike Ranked Queue • Registered: ${player.createdAt.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
    })
    .setTimestamp();
}

// Pomocná funkce pro barvy embedů podle FACEIT levelů
function getFaceitColor(level: number): ColorResolvable {
  if (level === 10) return 0xff4655; // Ostře červená pro nejlepší lvl 10
  if (level >= 8) return 0xff8c00;  // Oranžová pro lvl 8-9
  if (level >= 4) return 0x2ecc71;  // Zelená pro mid-tier lvl 4-7
  return 0x95a5a6;                  // Šedá pro low-tier lvl 1-3
}

// Pomocná funkce pro popisky ranku na profilu
function getFaceitLabel(status: string, level: number): string {
  if (status === "PLACEMENT") return `🔰 Placement (Lv. ${level})`;
  if (level === 10) return "🔴 Level 10 [PRO]";
  if (level >= 8) return `🟠 Level ${level}`;
  if (level >= 4) return `🟢 Level ${level}`;
  return `⚪ Level ${level}`;
}