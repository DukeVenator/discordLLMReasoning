import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHelp } from '../../../src/commands/handlers/helpHandler';
import { CommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';

// Mock the commandDefinitions module
vi.mock('../../../src/commands/definitions/index', () => ({
    commandDefinitions: [
        { name: 'ping', description: 'Replies with Pong!' },
        { name: 'help', description: 'Shows this help message.' },
        { name: 'memory', description: 'Manages memory.' },
        { name: 'config', description: '' }, // Test empty description
        { name: 'test', description: undefined }, // Test undefined description
        { name: 'whitespace', description: '   ' }, // Test whitespace description
    ] as Pick<SlashCommandBuilder, 'name' | 'description'>[],
}));

// Mock EmbedBuilder
const mockEmbed = {
    setTitle: vi.fn().mockReturnThis(),
    setDescription: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    addFields: vi.fn().mockReturnThis(),
    // Add other methods if needed
};
vi.mock('discord.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('discord.js')>();
    return {
        ...actual,
        EmbedBuilder: vi.fn(() => mockEmbed),
    };
});


// Mock the CommandInteraction
const mockInteraction = {
    reply: vi.fn(),
    // Add other properties/methods if needed
} as unknown as CommandInteraction;

describe('helpHandler', () => {
    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
        // Explicitly reset EmbedBuilder mock internals if needed between tests
        mockEmbed.setTitle.mockClear();
        mockEmbed.setDescription.mockClear();
        mockEmbed.setColor.mockClear();
        mockEmbed.addFields.mockClear();
    });

    it('should reply with an ephemeral embed containing command list', async () => {
        await handleHelp(mockInteraction);

        // Check interaction reply
        expect(mockInteraction.reply).toHaveBeenCalledOnce();
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            embeds: [expect.any(Object)], // Check if an embed object was passed
            ephemeral: true,
        });

        // Check EmbedBuilder usage
        expect(EmbedBuilder).toHaveBeenCalledOnce();
        expect(mockEmbed.setTitle).toHaveBeenCalledWith('LLMcord Help');
        expect(mockEmbed.setDescription).toHaveBeenCalledWith('Here are the available commands:');
        expect(mockEmbed.setColor).toHaveBeenCalled(); // Check if color was set

        
                // Check fields added based on mocked definitions
                expect(mockEmbed.addFields).toHaveBeenCalledTimes(6); // Now expecting 6 calls
                expect(mockEmbed.addFields).toHaveBeenCalledWith({ name: '/ping', value: 'Replies with Pong!' });
                expect(mockEmbed.addFields).toHaveBeenCalledWith({ name: '/help', value: 'Shows this help message.' });
                expect(mockEmbed.addFields).toHaveBeenCalledWith({ name: '/memory', value: 'Manages memory.' });
                expect(mockEmbed.addFields).toHaveBeenCalledWith({ name: '/config', value: '*No description provided*' }); // Check handling of empty description
                expect(mockEmbed.addFields).toHaveBeenCalledWith({ name: '/test', value: '*No description provided*' }); // Check handling of undefined description
                expect(mockEmbed.addFields).toHaveBeenCalledWith({ name: '/whitespace', value: '*No description provided*' }); // Check handling of whitespace description
        
            });
     it('should handle potential errors during reply', async () => {
        // Simulate an error during reply
        const testError = new Error('Discord API error');
        mockInteraction.reply = vi.fn().mockRejectedValueOnce(testError);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error

        // Expect the error to propagate up
        await expect(handleHelp(mockInteraction)).rejects.toThrow(testError);

        // Verify reply was still attempted
        expect(mockInteraction.reply).toHaveBeenCalledOnce();
        consoleSpy.mockRestore();
    });
    it('should handle the case where no commands are registered', async () => {
        // Temporarily override the mock for this specific test
        vi.resetModules(); // Reset modules to ensure the mock is picked up
        vi.doMock('../../../src/commands/definitions/index', () => ({
            commandDefinitions: [] as Pick<SlashCommandBuilder, 'name' | 'description'>[],
        }));

        // Re-import the handler to get the version with the overridden mock
        // Ensure the path is correct relative to the test file
        const { handleHelp: handleHelpWithNoCommands } = await import('../../../src/commands/handlers/helpHandler.js');

        await handleHelpWithNoCommands(mockInteraction);

        // Check interaction reply
        expect(mockInteraction.reply).toHaveBeenCalledOnce();
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            embeds: [expect.any(Object)],
            ephemeral: true,
        });

        // Check EmbedBuilder usage
        expect(EmbedBuilder).toHaveBeenCalledOnce();
        expect(mockEmbed.setTitle).toHaveBeenCalledWith('LLMcord Help');
        expect(mockEmbed.setDescription).toHaveBeenCalledWith('Here are the available commands:');
        expect(mockEmbed.setColor).toHaveBeenCalled();

        // Check that no fields were added
        expect(mockEmbed.addFields).not.toHaveBeenCalled();

        // Restore the original mock
        vi.doUnmock('../../../src/commands/definitions/index');
    });


});