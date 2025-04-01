import { SlashCommandBuilder } from 'discord.js';
import { pingCommand } from './ping';
import { helpCommand } from './help';
import { command as memoryCommandBuilder } from './memory';
import { command as forgetCommandBuilder } from './forget';

// Add other command imports here

// Combine all command definitions into an array
// We only need the name and description for the help command
export const commandDefinitions: Pick<SlashCommandBuilder, 'name' | 'description'>[] = [
  pingCommand,
  helpCommand,
  memoryCommandBuilder,
  forgetCommandBuilder,
  // Add other commands here
];