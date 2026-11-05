import {
  Client,
  Guild,
  CategoryChannel,
  TextChannel,
  VoiceChannel,
  PermissionFlagsBits,
  EmbedBuilder,
  OverwriteResolvable,
  ChannelType,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { PrismaClient } from "@prisma/client";
import { TeamBalancer, BalancedTeams, TeamPlayer } from "./TeamBalancer";
import { QueueService } from "../../services/QueueService";

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchCreationResult {
  success: boolean;
  matchId?: string;
  error?: string;
}

export interface MatchChannels {
  categoryId: string;
  textChannelId: string;
  voiceTeamAId: string;
  voiceTeamBId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed Builders
// ─────────────────────────────────────────────────────────────────────────────

function buildMatchEmbed(
  matchId: string,
  teams: BalancedTeams,
  privateServerUrl?: string | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`⚔️  Match #${matchId.slice(-6).toUpperCase()}`)
    .setDescription(
      [
        `**Mode:** \`Strict 5v5 Ranked\``,
        `**Status:** \`🟡 ACTIVE — Waiting for players\``,
        "",
        privateServerUrl
          ? `**🔗 Private Server Link:**\n\`\`\`${privateServerUrl}\`\`\``
          : "*No private server link was provided.*",
      ].join("\n")
    )
    .addFields(
      {
        name: `🔵  Team A  (avg \`${teams.teamAAvgMmr} MMR\`)`,
        value: TeamBalancer.formatRoster(teams.teamA, "A"),
        inline: false,
      },
      {
        name: `🔴  Team B  (avg \`${teams.teamBAvgMmr} MMR\`)`,
        value: TeamBalancer.formatRoster(teams.teamB, "B"),
        inline: false,
      },
      {
        name: "📊  Balance",
        value: `MMR Difference: \`${teams.mmrDifference}\`  ${
          teams.mmrDifference <= 50
            ? "✅ Excellent"
            : teams.mmrDifference <= 150
            ? "🟡 Fair"
            : "🔴 Uneven"
        }`,
        inline: false,
      }
    )
    .setFooter({
      text: `Match ID: ${matchId}  •  Use /report to submit the score when the match ends`,
    })
    .setTimestamp();

  return embed;
}

function buildReportButtons(matchId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`report_win_a_${matchId}`)
      .setLabel("🔵 Team A Won")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`report_win_b_${matchId}`)
      .setLabel("🔴 Team B Won")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`report_abort_${matchId}`)
      .setLabel("🚫 Abort Match")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MatchEngine
// ─────────────────────────────────────────────────────────────────────────────

export class MatchEngine {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  // ── Create Match ─────────────────────────────────────────────────────────────

  async createMatch(
    guildId: string,
    playerDiscordIds: string[]
  ): Promise<MatchCreationResult> {
    let matchRecord: { id: string } | null = null;
    let category: CategoryChannel | null = null;

    try {
      if (playerDiscordIds.length !== 10) {
        throw new Error(`Expected 10 players, got ${playerDiscordIds.length}`);
      }

      // 1. Fetch guild
      const guild = await this.client.guilds.fetch(guildId).catch(() => null);
      if (!guild) throw new Error(`Guild ${guildId} not found`);

      // 2. Fetch player data from DB
      const players = await prisma.player.findMany({
        where: { discordId: { in: playerDiscordIds } },
        select: { discordId: true, mmr: true, robloxUsername: true },
      });

      if (players.length !== 10) {
        throw new Error(
          `Expected 10 registered players, found ${players.length} in DB`
        );
      }

      // 3. Get private server URL (from first player who provided one)
      const sessionWithUrl = await prisma.queueSession.findFirst({
        where: {
          discordId: { in: playerDiscordIds },
          status: "FOUND",
          privateServerUrl: { not: null },
        },
        select: { privateServerUrl: true },
      });

      const privateServerUrl = sessionWithUrl?.privateServerUrl ?? null;

      // 4. Balance teams
      const teamPlayers: TeamPlayer[] = players;
      const teams = TeamBalancer.balance(teamPlayers);

      // 5. Create Match record in DB
      matchRecord = await prisma.match.create({
        data: {
          status: "ACTIVE",
          teamAPlayerIds: teams.teamA.map((p) => p.discordId),
          teamBPlayerIds: teams.teamB.map((p) => p.discordId),
          teamAAvgMmr: teams.teamAAvgMmr,
          teamBAvgMmr: teams.teamBAvgMmr,
          guildId,
          privateServerUrl,
        },
        select: { id: true },
      });

      // 6. Create Discord channels
      const matchChannels = await this.createMatchChannels(
        guild,
        matchRecord.id,
        playerDiscordIds
      );

      // 7. Post match embed in #match-chat
      await this.postMatchEmbed(
        guild,
        matchChannels,
        matchRecord.id,
        teams,
        privateServerUrl
      );

      // 8. Update match record with channel IDs
      await prisma.match.update({
        where: { id: matchRecord.id },
        data: {
          categoryChannelId: matchChannels.categoryId,
          textChannelId: matchChannels.textChannelId,
          voiceTeamAChannelId: matchChannels.voiceTeamAId,
          voiceTeamBChannelId: matchChannels.voiceTeamBId,
        },
      });

      // 9. Mark queue sessions as FOUND
      await QueueService.markSessionsAsFound(playerDiscordIds);

      console.log(
        `[MatchEngine] Match ${matchRecord.id} created successfully with ${playerDiscordIds.length} players`
      );

      return { success: true, matchId: matchRecord.id };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MatchEngine.createMatch] Error: ${msg}`);

      // Cleanup: delete Discord category if it was created
      if (category) {
        await this.safeDeleteCategory(category);
      }

      // Cleanup: cancel match record if it was created
      if (matchRecord) {
        await prisma.match
          .update({
            where: { id: matchRecord.id },
            data: { status: "ABORTED" },
          })
          .catch((e: unknown) => {
            const m = e instanceof Error ? e.message : String(e);
            console.error(
              `[MatchEngine.createMatch] Failed to abort match in DB: ${m}`
            );
          });
      }

      return { success: false, error: msg };
    }
  }

  // ── Create Discord Channels ───────────────────────────────────────────────────

  private async createMatchChannels(
    guild: Guild,
    matchId: string,
    playerDiscordIds: string[]
  ): Promise<MatchChannels> {
    const shortId = matchId.slice(-6).toUpperCase();

    // Build permission overwrites: deny everyone, allow matched players + admins
    const permissionOverwrites: OverwriteResolvable[] = [
      // Deny @everyone
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
    ];

    // Allow each matched player
    for (const discordId of playerDiscordIds) {
      permissionOverwrites.push({
        id: discordId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      });
    }

    // Allow admins (by finding roles with Administrator permission)
    const adminRoles = guild.roles.cache.filter((role) =>
      role.permissions.has(PermissionFlagsBits.Administrator)
    );

    for (const [, role] of adminRoles) {
      permissionOverwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.MoveMembers,
        ],
      });
    }

    // Create Category
    const category = await guild.channels.create({
      name: `Match #${shortId}`,
      type: ChannelType.GuildCategory,
      permissionOverwrites,
    });

    // Create #match-chat text channel
    const textChannel = await guild.channels.create({
      name: "match-chat",
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Match #${shortId} | Ranked 5v5 | Match ID: ${matchId}`,
      permissionOverwrites,
    });

    // Create Team A voice channel
    const voiceTeamA = await guild.channels.create({
      name: "🔊 Team A",
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: 5,
      permissionOverwrites,
    });

    // Create Team B voice channel
    const voiceTeamB = await guild.channels.create({
      name: "🔊 Team B",
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: 5,
      permissionOverwrites,
    });

    return {
      categoryId: category.id,
      textChannelId: textChannel.id,
      voiceTeamAId: voiceTeamA.id,
      voiceTeamBId: voiceTeamB.id,
    };
  }

  // ── Post Match Embed ──────────────────────────────────────────────────────────

  private async postMatchEmbed(
    guild: Guild,
    channels: MatchChannels,
    matchId: string,
    teams: BalancedTeams,
    privateServerUrl: string | null
  ): Promise<void> {
    const textChannel = guild.channels.cache.get(
      channels.textChannelId
    ) as TextChannel | undefined;

    if (!textChannel) {
      console.warn(
        `[MatchEngine.postMatchEmbed] Text channel ${channels.textChannelId} not found in cache`
      );
      return;
    }

    const embed = buildMatchEmbed(matchId, teams, privateServerUrl);
    const buttons = buildReportButtons(matchId);

    // Ping all players
    const pingLine = [
      ...teams.teamA.map((p) => `<@${p.discordId}>`),
      ...teams.teamB.map((p) => `<@${p.discordId}>`),
    ].join(" ");

    await textChannel.send({
      content: `🎮 **Match found!** ${pingLine}`,
      embeds: [embed],
      components: [buttons],
    });
  }

  // ── Complete / Abort Match ────────────────────────────────────────────────────

  async completeMatch(
    matchId: string,
    winner: "A" | "B"
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const match = await prisma.match.findUnique({ where: { id: matchId } });
      if (!match) throw new Error(`Match ${matchId} not found`);
      if (match.status !== "ACTIVE")
        throw new Error(`Match ${matchId} is not active (status: ${match.status})`);

      // Update match in DB
      await prisma.match.update({
        where: { id: matchId },
        data: {
          status: "COMPLETED",
          winner,
          completedAt: new Date(),
        },
      });

      // Update player stats
      const winnerIds =
        winner === "A"
          ? (match.teamAPlayerIds as string[])
          : (match.teamBPlayerIds as string[]);
      const loserIds =
        winner === "A"
          ? (match.teamBPlayerIds as string[])
          : (match.teamAPlayerIds as string[]);

      await prisma.player.updateMany({
        where: { discordId: { in: winnerIds } },
        data: {
          wins: { increment: 1 },
          mmr: { increment: 25 },
          elo: { increment: 20 },
        },
      });

      await prisma.player.updateMany({
        where: { discordId: { in: loserIds } },
        data: {
          losses: { increment: 1 },
          mmr: { decrement: 20 },
          elo: { decrement: 15 },
        },
      });

      // Update placement status for players who were in placement
      const allIds = [...winnerIds, ...loserIds];
      const placementPlayers = await prisma.player.findMany({
        where: {
          discordId: { in: allIds },
          status: "PLACEMENT",
          placementGamesLeft: { gt: 0 },
        },
      });

      for (const player of placementPlayers) {
        const newLeft = (player.placementGamesLeft ?? 1) - 1;
        await prisma.player.update({
          where: { discordId: player.discordId },
          data: {
            placementGamesLeft: newLeft,
            status: newLeft <= 0 ? "RANKED" : "PLACEMENT",
          },
        });
      }

      // Post completion message in text channel, then schedule cleanup
      if (match.guildId && match.textChannelId) {
        try {
          const guild = await this.client.guilds
            .fetch(match.guildId)
            .catch(() => null);
          if (guild) {
            const textChannel = (await guild.channels
              .fetch(match.textChannelId)
              .catch(() => null)) as TextChannel | null;

            if (textChannel) {
              await textChannel.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(winner === "A" ? 0x5865f2 : 0xed4245)
                    .setTitle("🏆  Match Completed")
                    .setDescription(
                      `**Team ${winner}** wins!\n\nThis channel will be deleted in **30 seconds**.`
                    )
                    .setTimestamp(),
                ],
              });
            }

            // Delete channels after 30 seconds
            setTimeout(async () => {
              await this.deleteMatchChannels(match.guildId!, matchId);
            }, 30_000);
          }
        } catch (channelError: unknown) {
          const m =
            channelError instanceof Error
              ? channelError.message
              : String(channelError);
          console.error(
            `[MatchEngine.completeMatch] Channel cleanup error: ${m}`
          );
        }
      }

      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MatchEngine.completeMatch] Error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  async abortMatch(
    matchId: string,
    reason: string = "Match aborted by admin"
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const match = await prisma.match.findUnique({ where: { id: matchId } });
      if (!match) throw new Error(`Match ${matchId} not found`);

      await prisma.match.update({
        where: { id: matchId },
        data: { status: "ABORTED", abortReason: reason },
      });

      if (match.guildId && match.textChannelId) {
        try {
          const guild = await this.client.guilds
            .fetch(match.guildId)
            .catch(() => null);
          if (guild) {
            const textChannel = (await guild.channels
              .fetch(match.textChannelId)
              .catch(() => null)) as TextChannel | null;

            if (textChannel) {
              await textChannel.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(Colors.Orange)
                    .setTitle("🚫  Match Aborted")
                    .setDescription(
                      `**Reason:** ${reason}\n\nThis channel will be deleted in **15 seconds**.`
                    )
                    .setTimestamp(),
                ],
              });
            }

            setTimeout(async () => {
              await this.deleteMatchChannels(match.guildId!, matchId);
            }, 15_000);
          }
        } catch (channelError: unknown) {
          const m =
            channelError instanceof Error
              ? channelError.message
              : String(channelError);
          console.error(
            `[MatchEngine.abortMatch] Channel cleanup error: ${m}`
          );
        }
      }

      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MatchEngine.abortMatch] Error: ${msg}`);
      return { success: false, error: msg };
    }
  }

  // ── Channel Deletion ──────────────────────────────────────────────────────────

  async deleteMatchChannels(
    guildId: string,
    matchId: string
  ): Promise<void> {
    try {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: {
          categoryChannelId: true,
          textChannelId: true,
          voiceTeamAChannelId: true,
          voiceTeamBChannelId: true,
        },
      });

      if (!match) {
        console.warn(
          `[MatchEngine.deleteMatchChannels] Match ${matchId} not found in DB`
        );
        return;
      }

      const guild = await this.client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        console.warn(
          `[MatchEngine.deleteMatchChannels] Guild ${guildId} not found`
        );
        return;
      }

      // Delete child channels first, then category
      const channelIds = [
        match.textChannelId,
        match.voiceTeamAChannelId,
        match.voiceTeamBChannelId,
      ].filter(Boolean) as string[];

      for (const channelId of channelIds) {
        try {
          const channel = await guild.channels
            .fetch(channelId)
            .catch(() => null);
          if (channel) {
            await channel.delete(`Match ${matchId} cleanup`);
          }
        } catch (channelErr: unknown) {
          const m =
            channelErr instanceof Error ? channelErr.message : String(channelErr);
          console.error(
            `[MatchEngine.deleteMatchChannels] Failed to delete channel ${channelId}: ${m}`
          );
        }
      }

      // Delete category
      if (match.categoryChannelId) {
        try {
          const category = await guild.channels
            .fetch(match.categoryChannelId)
            .catch(() => null);
          if (category) {
            await category.delete(`Match ${matchId} category cleanup`);
          }
        } catch (catErr: unknown) {
          const m = catErr instanceof Error ? catErr.message : String(catErr);
          console.error(
            `[MatchEngine.deleteMatchChannels] Failed to delete category ${match.categoryChannelId}: ${m}`
          );
        }
      }

      console.log(
        `[MatchEngine] Channels for match ${matchId} deleted successfully`
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MatchEngine.deleteMatchChannels] Error: ${msg}`);
    }
  }

  private async safeDeleteCategory(
    category: CategoryChannel
  ): Promise<void> {
    try {
      // Delete all children first
      for (const [, child] of category.children.cache) {
        await child.delete("Match creation failed — cleanup").catch(() => {});
      }
      await category.delete("Match creation failed — cleanup").catch(() => {});
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MatchEngine.safeDeleteCategory] Error: ${msg}`);
    }
  }
}
