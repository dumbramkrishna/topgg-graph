/**
 * discord.js example — topgg-graph
 *
 * Records Top.gg votes via webhook and serves the heatmap
 * in response to a slash command (/votes).
 *
 * This example assumes:
 *   - You run a separate HTTP server (e.g. Express) to receive webhooks.
 *   - The bot responds to an interaction with the SVG or PNG graph.
 *
 * Usage:
 *   npm install discord.js topgg-graph
 *   DISCORD_TOKEN=... TOPGG_WEBHOOK_SECRET=... node discordjs.js
 */

import {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  type Interaction,
} from "discord.js";
import http from "node:http";
import { TopggGraph, JsonFileAdapter } from "topgg-graph";

const graph = new TopggGraph({
  storage: new JsonFileAdapter("./votes.json"),
  webhookAuth: process.env["TOPGG_WEBHOOK_SECRET"] ?? "",
});

// ---- Webhook HTTP server (plain node:http) --------------------------------

const webhookHandler = graph.webhook({
  onVote(payload) {
    console.log(`Vote from ${payload.user}`);
  },
});

const server = http.createServer(async (req, res) => {
  if (req.url === "/webhook" && req.method === "POST") {
    await webhookHandler(req, res);
  } else {
    res.writeHead(404).end();
  }
});

const WEBHOOK_PORT = process.env["WEBHOOK_PORT"]
  ? Number(process.env["WEBHOOK_PORT"])
  : 3000;

server.listen(WEBHOOK_PORT, () => {
  console.log(`Webhook server listening on port ${WEBHOOK_PORT}`);
});

// ---- Discord bot ----------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", () => {
  console.log(`Logged in as ${client.user?.tag}`);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "votes") {
    await interaction.deferReply();
    try {
      // Render as PNG for Discord embeds (requires @resvg/resvg-js)
      const png = await graph.renderPNG({ theme: "dark" });
      const attachment = new AttachmentBuilder(png, { name: "votes.png" });
      await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error(err);
      // Fall back to SVG URL or error message
      await interaction.editReply("Could not render the vote graph.");
    }
  }
});

void client.login(process.env["DISCORD_TOKEN"]);

