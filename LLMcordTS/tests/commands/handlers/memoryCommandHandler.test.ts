import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'; // Import Mock
import { ChatInputCommandInteraction } from 'discord.js';
import { MemoryCommandHandler } from '@/commands/handlers/memoryCommandHandler';
// import { IMemoryStorage } from '@/memory/memoryStorage'; // Removed unused import
// import { Config } from '@/core/config'; // Removed unused import
import { logger } from '@/core/logger'; // Use the actual logger instance or a mock

// Mock dependencies
// Mock the logger module to provide a logger object with getSubLogger
const mockLogMethod = vi.fn();
const mockSubLoggerInstance = { // Define the object returned by getSubLogger
    info: mockLogMethod,
    warn: mockLogMethod,
    error: mockLogMethod,
    debug: mockLogMethod,
};
vi.mock('@/core/logger', () => ({
    logger: { // This is the object imported as 'logger'
        info: mockLogMethod,
        warn: mockLogMethod,
        error: mockLogMethod,
        debug: mockLogMethod,
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'info'),
        // Ensure getSubLogger is mocked correctly on the main logger object
        getSubLogger: vi.fn(() => mockSubLoggerInstance),
    }
}));

// Create a mock object adhering to the IMemoryStorage interface, with each method being a vi.fn()
// Create a mock object adhering to the IMemoryManager interface
const mockMemoryManager = {
    getUserMemory: vi.fn(),
    formatSystemPrompt: vi.fn(), // Not used directly by handler, but part of interface
    processMemorySuggestions: vi.fn(), // Not used directly by handler
    addMemory: vi.fn(),
    replaceMemory: vi.fn(),
    clearUserMemory: vi.fn(),
    getMemoryById: vi.fn(),
    updateMemoryById: vi.fn(),
    deleteMemoryById: vi.fn(),
};

// Mock Config (provide a minimal structure) - Removed as it's no longer used by the handler constructor
// const mockConfig = {
//     // Add relevant config properties if the handler uses them directly
// } as Config; // Cast to Config type

// Mock Interaction - Cast the whole object, but ensure mocked methods are typed as Mock
const mockInteraction = {
    user: { id: 'user-123' },
    options: {
        getSubcommand: vi.fn(),
        getString: vi.fn(),
        // Add other necessary option properties with 'as any' to satisfy the type
        data: [] as any,
        get: vi.fn() as any,
        client: {} as any,
        getMentionable: vi.fn() as any,
        getBoolean: vi.fn() as any,
        getChannel: vi.fn() as any,
        getInteger: vi.fn() as any,
        getNumber: vi.fn() as any,
        getRole: vi.fn() as any,
        getUser: vi.fn() as any,
        getAttachment: vi.fn() as any,
        resolved: {} as any,
        _group: null,
        _subcommand: null,
        _hoistedOptions: [],
    },
    reply: vi.fn(),
    followUp: vi.fn(),
    replied: false,
    deferred: false,
    channel: {} as any,
    guild: {} as any,
    commandName: 'memory',
    transformOption: {} as any,
    _cacheType: {} as any,
    // Add other necessary interaction properties with 'as any'
    id: 'interaction-id',
    applicationId: 'app-id',
    type: 2, // ApplicationCommand
    version: 1,
    channelId: 'channel-id',
    guildId: 'guild-id',
    member: {} as any,
    appPermissions: {} as any,
    locale: 'en-US',
    guildLocale: 'en-US',
    createdTimestamp: Date.now(),
    isCommand: vi.fn().mockReturnValue(true),
    isChatInputCommand: vi.fn().mockReturnValue(true),
    // Add other methods with vi.fn() or simple return values as needed
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(),
    fetchReply: vi.fn(),
    // ... add more as required by tests or type checking
} as unknown as ChatInputCommandInteraction;

// Unused variable declarations removed below
// const mockedGetSubcommand = mockInteraction.options.getSubcommand as Mock; // Unused
// const mockedGetString = mockInteraction.options.getString as Mock; // Unused
// const mockedReply = mockInteraction.reply as Mock; // Unused
// const mockedFollowUp = mockInteraction.followUp as Mock; // Unused

describe('MemoryCommandHandler', () => {
    let handler: MemoryCommandHandler;

    beforeEach(() => {
        vi.clearAllMocks(); // Reset mocks before each test
        // Pass the mocked manager and the mocked logger object
        handler = new MemoryCommandHandler(mockMemoryManager, logger);
        // Reset interaction state
        mockInteraction.replied = false;
        mockInteraction.deferred = false;
    });

    // --- Test Cases for Each Subcommand ---

    it('should handle "show" subcommand and display memory', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('show');
        // Mock the new manager method
        mockMemoryManager.getUserMemory.mockResolvedValue([
            { id: 'mem-1', userId: 'user-123', content: 'Existing memory content.', type: 'core', timestamp: new Date() }
        ]);

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.getUserMemory).toHaveBeenCalledWith('user-123');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            // Expect formatted output including ID prefix and type
            content: expect.stringContaining('Your current memory entries:\n```\n[mem-1] (core): Existing memory content.\n```'),
            ephemeral: true,
        });
    });

    it('should handle "show" subcommand when no memory exists', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('show');
        mockMemoryManager.getUserMemory.mockResolvedValue([]); // Return empty array now

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.getUserMemory).toHaveBeenCalledWith('user-123');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'You have no memory stored.',
            ephemeral: true,
        });
    });

     it('should handle "show" subcommand and truncate long memory', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('show');
        const longMemory = 'a'.repeat(2000);
         mockMemoryManager.getUserMemory.mockResolvedValue([
            { id: 'mem-long', userId: 'user-123', content: longMemory, type: 'recall', timestamp: new Date() }
        ]);

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.getUserMemory).toHaveBeenCalledWith('user-123');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            // Expect formatted output including ID prefix and type, truncated
            content: expect.stringContaining(`Your current memory entries:\n\`\`\`\n[mem-lo] (recall): ${longMemory.substring(0, 1900)}... (truncated)\n\`\`\``),
            ephemeral: true,
        });
    });

    it('should handle "append" subcommand', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('append');
        (mockInteraction.options.getString as Mock).mockReturnValue(' Text to append.');

        await handler.handle(mockInteraction);

        // Expect call to addMemory with default type 'recall'
        expect(mockMemoryManager.addMemory).toHaveBeenCalledWith('user-123', ' Text to append.', 'recall');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Text appended to your memory.',
            ephemeral: true,
        });
    });

    it('should handle "replace" subcommand', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('replace');
        (mockInteraction.options.getString as Mock).mockReturnValue('New memory content.');

        await handler.handle(mockInteraction);

        // Expect call to replaceMemory with default type 'core'
        expect(mockMemoryManager.replaceMemory).toHaveBeenCalledWith('user-123', 'New memory content.', 'core');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Your memory has been replaced.',
            ephemeral: true,
        });
    });

    it('should handle "forget" subcommand', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('forget');

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.clearUserMemory).toHaveBeenCalledWith('user-123');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Your memory has been cleared.',
            ephemeral: true,
        });
    });

    // --- Tests for New Subcommands (Edit, Delete, View) ---

    it('should handle "edit" subcommand successfully', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('edit');
        (mockInteraction.options.getString as Mock).mockImplementation((name: string) => {
            if (name === 'id') return 'entry-abc';
            if (name === 'content') return 'Updated content';
            return null;
        });
        mockMemoryManager.updateMemoryById.mockResolvedValue(true); // Simulate success

        await handler.handle(mockInteraction);

        // Expect call to updateMemoryById (userId is not passed)
        expect(mockMemoryManager.updateMemoryById).toHaveBeenCalledWith('entry-abc', { content: 'Updated content' });
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Memory entry `entry-abc` updated successfully.',
            ephemeral: true,
        });
    });

    it('should handle "edit" subcommand when entry is not found', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('edit');
        (mockInteraction.options.getString as Mock).mockImplementation((name: string) => {
            if (name === 'id') return 'entry-xyz';
            if (name === 'content') return 'Some content';
            return null;
        });
        mockMemoryManager.updateMemoryById.mockResolvedValue(false); // Simulate failure (not found)

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.updateMemoryById).toHaveBeenCalledWith('entry-xyz', { content: 'Some content' });
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Could not find or edit memory entry `entry-xyz`. (Note: ID-based editing might not be fully implemented yet).',
            ephemeral: true,
        });
    });

    it('should handle "delete" subcommand successfully', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('delete');
        (mockInteraction.options.getString as Mock).mockReturnValue('entry-123');
        mockMemoryManager.deleteMemoryById.mockResolvedValue(true); // Simulate success

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.deleteMemoryById).toHaveBeenCalledWith('entry-123');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Memory entry `entry-123` deleted successfully.',
            ephemeral: true,
        });
    });

    it('should handle "delete" subcommand when entry is not found', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('delete');
        (mockInteraction.options.getString as Mock).mockReturnValue('entry-456');
        mockMemoryManager.deleteMemoryById.mockResolvedValue(false); // Simulate failure (not found)

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.deleteMemoryById).toHaveBeenCalledWith('entry-456');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Could not find or delete memory entry `entry-456`. (Note: ID-based deletion might not be fully implemented yet).',
            ephemeral: true,
        });
    });

    it('should handle "view" subcommand successfully', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('view');
        (mockInteraction.options.getString as Mock).mockReturnValue('entry-789');
        // Mock the manager method returning an IMemory object
        mockMemoryManager.getMemoryById.mockResolvedValue({
            id: 'entry-789', userId: 'user-123', content: 'Content of entry 789.', type: 'recall', timestamp: new Date()
        });

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.getMemoryById).toHaveBeenCalledWith('entry-789');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            // Expect formatted output including type
            content: 'Memory entry `entry-789` (recall):\n```\nContent of entry 789.\n```',
            ephemeral: true,
        });
    });

     it('should handle "view" subcommand and truncate long entry', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('view');
        (mockInteraction.options.getString as Mock).mockReturnValue('entry-long');
        const longEntry = 'b'.repeat(2000);
        mockMemoryManager.getMemoryById.mockResolvedValue({
             id: 'entry-long', userId: 'user-123', content: longEntry, type: 'core', timestamp: new Date()
        });

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.getMemoryById).toHaveBeenCalledWith('entry-long');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
             // Expect formatted output including type, truncated
            content: `Memory entry \`entry-long\` (core):\n\`\`\`\n${longEntry.substring(0, 1900)}... (truncated)\n\`\`\``,
            ephemeral: true,
        });
    });

    it('should handle "view" subcommand when entry is not found', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('view');
        (mockInteraction.options.getString as Mock).mockReturnValue('entry-abc');
        mockMemoryManager.getMemoryById.mockResolvedValue(null); // Simulate failure (not found)

        await handler.handle(mockInteraction);

        expect(mockMemoryManager.getMemoryById).toHaveBeenCalledWith('entry-abc');
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Could not find memory entry `entry-abc`. (Note: ID-based viewing might not be fully implemented yet).',
            ephemeral: true,
        });
    });

    // --- Error Handling ---

    it('should handle unknown subcommand', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('unknown-subcommand');

        await handler.handle(mockInteraction);

        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'Unknown memory subcommand.',
            ephemeral: true,
        });
    });

    it('should handle errors during storage operations and reply', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('show');
        const testError = new Error('Database connection failed');
        mockMemoryManager.getUserMemory.mockRejectedValue(testError); // Mock manager method

        await handler.handle(mockInteraction);

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Error handling memory command 'show'"), testError);
        expect(mockInteraction.reply).toHaveBeenCalledWith({
            content: 'An error occurred while processing your memory command.',
            ephemeral: true,
        });
    });

     it('should handle errors during storage operations and followUp if already replied/deferred', async () => {
        (mockInteraction.options.getSubcommand as Mock).mockReturnValue('append');
        (mockInteraction.options.getString as Mock).mockReturnValue('some text');
        const testError = new Error('Write failed');
        mockMemoryManager.addMemory.mockRejectedValue(testError); // Mock manager method
        mockInteraction.replied = true; // Simulate already replied

        await handler.handle(mockInteraction);

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Error handling memory command 'append'"), testError);
        expect(mockInteraction.followUp).toHaveBeenCalledWith({
            content: 'An error occurred while processing your memory command.',
            ephemeral: true,
        });
         expect(mockInteraction.reply).not.toHaveBeenCalled();
    });
});