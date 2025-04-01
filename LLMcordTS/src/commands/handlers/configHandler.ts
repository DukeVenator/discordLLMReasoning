import { CommandInteraction, CacheType, AutocompleteInteraction } from 'discord.js';
import { getConfigValue, setConfigValue } from '../../core/config'; // Removed unused getConfig import
// Import the whitelist directly from the definition file
// import { configCommand } from '../definitions/config'; // Unused import removed

// --- Refined approach: Define allowed settings here or import from a shared location ---
// It's better practice to define the whitelist centrally or import it from a dedicated config schema/types file
// rather than relying on the command definition file directly for this logic.
// For now, let's redefine it here for clarity, but ideally, refactor later.
const allowedConfigSettings = [
    'llm.defaultProvider', // Example using dot notation
    'logging.level',
    'memory.enabled',
    'llm.defaultMaxTokens',
    'llm.defaultTemperature',
    // Add other *specific* and safe-to-modify settings here
];

export async function handleConfig(interaction: CommandInteraction<CacheType>): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    const subcommand = interaction.options.getSubcommand(true);
    const settingKey = interaction.options.getString('setting'); // Can be null if optional

    try {
        if (subcommand === 'view') {
            if (!settingKey) {
                 // Handle viewing all (or a subset) of allowed settings if settingKey is optional
                 // const allConfig = getConfig(); // Unused variable removed
                 let response = 'Current Configurable Settings:\n```json\n{\n';
                 allowedConfigSettings.forEach(key => {
                     // We only need getConfigValue here, not the whole config object
                     const value = getConfigValue(key, 'N/A');
                     response += `  "${key}": ${JSON.stringify(value, null, 2)},\n`;
                 });
                 // Remove trailing comma and newline
                 response = response.replace(/,\n$/, '\n');
                 response += '}\n```';
                 await interaction.reply({ content: response, ephemeral: true });

            } else {
                // View specific setting
                const value = getConfigValue(settingKey);
                if (value === undefined) {
                    await interaction.reply({ content: `Configuration setting \`${settingKey}\` not found.`, ephemeral: true });
                } else {
                    // Use JSON.stringify for complex objects/arrays
                    const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
                    await interaction.reply({ content: `\`${settingKey}\`: \`\`\`${displayValue}\`\`\``, ephemeral: true });
                }
            }

        } else if (subcommand === 'set') {
            const settingToSet = interaction.options.getString('setting', true); // Required
            const newValue = interaction.options.getString('value', true); // Required

            // Validate against the whitelist
            if (!allowedConfigSettings.includes(settingToSet)) {
                await interaction.reply({ content: `Setting \`${settingToSet}\` cannot be modified via this command.`, ephemeral: true });
                return;
            }

            // Attempt to set the value (in-memory only for now)
            const success = setConfigValue(settingToSet, newValue);

            if (success) {
                await interaction.reply({ content: `Configuration setting \`${settingToSet}\` updated to \`${newValue}\` (in-memory). This change will be lost on restart.`, ephemeral: true });
            } else {
                // setConfigValue logs warnings for type mismatches or invalid keys
                await interaction.reply({ content: `Failed to update setting \`${settingToSet}\`. Check bot logs for details (e.g., type mismatch or invalid key).`, ephemeral: true });
            }
        }
    } catch (error: any) {
        console.error('Error handling /config command:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `An error occurred while processing the config command: ${error.message}`, ephemeral: true });
        } else {
             await interaction.followUp({ content: `An error occurred while processing the config command: ${error.message}`, ephemeral: true });
        }
    }
}

// Autocomplete handler - needs to be registered separately
export async function handleConfigAutocomplete(interaction: AutocompleteInteraction<CacheType>): Promise<void> {
    if (interaction.commandName !== 'config') return;

    const focusedOption = interaction.options.getFocused(true); // Get which option is focused

    if (focusedOption.name === 'setting') {
        const focusedValue = focusedOption.value.toLowerCase();
        const filtered = allowedConfigSettings
            .filter(choice => choice.toLowerCase().startsWith(focusedValue))
            .slice(0, 25); // Discord limits choices to 25

        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice })),
        );
    }
     // Add autocomplete for 'value' if needed (e.g., for boolean or enum settings)
     /* else if (focusedOption.name === 'value') {
         const settingName = interaction.options.getString('setting');
         if (settingName === 'logging.level') { // Example
             const levels = ['debug', 'info', 'warn', 'error'];
             const focusedValue = focusedOption.value.toLowerCase();
             const filtered = levels.filter(level => level.startsWith(focusedValue));
             await interaction.respond(filtered.map(level => ({ name: level, value: level })));
         }
         // Add more value suggestions based on settingName
     } */
}