import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { handleConfig, handleConfigAutocomplete } from '../../../src/commands/handlers/configHandler';
import { getConfigValue, setConfigValue, getConfig } from '../../../src/core/config';
// Removed unused CommandInteraction import
import { AutocompleteInteraction, CacheType, ChatInputCommandInteraction } from 'discord.js';

// --- Mocks ---

// Mock the config module functions
vi.mock('../../../src/core/config', () => ({
    getConfigValue: vi.fn(),
    setConfigValue: vi.fn(),
    getConfig: vi.fn(),
}));

// Mock allowed settings (mirroring the handler's definition for consistency in tests)
const allowedConfigSettings = [
    'llm.defaultProvider',
    'logging.level',
    'memory.enabled',
    'llm.defaultMaxTokens',
    'llm.defaultTemperature',
];

// Helper to create mock CommandInteraction
const createMockCommandInteraction = (subcommand: string, options: Record<string, string | null | undefined>): ChatInputCommandInteraction<CacheType> => {
    return {
        isChatInputCommand: vi.fn().mockReturnValue(true),
        options: {
            getSubcommand: vi.fn().mockReturnValue(subcommand),
            // Removed unused 'required' parameter from mock implementation
            getString: vi.fn((name: string /*, required?: boolean */) => options[name] ?? null), // Simulate getString behavior
        },
        reply: vi.fn(),
        followUp: vi.fn(), // For error handling tests
        replied: false,
        deferred: false,
        // Add other necessary properties/methods if needed
    } as unknown as ChatInputCommandInteraction<CacheType>;
};

// Helper to create mock AutocompleteInteraction
const createMockAutocompleteInteraction = (focusedOptionName: string, focusedValue: string): AutocompleteInteraction<CacheType> => {
    return {
        isAutocomplete: vi.fn().mockReturnValue(true),
        commandName: 'config',
        options: {
            getFocused: vi.fn().mockReturnValue({ name: focusedOptionName, value: focusedValue }),
            getString: vi.fn(), // Add if needed for context
        },
        respond: vi.fn(),
        // Add other necessary properties/methods if needed
    } as unknown as AutocompleteInteraction<CacheType>;
};


// --- Tests ---

describe('configHandler', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset config mock implementations if needed
        (getConfigValue as Mock).mockReset();
        (setConfigValue as Mock).mockReset();
        (getConfig as Mock).mockReset();
    });

    // --- handleConfig Tests ---
    describe('handleConfig (CommandInteraction)', () => {

        it('view: should show value for a valid setting', async () => {
            const mockInteraction = createMockCommandInteraction('view', { setting: 'logging.level' });
            (getConfigValue as Mock).mockReturnValue('info');

            await handleConfig(mockInteraction);

            expect(getConfigValue).toHaveBeenCalledWith('logging.level');
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: '`logging.level`: ```info```',
                ephemeral: true,
            });
        });

         it('view: should show JSON for an object value', async () => {
            const mockInteraction = createMockCommandInteraction('view', { setting: 'llm.ollama' }); // Assuming this key exists and is allowed
            const testObject = { baseURL: 'http://test', defaultModel: 'test-model' };
             // Add 'llm.ollama' to allowed list for this test if not already there
             // For simplicity, let's assume it's allowed for the test scenario
            (getConfigValue as Mock).mockReturnValue(testObject);

            await handleConfig(mockInteraction);

            expect(getConfigValue).toHaveBeenCalledWith('llm.ollama');
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: `\`llm.ollama\`: \`\`\`${JSON.stringify(testObject, null, 2)}\`\`\``,
                ephemeral: true,
            });
        });

        it('view: should report setting not found', async () => {
            const mockInteraction = createMockCommandInteraction('view', { setting: 'invalid.setting' });
            (getConfigValue as Mock).mockReturnValue(undefined);

            await handleConfig(mockInteraction);

            expect(getConfigValue).toHaveBeenCalledWith('invalid.setting');
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Configuration setting `invalid.setting` not found.',
                ephemeral: true,
            });
        });

         it('view: should show all allowed settings if setting is omitted', async () => {
            const mockInteraction = createMockCommandInteraction('view', { setting: null }); // No setting provided
            const mockFullConfig = {
                'llm.defaultProvider': 'openai',
                'logging.level': 'debug',
                'memory.enabled': true,
                'llm.defaultMaxTokens': 2048,
                'llm.defaultTemperature': 0.5,
                'other.setting': 'should_not_be_shown', // This shouldn't appear
            };
            (getConfig as Mock).mockReturnValue(mockFullConfig);
            // Mock individual getConfigValue calls made inside the loop
            (getConfigValue as Mock).mockImplementation((key: string) => mockFullConfig[key as keyof typeof mockFullConfig] ?? 'N/A');


            await handleConfig(mockInteraction);

            // getConfig is NOT called in this scenario; getConfigValue is called in a loop.
            expect(getConfig).not.toHaveBeenCalled();
            expect(getConfigValue).toHaveBeenCalledTimes(allowedConfigSettings.length); // Called for each allowed setting

            // Ensure reply was called before accessing its arguments
            expect(mockInteraction.reply).toHaveBeenCalledOnce();

            // Check length before accessing index 0
            const calls = (mockInteraction.reply as Mock).mock.calls;
            if (calls.length > 0) {
                const firstCall = calls[0]; // Get the first call array
                expect(firstCall).toBeDefined(); // Ensure the first call exists

                if (firstCall && firstCall.length > 0) {
                    const replyArgs = firstCall[0]; // Get the first argument of the first call
                    expect(replyArgs).toBeDefined(); // Ensure the first argument exists

                    // Access arguments safely (assuming replyArgs is the expected object)
                    expect(replyArgs.content).toContain('"llm.defaultProvider": "openai"');
                    expect(replyArgs.content).toContain('"logging.level": "debug"');
                    expect(replyArgs.content).toContain('"memory.enabled": true');
                    expect(replyArgs.content).toContain('"llm.defaultMaxTokens": 2048');
                    expect(replyArgs.content).toContain('"llm.defaultTemperature": 0.5');
                    expect(replyArgs.content).not.toContain('other.setting'); // Ensure only allowed are shown
                    expect(replyArgs.ephemeral).toBe(true);
                } else {
                     expect.fail('mockInteraction.reply was called, but the first call had no arguments.');
                }
            } else {
                // Fail the test explicitly if reply wasn't called as expected
                expect.fail('mockInteraction.reply was expected to be called once, but its call count was 0.');
            }
        });

        it('set: should successfully set an allowed setting', async () => {
            const mockInteraction = createMockCommandInteraction('set', { setting: 'logging.level', value: 'debug' });
            (setConfigValue as Mock).mockReturnValue(true); // Simulate successful set

            await handleConfig(mockInteraction);

            expect(setConfigValue).toHaveBeenCalledWith('logging.level', 'debug');
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Configuration setting `logging.level` updated to `debug` (in-memory). This change will be lost on restart.',
                ephemeral: true,
            });
        });

        it('set: should report failure if setting is not allowed', async () => {
            const mockInteraction = createMockCommandInteraction('set', { setting: 'discord.token', value: 'new_token' });

            await handleConfig(mockInteraction);

            expect(setConfigValue).not.toHaveBeenCalled(); // Should not attempt to set
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Setting `discord.token` cannot be modified via this command.',
                ephemeral: true,
            });
        });

        it('set: should report failure if setConfigValue returns false (e.g., type mismatch)', async () => {
            const mockInteraction = createMockCommandInteraction('set', { setting: 'memory.enabled', value: 'maybe' }); // Invalid boolean
            (setConfigValue as Mock).mockReturnValue(false); // Simulate failed set

            await handleConfig(mockInteraction);

            expect(setConfigValue).toHaveBeenCalledWith('memory.enabled', 'maybe');
            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: 'Failed to update setting `memory.enabled`. Check bot logs for details (e.g., type mismatch or invalid key).',
                ephemeral: true,
            });
        });

        it('should handle errors during processing', async () => {
            const mockInteraction = createMockCommandInteraction('view', { setting: 'logging.level' });
            const testError = new Error('Config access error');
            (getConfigValue as Mock).mockImplementation(() => { throw testError; });
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error

            await handleConfig(mockInteraction);

            expect(mockInteraction.reply).toHaveBeenCalledWith({
                content: `An error occurred while processing the config command: ${testError.message}`,
                ephemeral: true,
            });
            expect(consoleSpy).toHaveBeenCalledWith('Error handling /config command:', testError);
            consoleSpy.mockRestore();
        });
    });

        it('should handle errors using followUp if already replied or deferred', async () => {
            const mockInteraction = createMockCommandInteraction('set', { setting: 'logging.level', value: 'debug' });
            mockInteraction.deferred = true; // Simulate already deferred
            const testError = new Error('Late config error during set');
            (setConfigValue as Mock).mockImplementation(() => { throw testError; }); // Error during set
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error

            await handleConfig(mockInteraction);

            expect(setConfigValue).toHaveBeenCalledWith('logging.level', 'debug'); // Ensure it attempted the set
            expect(mockInteraction.reply).not.toHaveBeenCalled(); // Should not reply again
            expect(mockInteraction.followUp).toHaveBeenCalledWith({ // Should followUp
                content: `An error occurred while processing the config command: ${testError.message}`,
                ephemeral: true,
            });
            expect(consoleSpy).toHaveBeenCalledWith('Error handling /config command:', testError);
            consoleSpy.mockRestore();
        });


    // --- handleConfigAutocomplete Tests ---
    describe('handleConfigAutocomplete', () => {
        it('should return filtered allowed settings for "setting" option', async () => {
            const mockInteraction = createMockAutocompleteInteraction('setting', 'llm');

            await handleConfigAutocomplete(mockInteraction);

            expect(mockInteraction.respond).toHaveBeenCalledOnce();
            expect(mockInteraction.respond).toHaveBeenCalledWith([
                { name: 'llm.defaultProvider', value: 'llm.defaultProvider' },
                { name: 'llm.defaultMaxTokens', value: 'llm.defaultMaxTokens' },
                { name: 'llm.defaultTemperature', value: 'llm.defaultTemperature' },
            ]);
        });

        it('should return all allowed settings if focused value is empty', async () => {
            const mockInteraction = createMockAutocompleteInteraction('setting', '');

            await handleConfigAutocomplete(mockInteraction);

            expect(mockInteraction.respond).toHaveBeenCalledOnce();
            expect(mockInteraction.respond).toHaveBeenCalledWith(
                allowedConfigSettings.map(choice => ({ name: choice, value: choice }))
            );
        });

         it('should return empty array if no settings match', async () => {
            const mockInteraction = createMockAutocompleteInteraction('setting', 'xyz');

            await handleConfigAutocomplete(mockInteraction);

            expect(mockInteraction.respond).toHaveBeenCalledOnce();
            expect(mockInteraction.respond).toHaveBeenCalledWith([]);
        });

        it('should not respond if focused option is not "setting"', async () => {
             const mockInteraction = createMockAutocompleteInteraction('value', 'test'); // Focus on 'value'

            await handleConfigAutocomplete(mockInteraction);

            expect(mockInteraction.respond).not.toHaveBeenCalled();
        });
    });
});