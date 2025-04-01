import { describe, it, expect, vi } from 'vitest';
import { handlePing } from '../../../src/commands/handlers/pingHandler';
import { CommandInteraction } from 'discord.js';

// Mock the CommandInteraction
const mockInteraction = {
    reply: vi.fn(),
    // Add other properties/methods if needed by the handler
} as unknown as CommandInteraction;

describe('pingHandler', () => {
    it('should reply with "Pong!"', async () => {
        // Reset mock before test
        vi.clearAllMocks();

        await handlePing(mockInteraction);

        // Assert that reply was called correctly
        expect(mockInteraction.reply).toHaveBeenCalledOnce();
        expect(mockInteraction.reply).toHaveBeenCalledWith('Pong!');
    });

    it('should handle potential errors during reply', async () => {
        // Reset mock before test
        vi.clearAllMocks();

        // Simulate an error during reply
        const testError = new Error('Discord API error');
        mockInteraction.reply = vi.fn().mockRejectedValueOnce(testError);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // Suppress console error during test

        // Expect the handler to throw or handle the error gracefully
        // Since handlePing doesn't have explicit error handling *within* it for reply,
        // we expect the error to propagate up (which would be caught by the SlashCommandHandler)
        await expect(handlePing(mockInteraction)).rejects.toThrow(testError);

        // Verify reply was still attempted
        expect(mockInteraction.reply).toHaveBeenCalledOnce();
        consoleSpy.mockRestore(); // Restore console.error
    });
});