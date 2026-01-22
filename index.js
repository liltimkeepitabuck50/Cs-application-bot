// Appy-style application bot with:
// - Automatic weekly open/close
// - JSON persistence + memory
// - One-apply-per-open-period (admins bypass)
// - All messages as embeds
// - Question embeds with numbering + footer
// discord.js v14

const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  Routes,
  REST,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("fs");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel],
});

// ---------------------------
// CONFIG
// ---------------------------
let applicationsEnabled = false;

const QUESTIONS = [
  "Why do you want to join Customer Support?",
  "How active can you be each week?",
  "Do you have any past moderation or support experience?",
  "How would you handle a rude user?",
];

const reviewChannelId = process.env.REVIEW_CHANNEL_ID;
const reviewPingRoleId = process.env.REVIEW_PING_ROLE_ID;

// ---------------------------
// JSON STORAGE
// ---------------------------
const FILE_PATH = "./applications.json";

function loadData() {
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify({ applied: [], lastReset: null }, null, 2));
  }
  return JSON.parse(fs.readFileSync(FILE_PATH));
}

function saveData(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

let appData = loadData();

// ---------------------------
// REGISTER SLASH COMMANDS
// ---------------------------
const commands = [
  new SlashCommandBuilder()
    .setName("apply")
    .setDescription("Start a Customer Support application"),
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log("Commands registered.");
  } catch (err) {
    console.error(err);
  }
})();

// ---------------------------
// AUTO OPEN/CLOSE + RESET
// ---------------------------
function updateApplicationStatus() {
  const now = new Date();

  const estOffset = -5;
  const utc = now.getUTCHours();
  const estHour = (utc + estOffset + 24) % 24;
  const estDay = now.getUTCDay();

  if (estDay === 0 && estHour === 0) {
    applicationsEnabled = true;
    appData.applied = [];
    saveData(appData);
    console.log("Applications opened + reset.");
  }

  if (estDay === 1 && estHour === 23) {
    applicationsEnabled = false;
    console.log("Applications closed.");
  }
}

setInterval(updateApplicationStatus, 60 * 1000);

// ---------------------------
// SLASH COMMAND HANDLER
// ---------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "apply") {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!applicationsEnabled && !isAdmin) {
      const embed = new EmbedBuilder()
        .setTitle("Customer Support Application.")
        .setColor("#FFA500")
        .setDescription(
          "Welcome to the application! Thank you for your interest for applying but unfortunately, we are **Not** taking applications for customer support right now!\n\nApplications open every **Sunday at 12:00 AM EST** and close every **Monday at 11:59 PM EST**."
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (!isAdmin && appData.applied.includes(interaction.user.id)) {
      const embed = new EmbedBuilder()
        .setTitle("Customer Support Application.")
        .setColor("#FFA500")
        .setDescription(
          "You have already applied this week! The applications will reset for you to apply again on **Sunday at 12:00 AM EST**. If you believe this is incorrect, please contact the bot owner so they can reset your application file."
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle("Customer Support Application.")
      .setColor("#FFA500")
      .setDescription(
        "Welcome to the application! Thank you for your interest for applying! Let's start the application, shall we?\n\nBefore we start, please note that the minimum sentence requirement is **2+ sentences**."
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });

    startApplication(interaction.user, isAdmin);
  }
});

// ---------------------------
// APPLICATION FLOW
// ---------------------------
async function startApplication(user, isAdmin) {
  try {
    const dm = await user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Customer Support Application.")
          .setColor("#FFA500")
          .setDescription(
            "Welcome to the application! Thank you for your interest for applying! Let's start the application, shall we?\n\nBefore we start, please note that the minimum sentence requirement is **2+ sentences**."
          ),
      ],
    });

    const answers = [];

    for (let i = 0; i < QUESTIONS.length; i++) {
      await dm.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Question ${i + 1}`)
            .setColor("#FFA500")
            .setDescription(`**Q${i + 1}:** ${QUESTIONS[i]}`)
            .setFooter({ text: "Please answer with at least 2 sentences." }),
        ],
      });

      const collected = await dm.channel.awaitMessages({
        max: 1,
        time: 300000,
        errors: ["time"],
      });

      answers.push(collected.first().content);
    }

    await dm.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("SUBMITTED 🎉")
          .setColor("#FFA500")
          .setDescription(
            "Your application has been submitted! Please wait some time for our CS leadership to review your application and your results will be sent back via **THIS** DM."
          ),
      ],
    });

    if (!isAdmin) {
      appData.applied.push(user.id);
      saveData(appData);
    }

    sendToReview(user, answers);
  } catch (err) {
    console.log("DM error:", err);
  }
}

// ---------------------------
// SEND TO REVIEW CHANNEL
// ---------------------------
async function sendToReview(user, answers) {
  const channel = await client.channels.fetch(reviewChannelId);

  const embed = new EmbedBuilder()
    .setTitle("New Application Submitted")
    .setColor("#FFA500")
    .setDescription(`Applicant: **${user.tag}** (${user.id})`)
    .addFields(
      answers.map((ans, i) => ({
        name: `Q${i + 1}`,
        value: ans,
      }))
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pass_${user.id}`)
      .setLabel("Pass")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`fail_${user.id}`)
      .setLabel("Fail")
      .setStyle(ButtonStyle.Danger)
  );

  const rolePing = reviewPingRoleId ? `<@&${reviewPingRoleId}>` : "";

  await channel.send({
    content: rolePing,
    embeds: [embed],
    components: [row],
  });
}

// ---------------------------
// UPTIME SERVER (FIXED PORT)
// ---------------------------
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive!");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Uptime server running");
});

// ---------------------------
// PASS / FAIL BUTTON HANDLER
// ---------------------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, userId] = interaction.customId.split("_");
  const targetUser = await client.users.fetch(userId);

  if (action === "pass") {
    const embed = new EmbedBuilder()
      .setTitle("Application Result")
      .setColor("Green")
      .setDescription(
        "🎉 Congratulations! You have **passed** your Customer Support application! The role will be added soon. If the role is not added, please open a ticket and request Staffing Support so the role may be added. Make sure to attach proof."
      );

    await targetUser.send({ embeds: [embed] });

    await interaction.reply({
      embeds: [
        new EmbedBuilder().setColor("Green").setDescription("Applicant passed.")
      ],
      ephemeral: true
    });
  }

  if (action === "fail") {
    const embed = new EmbedBuilder()
      .setTitle("Application Result")
      .setColor("Red")
      .setDescription(
        "Thank you for applying. Unfortunately, you did **not pass** this time. They will open again on Sunday at 12:00 AM EST."
      );

    await targetUser.send({ embeds: [embed] });

    await interaction.reply({
      embeds: [
        new EmbedBuilder().setColor("Red").setDescription("Applicant failed.")
      ],
      ephemeral: true
    });
  }
});

// ---------------------------
client.login(process.env.TOKEN);
