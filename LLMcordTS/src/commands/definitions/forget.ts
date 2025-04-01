import { SlashCommandBuilder } from 'discord.js';

export const command = new SlashCommandBuilder()
    .setName('forget')
    .setDescription('Clear your entire memory (alternative to /memory forget).');

// Export the JSON representation for registration
export const data = command.toJSON();