import { CommandInteraction } from 'discord.js';

export async function handlePing(interaction: CommandInteraction): Promise<void> {
  await interaction.reply('Pong!');
}