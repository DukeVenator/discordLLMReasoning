import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

// Define allowed settings for modification (whitelist)
const allowedConfigSettings = [
    'defaultProvider',
    'logLevel',
    // Add other configurable settings here as needed
];

export const configCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('View or modify bot configuration settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // Restrict to users with Manage Server permission
    .setDMPermission(false) // Disable in DMs
    .addSubcommand(subcommand =>
        subcommand
            .setName('view')
            .setDescription('View the current value of a configuration setting.')
            .addStringOption(option =>
                option.setName('setting')
                    .setDescription('The configuration setting to view.')
                    .setRequired(false) // Make optional to view all settings? Or require one? Let's require for now.
                    .setAutocomplete(true) // Enable autocomplete based on allowed settings
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('set')
            .setDescription('Set the value of a configuration setting.')
            .addStringOption(option =>
                option.setName('setting')
                    .setDescription('The configuration setting to modify.')
                    .setRequired(true)
                    .setAutocomplete(true) // Enable autocomplete based on allowed settings
            )
            .addStringOption(option =>
                option.setName('value')
                    .setDescription('The new value for the setting.')
                    .setRequired(true)
            )
    );

// Function to provide autocomplete suggestions for settings
export async function configAutocomplete(interaction: any) { // Using 'any' for now, refine later if needed
    const focusedValue = interaction.options.getFocused();
    const filtered = allowedConfigSettings.filter(choice => choice.startsWith(focusedValue));
    await interaction.respond(
        filtered.map(choice => ({ name: choice, value: choice })),
    );
}

// Export the JSON representation for registration (if needed by your deployment script)
// export const data = configCommand.toJSON();