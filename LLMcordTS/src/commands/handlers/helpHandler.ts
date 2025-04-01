import { CommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { commandDefinitions } from '../definitions/index'; // Corrected import path

export async function handleHelp(interaction: CommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('LLMcord Help')
    .setDescription('Here are the available commands:')
    .setColor(0x0099FF); // Example color

  // Dynamically list commands from definitions
  commandDefinitions.forEach((cmd: Pick<SlashCommandBuilder, 'name' | 'description'>) => {
    // Use the actual description, or the placeholder if it's missing or only whitespace
    const description = cmd.description?.trim(); // Trim original description
    if (description) {
        embed.addFields({ name: `/${cmd.name}`, value: cmd.description! }); // Use original description if valid (non-null asserted as it passed the check)
    } else {
        embed.addFields({ name: `/${cmd.name}`, value: '*No description provided*' }); // Use placeholder
    }
  });

  await interaction.reply({ embeds: [embed], ephemeral: true }); // Send as ephemeral message
}