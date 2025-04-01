/**
 * @fileoverview Handles registration and execution of Discord slash commands.
 * Handles registration and execution of Discord slash commands.
 */
// LLMcordTS/src/discord/slashCommandHandler.ts
import {
    Interaction,
    REST,
    Routes,
    ChatInputCommandInteraction, // Use the specific type needed
    CacheType // Import CacheType if needed by CommandInteraction/ChatInputCommandInteraction
} from 'discord.js';
import { LLMCordBot } from '@/core/LLMCordBot'; // Use path alias
// Import specific handler functions
import { handlePing } from '../commands/handlers/pingHandler';
import { handleHelp } from '../commands/handlers/helpHandler';
import { handleConfig, handleConfigAutocomplete } from '../commands/handlers/configHandler';
// MemoryCommandHandler is accessed via bot instance
// Removed old logger import
import * as fs from 'fs/promises'; // Use promises for async operations
import * as path from 'path';

// Define a type for the handler function signature using the specific interaction type
type CommandHandlerFunction = (interaction: ChatInputCommandInteraction<CacheType>) => Promise<void>;

/**
 * Manages the registration and handling of slash commands for the bot.
 */
export class SlashCommandHandler {
    /** Reference to the main LLMCordBot instance. */
    private bot: LLMCordBot;
    /** Map to store non-memory command handlers. */
    private commandHandlers: Map<string, CommandHandlerFunction>;

    /**
     * Creates an instance of SlashCommandHandler.
     * @param {LLMCordBot} bot - The main bot instance.
     */
    constructor(bot: LLMCordBot) {
        this.bot = bot;

        // Initialize and populate the command handler map
        this.commandHandlers = new Map<string, CommandHandlerFunction>();
        // Cast handlers if necessary, although ideally their signatures should match
        // If handlePing/Help/Config expect CommandInteraction, they might need adjustment
        // or we need a more complex type/check. Assuming they work with ChatInputCommandInteraction for now.
        this.commandHandlers.set('ping', handlePing as CommandHandlerFunction); // Cast might be needed if original signature differs slightly
        this.commandHandlers.set('help', handleHelp as CommandHandlerFunction);
        this.commandHandlers.set('config', handleConfig as CommandHandlerFunction);
        // Memory commands ('memory', 'forget') are handled separately via bot.memoryCommandHandler

        // Use the bot's logger instance
        this.bot.logger.info(`SlashCommandHandler initialized with ${this.commandHandlers.size} mapped handlers.`);
    }

    /**
     * Registers the defined slash commands with Discord.
     * This should be called once during bot initialization.
     * Note: Currently contains placeholder logic and commented-out registration code.
     * @returns {Promise<void>}
     */
    async registerCommands(): Promise<void> {
        const token = this.bot.config.discord.token;
        // Read clientId directly inside the try block where it's used
        // const clientId = this.bot.config.discord.clientId; // Removed assignment here
        const guildId = this.bot.config.discord.guildId; // Optional guild ID for testing

        if (!token) { // Removed clientId check here as it will be checked before use
            this.bot.logger.error('Cannot register commands: Discord token or client ID is missing in config.');
            return;
        }

        // Load command definitions using the dedicated method
        const commandsToRegister = await this.loadCommandDefinitions();

        if (commandsToRegister.length === 0) {
            this.bot.logger.warn('No command definitions found or loaded. Skipping registration.');
            return;
        }

        const rest = new REST({ version: '10' }).setToken(token);

        this.bot.logger.info(`Attempting to register ${commandsToRegister.length} application (/) commands...`);
        this.bot.logger.debug('Commands to register:', JSON.stringify(commandsToRegister, null, 2));


        try {
            let data: any;
            if (guildId) {
                // Registering guild-specific commands (faster updates for testing)
                this.bot.logger.info(`Registering commands in guild ${guildId}`);
                data = await rest.put(
                    // Read clientId directly here
                    Routes.applicationGuildCommands(this.bot.client.user!.id, guildId), // Use client.user.id directly
                    { body: commandsToRegister },
                );
                this.bot.logger.info(`Successfully registered ${data.length} application commands in guild ${guildId}.`);
            } else {
                // Registering global commands (can take up to an hour to propagate)
                this.bot.logger.info('Registering global commands.');
                // Use client.user.id directly here and log it
                const clientIdForApi = this.bot.client.user?.id; // Use client.user.id directly
                if (!clientIdForApi) {
                    this.bot.logger.error('Client ID from bot.client.user is missing right before global command registration!');
                    return; // Exit if ID is missing
                }
                this.bot.logger.debug(`Using clientId for global registration: '${clientIdForApi}'`); // Log the ID being used
                data = await rest.put( // Correctly assign result to data
                    Routes.applicationCommands(clientIdForApi),
                    { body: commandsToRegister }
                ); // Close rest.put call correctly
                 this.bot.logger.info(`Successfully registered ${data.length} global application commands.`);
            }

        } catch (error: any) { // Add : any to allow accessing potential properties
            this.bot.logger.error('Error during command registration API call:');
            // Log common Discord.js error properties if they exist
            if (error.message) this.bot.logger.error(`  Message: ${error.message}`);
            if (error.code) this.bot.logger.error(`  Code: ${error.code}`);
            if (error.status) this.bot.logger.error(`  Status: ${error.status}`);
            if (error.method) this.bot.logger.error(`  Method: ${error.method}`);
            if (error.path) this.bot.logger.error(`  Path: ${error.path}`);
            if (error.requestData?.json) this.bot.logger.error(`  Request Data: ${JSON.stringify(error.requestData.json)}`);
            if (error.rawError) this.bot.logger.error(`  Raw Error: ${JSON.stringify(error.rawError)}`);
            // Log the full error object as well for completeness, in case the above missed something
            this.bot.logger.error('  Full Error Object:', error);
        }
    }

    /**
     * Loads command definition data from the definitions directory.
     * Can be overridden in tests for easier mocking.
     * @protected
     * @returns {Promise<any[]>} An array of command data objects (toJSON results).
     */
    protected async loadCommandDefinitions(): Promise<any[]> {
        const commandsToRegister: any[] = [];
        const definitionsPath = path.join(__dirname, '..', 'commands', 'definitions'); // Path to definitions directory

        try {
            this.bot.logger.info(`Scanning for command definitions in: ${definitionsPath}`);
            // Use { withFileTypes: true } to get Dirent objects
            const dirents = await fs.readdir(definitionsPath, { withFileTypes: true });
            // Filter by name and ensure it's a file
            const commandFiles = dirents.filter(dirent => dirent.isFile() && (dirent.name.endsWith('.ts') || dirent.name.endsWith('.js')));

            this.bot.logger.debug(`Found definition files: ${commandFiles.map(f => f.name).join(', ')}`);

            for (const file of commandFiles) { // file is a Dirent object here
                const filePath = path.join(definitionsPath, file.name); // Use file.name
                try {
                    // Dynamically import the command definition module
                    // Use require for simplicity with potentially mixed TS/JS environments after build
                    const commandModule = require(filePath);

                    // Find the exported command builder (SlashCommandBuilder instance)
                    // Common export names: command, pingCommand, helpCommand, configCommand, etc.
                    const commandBuilder = commandModule.command || // Common name
                                           commandModule.pingCommand ||
                                           commandModule.helpCommand ||
                                           commandModule.configCommand ||
                                           Object.values(commandModule).find((exp: any) => exp?.toJSON) as any; // Fallback: find first export with toJSON

                    if (commandBuilder && typeof commandBuilder.toJSON === 'function') {
                        commandsToRegister.push(commandBuilder.toJSON());
                        this.bot.logger.debug(`Loaded command data from ${file.name} (using export '${Object.keys(commandModule).find(k => commandModule[k] === commandBuilder)}')`);
                    } else {
                        this.bot.logger.warn(`Skipping file ${file.name}: Could not find a valid SlashCommandBuilder export with a toJSON method.`);
                    }
                } catch (importError) {
                    this.bot.logger.error(`Error importing command definition from ${file.name}:`, importError); // Use file.name
                }
            }
        } catch (readError) {
            this.bot.logger.error(`Error reading command definitions directory ${definitionsPath}:`, readError);
            // Return empty array on error, registration will be skipped
        }

        return commandsToRegister;
    }


    /**
     * Handles an incoming interaction, routing it to the appropriate command handler.
     * @param {Interaction} interaction - The interaction object received from Discord.js.
     * @returns {Promise<void>}
     */
    async handleInteraction(interaction: Interaction): Promise<void> {
        // --- Handle Autocomplete Interactions ---
        if (interaction.isAutocomplete()) {
            this.bot.logger.debug(`Handling autocomplete interaction for command: ${interaction.commandName}`);
            if (interaction.commandName === 'config') {
                try {
                    // Ensure the handler exists before calling
                    // Autocomplete handlers expect AutocompleteInteraction
                    if (handleConfigAutocomplete) {
                        await handleConfigAutocomplete(interaction);
                    } else {
                         this.bot.logger.error('handleConfigAutocomplete is not defined or imported correctly.');
                         // Avoid responding here as it might interfere with Discord's expectations
                    }
                } catch (error) {
                    this.bot.logger.error(`Error handling config autocomplete:`, error);
                }
            } else {
                // Handle other autocomplete interactions if needed
                this.bot.logger.warn(`Received unhandled autocomplete interaction for command: ${interaction.commandName}`);
            }
            return; // Stop further processing for autocomplete
        }

        // --- Handle Chat Input (Slash) Command Interactions ---
        // Check if it's a chat input command *before* trying to use it as such
        if (!interaction.isChatInputCommand()) {
            this.bot.logger.debug(`Ignoring non-chat-input command interaction: ${interaction.type}`);
            return;
        }

        // Now we know it's a ChatInputCommandInteraction
        const commandName = interaction.commandName;
        this.bot.logger.info(`Handling slash command: /${commandName} by ${interaction.user.tag} (${interaction.user.id})`);

        try {
            let handler: CommandHandlerFunction | undefined | null;

            // Check for memory commands first
            if (commandName === 'memory' || commandName === 'forget') {
                // Get the handle method and bind 'this' to the memoryCommandHandler instance
                // memoryCommandHandler.handle expects ChatInputCommandInteraction
                handler = this.bot.memoryCommandHandler?.handle.bind(this.bot.memoryCommandHandler);
                if (!this.bot.memoryCommandHandler) {
                    this.bot.logger.warn(`/${commandName} received but memoryCommandHandler is not available.`);
                    await interaction.reply({ content: 'Memory feature is currently unavailable.', ephemeral: true });
                    return;
                }
                this.bot.logger.debug(`Dispatching /${commandName} to MemoryCommandHandler`);
            } else {
                // Look up in the map for other commands
                handler = this.commandHandlers.get(commandName);
                if (handler) {
                    this.bot.logger.debug(`Found handler for /${commandName} in map.`);
                }
            }

            // Execute the handler if found
            if (handler) {
                // Pass the interaction, which is confirmed to be ChatInputCommandInteraction
                await handler(interaction);
            } else {
                // Handler not found in map or memory handler wasn't applicable/available
                this.bot.logger.warn(`No handler found for slash command: /${commandName}`);
                await interaction.reply({ content: 'Command not found or not implemented yet!', ephemeral: true });
            }

        } catch (error) {
            this.bot.logger.error(`Error handling slash command /${commandName}:`, error);
            // Try to reply or follow up if the initial reply failed
            const replyOptions = { content: 'Sorry, there was an error executing that command.', ephemeral: true };
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(replyOptions);
                } else {
                    await interaction.reply(replyOptions);
                }
            } catch (replyError) {
                 this.bot.logger.error('Failed to send error reply/follow-up:', replyError);
            }
        }
    }
}