import { SlashCommandBuilder } from 'discord.js';

export const command = new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Manage your persistent memory with the bot.')
    .addSubcommand(subcommand =>
        subcommand
            .setName('show')
            .setDescription('Show your current memory content (ephemeral).')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('append')
            .setDescription('Append text to your current memory.')
            .addStringOption(option =>
                option.setName('text')
                    .setDescription('The text to append.')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('replace')
            .setDescription('Replace your entire memory with new text.')
            .addStringOption(option =>
                option.setName('text')
                    .setDescription('The new memory content.')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('forget')
            .setDescription('Clear your entire memory.')
    ) // End of forget subcommand
    .addSubcommand(subcommand =>
        subcommand
            .setName('edit')
            .setDescription('Edit a specific memory entry by ID.')
            .addStringOption(option =>
                option.setName('id')
                    .setDescription('The ID of the memory entry to edit.')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('content')
                    .setDescription('The new content for the memory entry.')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('delete')
            .setDescription('Delete a specific memory entry by ID.')
            .addStringOption(option =>
                option.setName('id')
                    .setDescription('The ID of the memory entry to delete.')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('view')
            .setDescription('View a specific memory entry by ID (ephemeral).')
            .addStringOption(option =>
                option.setName('id')
                    .setDescription('The ID of the memory entry to view.')
                    .setRequired(true)
            )
    ); // End of all subcommands

// Export the JSON representation for registration
export const data = command.toJSON();