import { describe, it, expect, vi, beforeEach } from 'vitest'; // Removed afterEach
import { LLMCordBot } from '@/core/LLMCordBot';
import { Config, DeepPartial } from '@/types/config';
import { Logger } from '@/core/logger'; // Keep import if type is needed elsewhere
import { SQLiteMemoryStorage } from '@/memory/SQLiteMemoryStorage';
// import { ChatMessage } from '@/providers/baseProvider'; // Removed unused import

// Mock dependencies
import { ProviderFactory } from '@/providers/providerFactory'; // Needed for memory storage constructor

// Mock dependencies
// vi.mock('@/core/logger'); // Remove or comment out module mock for logger
vi.mock('@/memory/SQLiteMemoryStorage');
vi.mock('@/providers/providerFactory'); // Mock provider factory
vi.mock('@/core/config'); // Assuming loadConfig is mocked elsewhere or we provide config directly


// Helper to create a mock bot instance with specific config overrides
const createMockBot = (configOverrides: DeepPartial<Config> = {}): LLMCordBot => {
    const bot = new LLMCordBot(); // Constructor doesn't do much heavy lifting

    // Mock essential properties that would be set during initialize()
    // Create a simple mock logger object directly
    bot.logger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(() => bot.logger), // Mock child to return itself if needed
    } as unknown as Logger; // Cast to Logger type

    // Define base config structure
    const baseConfig: Config = {
        discord: { token: 'test', clientId: 'test' },
        llm: { defaultProvider: 'mock' },
        memory: {
            enabled: true,
            storageType: 'sqlite',
            sqlite: { path: ':memory:' },
            suggestions: { stripFromResponse: true }, // Default suggestions
            maxHistoryLength: 25,
            maxImages: 2,
        },
        logging: { level: 'info' },
        permissions: {},
        rateLimit: { user: { intervalSeconds: 1, maxCalls: 1 } },
        model: 'mock/mock-model',
        reasoning: { enabled: false },
        // Add other defaults as needed
    };

    // Perform a safer merge for memory section and other potentially nested sections
    bot.config = {
        ...baseConfig,
        ...configOverrides, // Apply top-level overrides first (e.g., logging level)
        memory: { // Merge memory section carefully
            ...baseConfig.memory, // Start with base memory defaults
            ...(configOverrides.memory ?? {}), // Apply overrides for memory (like enabled)
            suggestions: { // Merge suggestions specifically
                ...(baseConfig.memory.suggestions ?? {}), // Start with base suggestions
                ...(configOverrides.memory?.suggestions ?? {}), // Apply suggestion overrides
            },
            // Ensure sqlite path isn't lost if only suggestions are overridden
            sqlite: {
                 ...(baseConfig.memory.sqlite ?? {}),
                 ...(configOverrides.memory?.sqlite ?? {}),
            }
        },
        logging: { // Merge logging
            ...(baseConfig.logging ?? {}),
            ...(configOverrides.logging ?? {}),
        },
        llm: { // Merge llm
             ...(baseConfig.llm ?? {}),
             ...(configOverrides.llm ?? {}),
        }
        // Add merges for other nested sections if they exist and are overridden in tests
    } as Config; // Cast remains necessary due to partial nature

    // Mock memoryStorage if enabled (check the potentially overridden config)
    if (bot.config.memory.enabled) {
        // Use the mocked constructor for SQLiteMemoryStorage
        // We need to ensure ProviderFactory is mocked or provide a valid mock
        const mockProviderFactory = new ProviderFactory(bot.config); // Use mocked ProviderFactory
        const mockMemoryStorageInstance = new SQLiteMemoryStorage(':memory:', bot.logger, bot.config, mockProviderFactory);
        bot.memoryStorage = mockMemoryStorageInstance;

        // Mock the specific methods we expect to be called on the instance
        // Provide 'undefined' for Promise<void> resolution
        vi.spyOn(mockMemoryStorageInstance, 'appendMemory').mockResolvedValue(undefined);
        vi.spyOn(mockMemoryStorageInstance, 'setMemory').mockResolvedValue(undefined);
    } else {
        bot.memoryStorage = null;
    }

    return bot;
};

describe('LLMCordBot - _processMemorySuggestions', () => {
    let bot: LLMCordBot;
    const userId = 'user123';
    const messageId = 'msg456';

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
    });

    it('should append memory and strip default tags by default', () => {
        bot = createMockBot(); // Use default config (strip: true, default markers)
        const responseText = "Here is the info. [MEM_APPEND]User likes dogs.[/MEM_APPEND] Got it?";
        const expectedResponse = "Here is the info. Got it?";
        const expectedMemoryContent = "User likes dogs.";

        // Access private method for testing (common pattern)
        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        expect(bot.memoryStorage?.appendMemory).toHaveBeenCalledTimes(1);
        expect(bot.memoryStorage?.appendMemory).toHaveBeenCalledWith(userId, expectedMemoryContent);
        expect(bot.memoryStorage?.setMemory).not.toHaveBeenCalled();
        expect(bot.logger.info).toHaveBeenCalledWith(expect.stringContaining('Found memory append suggestion'));
        expect(bot.logger.debug).toHaveBeenCalledWith(expect.stringContaining('Stripped memory suggestion tags'));
    });

    it('should replace memory and strip default tags by default', () => {
        bot = createMockBot();
        const responseText = "Okay, replacing memory. [MEM_REPLACE]User prefers cats now.[/MEM_REPLACE] All set.";
        const expectedResponse = "Okay, replacing memory. All set.";
        const expectedMemoryContent = "User prefers cats now.";

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        expect(bot.memoryStorage?.setMemory).toHaveBeenCalledTimes(1);
        expect(bot.memoryStorage?.setMemory).toHaveBeenCalledWith(userId, expectedMemoryContent);
        expect(bot.memoryStorage?.appendMemory).not.toHaveBeenCalled();
        expect(bot.logger.info).toHaveBeenCalledWith(expect.stringContaining('Found memory replace suggestion'));
        expect(bot.logger.debug).toHaveBeenCalledWith(expect.stringContaining('Stripped memory suggestion tags'));
    });

     it('should prioritize replace over append if both tags exist', () => {
        bot = createMockBot();
        const responseText = "Complex update: [MEM_APPEND]Add this.[/MEM_APPEND] But also [MEM_REPLACE]Replace with this.[/MEM_REPLACE] Done.";
        const expectedResponse = "Complex update: But also Done.";
        const expectedMemoryContent = "Replace with this.";

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        expect(bot.memoryStorage?.setMemory).toHaveBeenCalledTimes(1);
        expect(bot.memoryStorage?.setMemory).toHaveBeenCalledWith(userId, expectedMemoryContent);
        expect(bot.memoryStorage?.appendMemory).not.toHaveBeenCalled(); // Append should be ignored
        expect(bot.logger.info).toHaveBeenCalledWith(expect.stringContaining('Found memory replace suggestion'));
        expect(bot.logger.debug).toHaveBeenCalledWith(expect.stringContaining('Stripped memory suggestion tags'));
    });

    it('should handle multiple append tags and join content', () => {
        bot = createMockBot();
        const responseText = "Fact 1: [MEM_APPEND]A is 1.[/MEM_APPEND] Fact 2: [MEM_APPEND]B is 2.[/MEM_APPEND] Summary complete.";
        const expectedResponse = "Fact 1: Fact 2: Summary complete.";
        const expectedMemoryContent = "A is 1.\nB is 2."; // Joined with newline

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        expect(bot.memoryStorage?.appendMemory).toHaveBeenCalledTimes(1);
        expect(bot.memoryStorage?.appendMemory).toHaveBeenCalledWith(userId, expectedMemoryContent);
        expect(bot.memoryStorage?.setMemory).not.toHaveBeenCalled();
    });

     it('should handle multiple replace tags and join content (last one wins implicitly via setMemory)', () => {
        bot = createMockBot();
        // Note: While multiple replace tags are parsed, setMemory overwrites, so effectively the *content* is joined, but the *action* is a single replace.
        const responseText = "Update: [MEM_REPLACE]Old info.[/MEM_REPLACE] Correction: [MEM_REPLACE]New info.[/MEM_REPLACE]";
        const expectedResponse = "Update: Correction:";
        const expectedMemoryContent = "Old info.\nNew info."; // Content is joined before the single setMemory call

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        expect(bot.memoryStorage?.setMemory).toHaveBeenCalledTimes(1);
        expect(bot.memoryStorage?.setMemory).toHaveBeenCalledWith(userId, expectedMemoryContent);
        expect(bot.memoryStorage?.appendMemory).not.toHaveBeenCalled();
    });

    it('should not strip tags if configured with stripFromResponse: false', () => {
        bot = createMockBot({ memory: { enabled: true, suggestions: { stripFromResponse: false } } });
        const responseText = "Info: [MEM_APPEND]Keep this tag.[/MEM_APPEND]";
        const expectedResponse = "Info: [MEM_APPEND]Keep this tag.[/MEM_APPEND]"; // Tags remain
        const expectedMemoryContent = "Keep this tag.";

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        expect(bot.memoryStorage?.appendMemory).toHaveBeenCalledTimes(1);
        expect(bot.memoryStorage?.appendMemory).toHaveBeenCalledWith(userId, expectedMemoryContent);
        expect(bot.logger.debug).toHaveBeenCalledWith(expect.stringContaining('Memory suggestion tags processed but configured not to strip.'));
        expect(bot.logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Stripped memory suggestion tags'));

    });

    it('should use custom markers if configured', () => {
        bot = createMockBot({
            memory: {
                suggestions: {
                    appendMarkerStart: '<APPEND>',
                    appendMarkerEnd: '</APPEND>',
                    replaceMarkerStart: '<REPLACE>',
                    replaceMarkerEnd: '</REPLACE>',
                    stripFromResponse: true,
                }
            }
        });
        const responseText = "Data: <APPEND>Custom append.</APPEND> More data: <REPLACE>Custom replace.</REPLACE>";
        const expectedResponse = "Data: More data:";
        const expectedReplaceContent = "Custom replace."; // Replace takes priority

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        expect(bot.memoryStorage?.setMemory).toHaveBeenCalledTimes(1);
        expect(bot.memoryStorage?.setMemory).toHaveBeenCalledWith(userId, expectedReplaceContent);
        expect(bot.memoryStorage?.appendMemory).not.toHaveBeenCalled();
        expect(bot.logger.debug).toHaveBeenCalledWith(expect.stringContaining('Stripped memory suggestion tags'));
    });

    it('should do nothing if memory is disabled', () => {
        bot = createMockBot({ memory: { enabled: false } });
        const responseText = "Some response [MEM_APPEND]with tags[/MEM_APPEND]";

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(responseText); // Response unchanged
        expect(bot.memoryStorage).toBeNull(); // Storage should be null
    });

     it('should do nothing if memory storage is not initialized (error case)', () => {
        bot = createMockBot();
        bot.memoryStorage = null; // Simulate initialization failure
        const responseText = "Some response [MEM_APPEND]with tags[/MEM_APPEND]";

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(responseText); // Response unchanged
        expect(bot.logger.info).not.toHaveBeenCalled();
        expect(bot.logger.debug).not.toHaveBeenCalled();
    });

    it('should handle response with no memory tags', () => {
        bot = createMockBot();
        const responseText = "Just a regular response.";

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(responseText);
        expect(bot.memoryStorage?.appendMemory).not.toHaveBeenCalled();
        expect(bot.memoryStorage?.setMemory).not.toHaveBeenCalled();
        expect(bot.logger.info).not.toHaveBeenCalled();
        expect(bot.logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Stripped memory suggestion tags'));
    });

    it('should handle tags with empty content', () => {
        bot = createMockBot();
        const responseText = "Empty tags: [MEM_APPEND][/MEM_APPEND] and [MEM_REPLACE][/MEM_REPLACE]";
        const expectedResponse = "Empty tags: and";

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        // Should log the processing but not call storage methods with empty content
        expect(bot.memoryStorage?.appendMemory).not.toHaveBeenCalled();
        expect(bot.memoryStorage?.setMemory).not.toHaveBeenCalled();
        expect(bot.logger.info).toHaveBeenCalledWith(expect.stringContaining('Found memory replace suggestion')); // Replace is checked first
        expect(bot.logger.debug).toHaveBeenCalledWith(expect.stringContaining('Stripped memory suggestion tags'));
    });

     it('should handle tags with only whitespace content', () => {
        bot = createMockBot();
        const responseText = "Whitespace tags: [MEM_APPEND] \n \t [/MEM_APPEND]";
        const expectedResponse = "Whitespace tags:";

        const result = (bot as any)._processMemorySuggestions(userId, responseText, messageId);

        expect(result).toBe(expectedResponse);
        // Should log the processing but not call storage methods with empty/whitespace content
        expect(bot.memoryStorage?.appendMemory).not.toHaveBeenCalled();
        expect(bot.memoryStorage?.setMemory).not.toHaveBeenCalled();
        expect(bot.logger.info).toHaveBeenCalledWith(expect.stringContaining('Found memory append suggestion'));
        expect(bot.logger.debug).toHaveBeenCalledWith(expect.stringContaining('Stripped memory suggestion tags'));
    });
});


describe('LLMCordBot - _formatMemoryForSystemPrompt', () => {
    let bot: LLMCordBot;

    beforeEach(() => {
        // Create a basic bot instance for each test
        bot = createMockBot();
    });

    it('should return formatted block for non-empty memory', () => {
        const memory = 'User likes pineapples.\nUser lives in Brisbane.';
        const expected = '\n\n--- User Memory ---\nUser likes pineapples.\nUser lives in Brisbane.\n--- End Memory ---';
        const result = (bot as any)._formatMemoryForSystemPrompt(memory);
        expect(result).toBe(expected);
    });

    it('should return "no relevant memories" block for null memory', () => {
        const expected = '\n\n--- User Memory ---\nYou have no memories of the user.\n--- End Memory ---'; // Updated expected string
        const result = (bot as any)._formatMemoryForSystemPrompt(null);
        expect(result).toBe(expected);
    });

    it('should return "no relevant memories" block for empty string memory', () => {
        const expected = '\n\n--- User Memory ---\nYou have no memories of the user.\n--- End Memory ---'; // Updated expected string
        const result = (bot as any)._formatMemoryForSystemPrompt('');
        expect(result).toBe(expected);
    });

    it('should return "no relevant memories" block for whitespace memory', () => {
        const expected = '\n\n--- User Memory ---\nYou have no memories of the user.\n--- End Memory ---'; // Updated expected string
        const result = (bot as any)._formatMemoryForSystemPrompt('  \n  ');
        expect(result).toBe(expected);
    });

    it('should escape backticks in memory content', () => {
        const memory = 'User mentioned ```code block``` example.';
        const expected = '\n\n--- User Memory ---\nUser mentioned \\`\\`\\`code block\\`\\`\\` example.\n--- End Memory ---';
        const result = (bot as any)._formatMemoryForSystemPrompt(memory);
        expect(result).toBe(expected);
    });
});

// Removed describe block for _formatMemoryForHistory as the method was removed from LLMCordBot

// TODO: Add tests for processMessage focusing on the *injection* points
// - Mock buildMessageHistory to return known history
// - Mock memoryStorage.getMemory to return known memory or null
// - Spy on _formatMemoryForHistory and _formatMemoryForSystemPrompt
// - Mock llmProvider.generateStream
// - Assert that the history passed to generateStream contains the formatted memory (if any)
// - Assert that the system prompt passed to generateStream contains the formatted memory block (if any)
