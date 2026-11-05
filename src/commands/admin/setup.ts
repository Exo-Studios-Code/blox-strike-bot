import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonInteraction,
  ModalSubmitInteraction,
  TextChannel,
  Message,
  Client,
  Interaction,
  ComponentType,
  InteractionType,
} from "discord.js";
import { QueueService } from "../../services/QueueService";
import { PlayerService } from "../../services/PlayerService";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_QUEUE = 10;
const BUTTON_JOIN = "queue_join_solo";
const BUTTON_LEAVE = "queue_leave";
const MODAL_JOIN = "modal_join_queue";
const MODAL_FIELD_SERVER_URL = "field_server_url";

// ─────────────────────────────────────────────────────────────────────────────
// Embed Builders
// ─────────────────────────────────────────────────────────────────────────────

async function buildDashboardEmbed(
  playerCount: number,
  playerMentions: string[]
): Promise<EmbedBuilder> {
  const isFull = playerCount >= MAX_QUEUE;
  const progressBar = QueueService.buildProgressBar(playerCount, MAX_QUEUE);

  const embed = new EmbedBuilder()
    .setColor(isFull ? 0xff4500 : 0x00e676)
    .setTitle("🟢  5v5 MATCHMAKING QUEUE")
    .setDescription(
      [
        `> **Mode:** \`Strict 5v5 Ranked\``,
        `> **Status:** ${isFull ? "⏳ Forming Match..." : "🔍 Searching..."}`,
        "",
        `**Queue Progress**`,
        progressBar,
        "",
        playerCount > 0
          ? `**Players in Queue (${playerCount}/${MAX_QUEUE})**\n${playerMentions
              .map((m, i) => `\`${i + 1}.\` ${m}`)
              .join("\n")}`
          : "*No players in queue yet. Be the first to join!*",
      ].join("\n")
    )
    .setFooter({
      text: "FACEIT-Style Ranked 5v5  •  Powered by ELO Matchmaking",
    })
    .setTimestamp();

  return embed;
}

function buildDashboardComponents(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_JOIN)
      .setLabel("🎮  Join Solo")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(BUTTON_LEAVE)
      .setLabel("❌  Leave Queue")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildJoinModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(MODAL_JOIN)
    .setTitle("🎮  Join Matchmaking Queue");

  const serverUrlInput = new TextInputBuilder()
    .setCustomId(MODAL_FIELD_SERVER_URL)
    .setLabel("Private Server URL / Invite Code (Optional)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://www.roblox.com/games/... or leave blank")
    .setRequired(false)
    .setMaxLength(512);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(serverUrlInput)
  );

  return modal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Updater (shared utility)
// ─────────────────────────────────────────────────────────────────────────────

export async function refreshDashboard(client: Client): Promise<void> {
  try {
    const ref = await QueueService.getDashboardRef();
    if (!ref) return;

    const guild = await client.guilds.fetch(ref.guildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels
      .fetch(ref.channelId)
      .catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const message = await channel.messages
      .fetch(ref.messageId)
      .catch(() => null);
    if (!message) return;

    const queueCount = await QueueService.getQueueCount();
    const memberIds = await QueueService.getQueueMembers();
    const mentions = memberIds.map((id) => `<@${id}>`);

    const embed = await buildDashboardEmbed(queueCount, mentions);
    const row = buildDashboardComponents();

    await message.edit({ embeds: [embed], components: [row] });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[refreshDashboard] Error: ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slash Command Definition
// ─────────────────────────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Admin setup commands")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("queue")
      .setDescription("Deploy the persistent 5v5 queue dashboard in this channel")
  ) as SlashCommandBuilder;

// ─────────────────────────────────────────────────────────────────────────────
// Command Executor
// ─────────────────────────────────────────────────────────────────────────────

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (interaction.options.getSubcommand() !== "queue") return;

  await interaction.deferReply({ ephemeral: true });

  try {
    const channel = interaction.channel;
    if (!(channel instanceof TextChannel)) {
      await interaction.editReply({
        content: "❌ This command must be run in a standard text channel.",
      });
      return;
    }

    const embed = await buildDashboardEmbed(0, []);
    const row = buildDashboardComponents();

    const dashboardMessage: Message = await channel.send({
      embeds: [embed],
      components: [row],
    });

    await QueueService.saveDashboardRef({
      channelId: channel.id,
      messageId: dashboardMessage.id,
      guildId: interaction.guildId!,
    });

    await interaction.editReply({
      content: `✅ Queue dashboard deployed successfully in ${channel}.\nMessage ID: \`${dashboardMessage.id}\``,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[setup queue] Error: ${msg}`);
    await interaction.editReply({
      content: "❌ Failed to deploy the queue dashboard. Check console for details.",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction Router (register this in your main interactionCreate handler)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleQueueInteraction(
  interaction: Interaction,
  client: Client
): Promise<void> {
  // ── Join Button ──────────────────────────────────────────────────────────────
  if (
    interaction.isButton() &&
    interaction.customId === BUTTON_JOIN
  ) {
    const modal = buildJoinModal();
    await interaction.showModal(modal);
    return;
  }

  // ── Leave Button ─────────────────────────────────────────────────────────────
  if (
    interaction.isButton() &&
    interaction.customId === BUTTON_LEAVE
  ) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await QueueService.leaveQueue(interaction.user.id);

      if (!result.success) {
        await interaction.editReply({
          content:
            result.error === "NOT_IN_QUEUE"
              ? "❌ You are not in the queue."
              : `❌ ${result.message ?? "An error occurred."}`,
        });
        return;
      }

      await refreshDashboard(client);

      await interaction.editReply({
        content: `✅ You have left the queue. (**${result.queueCount ?? 0}/${MAX_QUEUE}** players remaining)`,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[queue leave button] Error: ${msg}`);
      await interaction.editReply({
        content: "❌ An unexpected error occurred. Please try again.",
      });
    }
    return;
  }

  // ── Join Modal Submit ─────────────────────────────────────────────────────────
  if (
    interaction.isModalSubmit() &&
    interaction.customId === MODAL_JOIN
  ) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const privateServerUrl =
        interaction.fields.getTextInputValue(MODAL_FIELD_SERVER_URL).trim() ||
        undefined;

      const result = await QueueService.joinQueue(
        interaction.user.id,
        privateServerUrl
      );

      if (!result.success) {
        let userFacingMessage = result.message ?? "An error occurred.";
        if (result.error === "NOT_REGISTERED") {
          userFacingMessage = "❌ You are not registered. Use `/register` first.";
        } else if (result.error === "ALREADY_IN_QUEUE") {
          userFacingMessage = "⚠️ You are already in the queue.";
        } else if (result.error === "QUEUE_LOCKED") {
          userFacingMessage =
            "⏳ A match is being formed right now. Please wait a moment and try again.";
        } else {
          userFacingMessage = `❌ ${userFacingMessage}`;
        }

        await interaction.editReply({ content: userFacingMessage });
        return;
      }

      await refreshDashboard(client);

      await interaction.editReply({
        content: [
          `✅ You have joined the queue!`,
          `📊 **Queue:** \`${result.queueCount ?? 0}/${MAX_QUEUE}\` players`,
          privateServerUrl
            ? `🔗 **Private Server:** Saved — you'll receive it in your match channel.`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[queue join modal] Error: ${msg}`);
      await interaction.editReply({
        content: "❌ An unexpected error occurred. Please try again.",
      });
    }
    return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /register command (bonus: placed here for proximity to profile)
// ─────────────────────────────────────────────────────────────────────────────

export const registerData = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Register your Roblox account to start playing ranked matches");

export async function executeRegister(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId("modal_register")
    .setTitle("🎮  Player Registration");

  const usernameInput = new TextInputBuilder()
    .setCustomId("field_roblox_username")
    .setLabel("Your Roblox Username")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. Builderman")
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(20);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput)
  );

  await interaction.showModal(modal);
}

export async function handleRegisterModalSubmit(
  interaction: ModalSubmitInteraction,
  client: Client
): Promise<void> {
  if (interaction.customId !== "modal_register") return;
  await interaction.deferReply({ ephemeral: true });

  try {
    const robloxUsername = interaction.fields
      .getTextInputValue("field_roblox_username")
      .trim();

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(robloxUsername)) {
      await interaction.editReply({
        content:
          "❌ Invalid Roblox username. Only letters, numbers, and underscores are allowed (3–20 characters).",
      });
      return;
    }

    const result = await PlayerService.register(
      interaction.user.id,
      robloxUsername
    );

    if (!result.success || !result.player) {
      await interaction.editReply({
        content: `❌ ${result.message ?? "Registration failed."}`,
      });
      return;
    }

    const { buildProfileEmbed } = await import("../../services/PlayerService");
    const profileEmbed = buildProfileEmbed(
      result.player,
      interaction.user.tag
    );

    await interaction.editReply({
      content: "✅ **Registration successful!** Welcome to the ranked ladder.",
      embeds: [profileEmbed],
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[register modal submit] Error: ${msg}`);
    await interaction.editReply({
      content: "❌ An unexpected error occurred. Please try again.",
    });
  }
}
