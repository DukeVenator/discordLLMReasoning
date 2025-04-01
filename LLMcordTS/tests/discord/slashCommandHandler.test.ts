import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlashCommandHandler } from '@/discord/slashCommandHandler';
import { LLMCordBot } from '@/core/LLMCordBot';
import { Config } from '@/types/config';
import { Logger } from '@/core/logger';
import { Routes, Interaction, ChatInputCommandInteraction, AutocompleteInteraction, CacheType } from 'discord.js'; // Removed REST and ApplicationCommandType
import { MemoryCommandHandler } from '@/commands/handlers/memoryCommandHandler'; // Import for mocking

// --- Mocks ---

// Define mock functions at the top level for clarity
const mockHandlePing = vi.fn();
const mockHandleHelp = vi.fn();
const mockHandleConfig = vi.fn();
const mockHandleConfigAutocomplete = vi.fn();

// Handler module mocks will be moved inside beforeEach

// --- Test Setup ---

describe('SlashCommandHandler', () => {
    let mockBot: LLMCordBot;
    let mockConfig: Partial<Config>;
    let mockLogger: Logger;
    let mockMemoryCommandHandler: MemoryCommandHandler | null;
    let handler: SlashCommandHandler;
    // Declare captured mocks here, to be assigned in beforeEach
    let capturedMockSetToken: ReturnType<typeof vi.fn>;
    let capturedMockPut: ReturnType<typeof vi.fn>;
    let SlashCommandHandlerClass: typeof SlashCommandHandler; // To hold the dynamically imported class

    // Helper to create mock interactions
    const createMockChatInteraction = (commandName: string): ChatInputCommandInteraction<CacheType> => ({
        isChatInputCommand: () => true,
        isAutocomplete: () => false,
        commandName,
        user: { id: 'user-123', tag: 'User#1234' },
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        deferred: false,
        replied: false,
        // Add other necessary properties if needed by handlers
    } as unknown as ChatInputCommandInteraction<CacheType>);

    const createMockAutocompleteInteraction = (commandName: string): AutocompleteInteraction<CacheType> => ({
        isChatInputCommand: () => false,
        isAutocomplete: () => true,
        commandName,
        respond: vi.fn().mockResolvedValue(undefined),
        options: { // Add mock options object
            getFocused: vi.fn().mockReturnValue(''), // Mock getFocused method
            // Add other option methods/properties if needed by tests (e.g., getString, getInteger)
        },
        // Add other necessary properties if needed by handlers
    } as unknown as AutocompleteInteraction<CacheType>);


    beforeEach(async () => { // Make beforeEach async
        vi.resetModules(); // Reset modules before mocking
        vi.clearAllMocks();
        // Handler mocks removed from here, will use vi.doMock below


        // Define and capture discord.js mocks *inside* beforeEach
        const mockSetToken = vi.fn().mockReturnThis();
        const mockPut = vi.fn().mockResolvedValue([{ id: '123', name: 'mockCommand' }]);
        capturedMockSetToken = mockSetToken; // Assign to the outer scope variable
        capturedMockPut = mockPut; // Assign to the outer scope variable

        // Use vi.doMock *before* importing the module under test
        vi.doMock('discord.js', async (importOriginal) => {
            const actual = await importOriginal<typeof import('discord.js')>();
            return {
                ...actual,
                REST: vi.fn().mockImplementation(() => ({
                    setToken: mockSetToken, // Use the mock defined in beforeEach
                    put: mockPut,           // Use the mock defined in beforeEach
                })),
                // Re-add the Routes mock correctly here
                Routes: {
                    applicationCommands: vi.fn((clientId) => `/applications/${clientId}/commands`),
                    applicationGuildCommands: vi.fn((clientId, guildId) => `/applications/${clientId}/guilds/${guildId}/commands`),
                },
            };
        }); // Correctly close the vi.doMock('discord.js', ...) call
        // Mock configHandler specifically for autocomplete *before* dynamic import
        // Try using alias path
        vi.doMock('@/commands/handlers/configHandler.js', () => ({
            handleConfig: mockHandleConfig, // Keep this for consistency if needed
            handleConfigAutocomplete: mockHandleConfigAutocomplete,
        }));
        // Removed extra closing });

        // Dynamically import the class *after* the mock is set up
        // Use relative path with .js extension as required by NodeNext module resolution
        const module = await import('../../src/discord/slashCommandHandler.js');
        SlashCommandHandlerClass = module.SlashCommandHandler;
        // Map modifications removed from here, will be re-inserted after handler creation


        // --- Rest of the setup ---

        // Mock Logger
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            setLevel: vi.fn(),
            getLevel: vi.fn(() => 'debug'),
        } as unknown as Logger;

        // Mock Config
        mockConfig = {
            discord: {
                token: 'test-token',
                clientId: 'test-client-id',
            },
            memory: { // Add missing required fields
                enabled: true,
                storageType: 'sqlite', // Required
                sqlite: { // Required
                    path: ':memory:', // Use in-memory for tests
                },
                // Add other optional fields if needed by specific tests later
            }
            // Add other necessary config parts if needed
        };

        // Mock MemoryCommandHandler
        mockMemoryCommandHandler = {
            handle: vi.fn().mockResolvedValue(undefined),
            // Add other methods if needed
        } as unknown as MemoryCommandHandler;

        // Mock LLMCordBot instance
        mockBot = {
            config: mockConfig as Config, // Cast to full type
            logger: mockLogger,
            memoryCommandHandler: mockMemoryCommandHandler, // Assign the mock handler
            // Add other properties/methods if the handler uses them
        } as LLMCordBot;

        // Create handler instance using the dynamically imported class
        handler = new SlashCommandHandlerClass(mockBot);
        // Directly set mock handlers on the instance's map *after* instantiation
        (handler as any).commandHandlers.set('ping', mockHandlePing);
        (handler as any).commandHandlers.set('help', mockHandleHelp);
        (handler as any).commandHandlers.set('config', mockHandleConfig);


        // Spy on loadCommandDefinitions for registerCommands tests
        // Note: Spying on the prototype might be more robust if the instance changes
        vi.spyOn(handler as any, 'loadCommandDefinitions').mockResolvedValue([]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // --- registerCommands Tests ---
    describe('registerCommands', () => {
        it('should register commands globally when definitions are found', async () => {
            const mockCommandData = [{ name: 'cmd1', description: 'desc1' }];
            vi.mocked((handler as any).loadCommandDefinitions).mockResolvedValueOnce(mockCommandData);

            await handler.registerCommands();

            expect(mockLogger.info).toHaveBeenCalledWith('Attempting to register 1 application (/) commands...');
            // Check the captured mock functions
            expect(capturedMockSetToken).toHaveBeenCalledWith('test-token');
            expect(capturedMockPut).toHaveBeenCalledTimes(1);
            expect(capturedMockPut).toHaveBeenCalledWith(
                Routes.applicationCommands(mockBot.config.discord.clientId),
                { body: mockCommandData }
            );
            expect(mockLogger.info).toHaveBeenCalledWith('Successfully registered 1 global application commands.');
        });

        it('should register commands to guild when guildId is provided', async () => {
            const mockCommandData = [{ name: 'cmd1', description: 'desc1' }];
            vi.mocked((handler as any).loadCommandDefinitions).mockResolvedValueOnce(mockCommandData);
            mockBot.config.discord.guildId = 'test-guild-id'; // Set guildId for this test

            await handler.registerCommands();

            expect(mockLogger.info).toHaveBeenCalledWith('Registering commands in guild test-guild-id');
            // Check the captured mock functions
            expect(capturedMockSetToken).toHaveBeenCalledWith('test-token');
            expect(capturedMockPut).toHaveBeenCalledTimes(1);
            expect(capturedMockPut).toHaveBeenCalledWith(
                Routes.applicationGuildCommands(mockBot.config.discord.clientId, 'test-guild-id'),
                { body: mockCommandData }
            );
            expect(mockLogger.info).toHaveBeenCalledWith('Successfully registered 1 application commands in guild test-guild-id.');
        });

        it('should skip registration if no command definitions are loaded', async () => {
            // loadCommandDefinitions is mocked to return [] in beforeEach
            await handler.registerCommands();

            expect(mockLogger.warn).toHaveBeenCalledWith('No command definitions found or loaded. Skipping registration.');
            // Check the captured mock function
            expect(capturedMockPut).not.toHaveBeenCalled();
        });

        it('should skip registration if token or clientId is missing', async () => {
            mockBot.config.discord.token = ''; // Remove token
            await handler.registerCommands();

            expect(mockLogger.error).toHaveBeenCalledWith('Cannot register commands: Discord token or client ID is missing in config.');
            // Check the captured mock function
            expect(capturedMockPut).not.toHaveBeenCalled();
        });

        it('should log error if REST put fails', async () => {
            const mockCommandData = [{ name: 'cmd1', description: 'desc1' }];
            vi.mocked((handler as any).loadCommandDefinitions).mockResolvedValueOnce(mockCommandData);
            const apiError = new Error('API Error');
            // Mock rejection on the captured mock function
            capturedMockPut.mockRejectedValueOnce(apiError); // Use captured mock

            await handler.registerCommands();

            expect(mockLogger.error).toHaveBeenCalledWith('Error during command registration API call:');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Message: API Error'));
            expect(mockLogger.error).toHaveBeenCalledWith('  Full Error Object:', apiError);
        });
    });

    // --- handleInteraction Tests ---
    describe('handleInteraction', () => {
        it('should route to handlePing for /ping command', async () => {
            const interaction = createMockChatInteraction('ping');
            await handler.handleInteraction(interaction);
            expect(mockHandlePing).toHaveBeenCalledWith(interaction);
            expect(mockHandleHelp).not.toHaveBeenCalled();
            expect(mockHandleConfig).not.toHaveBeenCalled();
            expect(mockMemoryCommandHandler?.handle).not.toHaveBeenCalled();
        });

        it('should route to handleHelp for /help command', async () => {
            const interaction = createMockChatInteraction('help');
            await handler.handleInteraction(interaction);
            expect(mockHandleHelp).toHaveBeenCalledWith(interaction);
            expect(mockHandlePing).not.toHaveBeenCalled();
            expect(mockHandleConfig).not.toHaveBeenCalled();
            expect(mockMemoryCommandHandler?.handle).not.toHaveBeenCalled();
        });

        it('should route to handleConfig for /config command', async () => {
            const interaction = createMockChatInteraction('config');
            await handler.handleInteraction(interaction);
            expect(mockHandleConfig).toHaveBeenCalledWith(interaction);
            expect(mockHandlePing).not.toHaveBeenCalled();
            expect(mockHandleHelp).not.toHaveBeenCalled();
            expect(mockMemoryCommandHandler?.handle).not.toHaveBeenCalled();
        });

        it('should route to memoryCommandHandler for /memory command', async () => {
            const interaction = createMockChatInteraction('memory');
            await handler.handleInteraction(interaction);
            expect(mockMemoryCommandHandler?.handle).toHaveBeenCalledWith(interaction);
            expect(mockHandlePing).not.toHaveBeenCalled();
            expect(mockHandleHelp).not.toHaveBeenCalled();
            expect(mockHandleConfig).not.toHaveBeenCalled();
        });

        it('should route to memoryCommandHandler for /forget command', async () => {
            const interaction = createMockChatInteraction('forget');
            await handler.handleInteraction(interaction);
            expect(mockMemoryCommandHandler?.handle).toHaveBeenCalledWith(interaction);
            expect(mockHandlePing).not.toHaveBeenCalled();
            expect(mockHandleHelp).not.toHaveBeenCalled();
            expect(mockHandleConfig).not.toHaveBeenCalled();
        });

        it('should reply with error if memory command used but handler is unavailable', async () => {
            mockBot.memoryCommandHandler = null; // Disable memory handler
            handler = new SlashCommandHandler(mockBot); // Recreate handler with updated bot mock
            const interaction = createMockChatInteraction('memory');

            await handler.handleInteraction(interaction);

            expect(mockMemoryCommandHandler?.handle).not.toHaveBeenCalled(); // Original mock should not be called
            expect(interaction.reply).toHaveBeenCalledWith({
                content: 'Memory feature is currently unavailable.',
                ephemeral: true,
            });
        });

        it('should reply with error for unknown command', async () => {
            const interaction = createMockChatInteraction('unknown');
            await handler.handleInteraction(interaction);

            expect(mockHandlePing).not.toHaveBeenCalled();
            expect(mockHandleHelp).not.toHaveBeenCalled();
            expect(mockHandleConfig).not.toHaveBeenCalled();
            expect(mockMemoryCommandHandler?.handle).not.toHaveBeenCalled();
            expect(interaction.reply).toHaveBeenCalledWith({
                content: 'Command not found or not implemented yet!',
                ephemeral: true,
            });
        });

        it('should handle errors during command execution and reply', async () => {
            const interaction = createMockChatInteraction('ping');
            const commandError = new Error('Ping failed!');
            mockHandlePing.mockRejectedValueOnce(commandError);

            await handler.handleInteraction(interaction);

            expect(mockLogger.error).toHaveBeenCalledWith('Error handling slash command /ping:', commandError);
            expect(interaction.reply).toHaveBeenCalledWith({
                content: 'Sorry, there was an error executing that command.',
                ephemeral: true,
            });
        });

         it('should handle errors during command execution and followUp if already replied/deferred', async () => {
            const interaction = createMockChatInteraction('ping');
            interaction.replied = true; // Simulate already replied
            const commandError = new Error('Ping failed!');
            mockHandlePing.mockRejectedValueOnce(commandError);

            await handler.handleInteraction(interaction);

            expect(mockLogger.error).toHaveBeenCalledWith('Error handling slash command /ping:', commandError);
            expect(interaction.reply).not.toHaveBeenCalled();
            expect(interaction.followUp).toHaveBeenCalledWith({
                content: 'Sorry, there was an error executing that command.',
                ephemeral: true,
            });
        });

        it('should ignore non-chat-input command interactions', async () => {
            const interaction = { // Mock a generic interaction
                isChatInputCommand: () => false,
                isAutocomplete: () => false,
                type: 99, // Some other type
            } as unknown as Interaction;

            await handler.handleInteraction(interaction);

            expect(mockLogger.debug).toHaveBeenCalledWith('Ignoring non-chat-input command interaction: 99');
            expect(mockHandlePing).not.toHaveBeenCalled();
            expect(mockMemoryCommandHandler?.handle).not.toHaveBeenCalled();
        });

        // --- Autocomplete Tests ---
        it('should route to handleConfigAutocomplete for /config autocomplete', async () => {
            const interaction = createMockAutocompleteInteraction('config');
            await handler.handleInteraction(interaction);
            expect(mockHandleConfigAutocomplete).toHaveBeenCalledWith(interaction);
        });

        it('should warn for unhandled autocomplete interactions', async () => {
            const interaction = createMockAutocompleteInteraction('unknown');
            await handler.handleInteraction(interaction);
            expect(mockLogger.warn).toHaveBeenCalledWith('Received unhandled autocomplete interaction for command: unknown');
            expect(mockHandleConfigAutocomplete).not.toHaveBeenCalled();
        });

         it('should handle errors during autocomplete execution', async () => {
            const interaction = createMockAutocompleteInteraction('config');
            const autocompleteError = new Error('Autocomplete failed!');
            mockHandleConfigAutocomplete.mockRejectedValueOnce(autocompleteError);

            await handler.handleInteraction(interaction);

            expect(mockLogger.error).toHaveBeenCalledWith('Error handling config autocomplete:', autocompleteError);
            // Should not attempt to reply to a failed autocomplete
            expect(interaction.respond).not.toHaveBeenCalled();
        });
    });
});