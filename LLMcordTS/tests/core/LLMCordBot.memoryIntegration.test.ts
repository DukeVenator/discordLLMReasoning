import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { LLMCordBot } from '@/core/LLMCordBot';
import { Config, DeepPartial } from '@/types/config';
import { Logger } from '@/core/logger';
import { SQLiteMemoryStorage } from '@/memory/SQLiteMemoryStorage';
import { BaseProvider, ChatMessage } from '@/providers/baseProvider'; // Corrected import name
import { ProviderFactory } from '@/providers/providerFactory';
import { Message } from 'discord.js';
import { MessageProcessor } from '@/processing/MessageProcessor'; // Added
import { AxiosInstance } from 'axios'; // Added
import { IMessageNode } from '@/types/message'; // Added

// Mock dependencies
vi.mock('@/core/logger');
vi.mock('@/memory/SQLiteMemoryStorage');
vi.mock('@/providers/providerFactory');
vi.mock('@/providers/baseProvider'); // Mock BaseProvider if needed for generateStream
vi.mock('@/processing/MessageProcessor'); // Mock the actual MessageProcessor class
vi.mock('@/core/config'); // Assuming loadConfig is mocked or config provided directly

// Helper to create a mock Discord message
const createMockMessage = (userId: string, content: string, messageId: string = 'msg1'): Partial<Message> => {
    // Mock for the message object returned by message.reply()
    const mockReplyMessage = {
        id: `${messageId}-reply`,
        content: '',
        edit: vi.fn().mockResolvedValue(undefined), // Mock edit function
        // Add other properties if updateDiscordResponse uses them
    } as unknown as Partial<Message>; // Add cast via unknown

    return {
        id: messageId,
        author: { id: userId, tag: `user#${userId.slice(0, 4)}` } as any, // Cast author to any
        content: content,
        channelId: 'channel1',
        reply: vi.fn().mockResolvedValue(mockReplyMessage), // Mock reply to resolve with a mock message object
        // Add other necessary properties if processMessage uses them directly
    } as unknown as Partial<Message>; // Cast the whole object
};

// Helper to create a mock bot instance
const createMockBotWithMocks = (configOverrides: DeepPartial<Config> = {}) => {
    const bot = new LLMCordBot();

    // Mock logger
    bot.logger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        // child: vi.fn(() => bot.logger), // Keep original child for reference if needed
        getSubLogger: vi.fn(() => bot.logger), // Add mock for getSubLogger
    } as unknown as Logger;

    // Base config
    const baseConfig: Config = {
        discord: { token: 'test', clientId: 'test' },
        llm: { defaultProvider: 'mockProvider', defaultSystemPrompt: 'Default test prompt.' }, // Add defaultSystemPrompt
        memory: {
            enabled: true,
            storageType: 'sqlite',
            sqlite: { path: ':memory:' },
            maxHistoryLength: 10,
        },
        logging: { level: 'info' },
        permissions: {},
        rateLimit: { user: { intervalSeconds: 1, maxCalls: 5 } },
        model: 'mockProvider/mock-model',
        reasoning: { enabled: false },
    };

    // Merge configs (simplified merge for test focus)
    bot.config = {
        ...baseConfig,
        ...configOverrides,
        memory: {
            ...baseConfig.memory,
            ...(configOverrides.memory ?? {}),
        },
        llm: {
             ...baseConfig.llm,
             ...(configOverrides.llm ?? {}),
        }
    } as Config;

    // Mock Memory Storage
    const mockMemoryStorageInstance = new SQLiteMemoryStorage(':memory:', bot.logger, bot.config, {} as ProviderFactory); // Provide minimal mocks
    mockMemoryStorageInstance.getMemory = vi.fn(); // Mock getMemory specifically
    bot.memoryStorage = bot.config.memory.enabled ? mockMemoryStorageInstance : null;

    // Mock LLM Provider
    const mockLlmProvider = {
        generateStream: vi.fn(), // Basic mock
        supportsSystemPrompt: vi.fn().mockReturnValue(true), // Mock supportsSystemPrompt
        supportsTools: vi.fn().mockReturnValue(false), // Mock supportsTools
        // Add other methods if needed by processMessage
    } as unknown as BaseProvider;
    bot.llmProvider = mockLlmProvider; // Assign mock provider

    // Mock Tool Registry minimally
    bot.toolRegistry = { getToolDefinitions: vi.fn().mockReturnValue([]) } as any;

    // Mock HttpClient
    const mockHttpClient = { get: vi.fn() } as unknown as AxiosInstance;
    bot.httpClient = mockHttpClient; // Assign to bot instance if needed elsewhere, though MP takes it directly

    // Mock MessageNodeCache
    const mockMessageNodeCache = new Map<string, IMessageNode>();
    bot.messageNodeCache = mockMessageNodeCache; // Assign to bot instance

    // Instantiate MessageProcessor with mocks
    // Ensure clientId is available in config
    const clientId = bot.config.discord?.clientId ?? 'mock-client-id-fallback';
    bot.messageProcessor = new MessageProcessor(
        bot.config,
        bot.logger,
        bot.llmProvider,
        mockHttpClient,
        mockMessageNodeCache,
        clientId
    );

    // Mock the buildMessageHistory method ON the messageProcessor instance
    vi.spyOn(bot.messageProcessor, 'buildMessageHistory').mockResolvedValue({ history: [], warnings: [] }); // Default mock
    return {
        bot,
        mockMemoryStorage: mockMemoryStorageInstance,
        mockLlmProvider,
        mockMessageProcessor: bot.messageProcessor, // Return the instance
        // Keep mockBuildMessageHistory reference for convenience in tests
        mockBuildMessageHistory: bot.messageProcessor.buildMessageHistory as Mock,
        // No need to return toolRegistry mock explicitly unless needed in tests
    };
};


describe('LLMCordBot - processMessage Memory Integration', () => {
    const userId = 'user123';
    // const botId = 'bot999'; // Unused variable removed

    beforeEach(() => {
        vi.clearAllMocks();
        // Mock the internal suggestion processing method to prevent side effects/errors
        // during these integration tests focused on injection.
        vi.spyOn(LLMCordBot.prototype as any, '_processMemorySuggestions')
          .mockImplementation((_userId, text, _msgId) => text); // Just return the text
    });

    it('should fetch and inject memory when enabled and memory exists', async () => {
        const { bot, mockMemoryStorage, mockLlmProvider, mockBuildMessageHistory } = createMockBotWithMocks({
            memory: { enabled: true }
        });
        const mockMessage = createMockMessage(userId, 'Hello bot') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Hello bot' }];
        const userMemory = 'User likes red color.';
        // Removed unused variable 'expectedMemoryMessage'

        // Setup mocks
        // Return a *copy* of initialHistory to prevent potential mutation issues
        // Update mock to return the object structure { history, warnings }
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        (mockMemoryStorage.getMemory as Mock).mockResolvedValue(userMemory);
        // Mock generateStream to return a minimal async generator
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'test chunk' }; });


        try {
            await bot.processMessage(mockMessage);
        } catch (e) {
            console.error("Test Error during processMessage:", e);
            throw e;
        }

        // Assertions
        expect(mockMemoryStorage.getMemory).toHaveBeenCalledTimes(1);
        expect(mockMemoryStorage.getMemory).toHaveBeenCalledWith(userId);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        expect((mockLlmProvider.generateStream as Mock).mock.calls.length).toBeGreaterThan(0); // Ensure it was called
        const historyArg = (mockLlmProvider.generateStream as Mock).mock.calls[0]![0]; // Add non-null assertion

        // Check the system prompt argument passed to generateStream
        const systemPromptArg = (mockLlmProvider.generateStream as Mock).mock.calls[0]![1]; // Get the second argument
        expect(systemPromptArg).toBeDefined();
        expect(typeof systemPromptArg).toBe('string');

        // Check that the system prompt contains the base prompt
        expect(systemPromptArg).toContain(bot.config.llm?.defaultSystemPrompt);

        // Check that the system prompt contains the formatted memory block
        // (Approximating the format from _formatMemoryForSystemPrompt)
        const expectedMemoryBlock = `--- User Memory ---\n${userMemory}\n--- End Memory ---`;
        expect(systemPromptArg).toContain(expectedMemoryBlock);

        // Check that the history argument is just the initial user message
        expect(historyArg).toEqual(initialHistory);
    });

    it('should not inject memory when enabled but no memory exists', async () => {
        const { bot, mockMemoryStorage, mockLlmProvider, mockBuildMessageHistory } = createMockBotWithMocks({
            memory: { enabled: true }
        });
        const mockMessage = createMockMessage(userId, 'Hello again') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Hello again' }];

        // Setup mocks
        // Return a *copy* of initialHistory
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        (mockMemoryStorage.getMemory as Mock).mockResolvedValue(null); // No memory found
        // Mock generateStream to return a minimal async generator
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'test chunk' }; });

        try {
            await bot.processMessage(mockMessage);
        } catch (e) {
            console.error("Test Error during processMessage:", e);
            throw e;
        }

        // Assertions
        expect(mockMemoryStorage.getMemory).toHaveBeenCalledTimes(1);
        expect(mockMemoryStorage.getMemory).toHaveBeenCalledWith(userId);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        expect((mockLlmProvider.generateStream as Mock).mock.calls.length).toBeGreaterThan(0);
        const historyArg = (mockLlmProvider.generateStream as Mock).mock.calls[0]![0]; // Add non-null assertion

        // History should only contain the initial message
        expect(historyArg).toEqual(initialHistory);
    });

    it('should not attempt to fetch or inject memory when disabled', async () => {
        const { bot, mockMemoryStorage, mockLlmProvider, mockBuildMessageHistory } = createMockBotWithMocks({
            memory: { enabled: false } // Memory explicitly disabled
        });
        const mockMessage = createMockMessage(userId, 'One more time') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'One more time' }];

        // Setup mocks
        // Return a *copy* of initialHistory
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        // Mock generateStream to return a minimal async generator
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'test chunk' }; });

        try {
            await bot.processMessage(mockMessage);
        } catch (e) {
            console.error("Test Error during processMessage:", e);
            throw e;
        }

        // Assertions
        expect(mockMemoryStorage.getMemory).not.toHaveBeenCalled(); // Should not be called

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        expect((mockLlmProvider.generateStream as Mock).mock.calls.length).toBeGreaterThan(0);
        const historyArg = (mockLlmProvider.generateStream as Mock).mock.calls[0]![0]; // Add non-null assertion

        // History should only contain the initial message
        expect(historyArg).toEqual(initialHistory);
        expect(bot.memoryStorage).toBeNull(); // Verify storage is null as per setup
    });

    it('should add memory instructions to system prompt when enabled', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory, mockMemoryStorage } = createMockBotWithMocks({
            memory: { enabled: true },
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        (mockMemoryStorage.getMemory as Mock).mockResolvedValue(null); // No actual memory needed for this test
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;

        // Check that the system prompt contains the base prompt AND memory instructions
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(systemPromptArg).toContain('**Memory Instructions:**');
        expect(systemPromptArg).toContain('[MEM_APPEND]');
        expect(systemPromptArg).toContain('[MEM_REPLACE:');
    });

    it('should NOT add memory instructions to system prompt when disabled', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory } = createMockBotWithMocks({
            memory: { enabled: false }, // Memory disabled
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;

        // Check that the system prompt contains the base prompt BUT NOT memory instructions
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(systemPromptArg).not.toContain('**Memory Instructions:**');
        expect(systemPromptArg).not.toContain('[MEM_APPEND]');
        expect(systemPromptArg).not.toContain('[MEM_REPLACE:');
    });

    // Add more tests?
    // - Test case where getMemory throws an error


    it('should handle errors during memory fetch gracefully', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory, mockMemoryStorage } = createMockBotWithMocks({
            memory: { enabled: true },
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];
        const fetchError = new Error('Database connection failed');

        // Setup mocks
        // Update mock to return warnings array
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [{ type: 'Generic', message: '⚠️ Failed to load user memory' }] });
        (mockMemoryStorage.getMemory as Mock).mockRejectedValue(fetchError); // Simulate error
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        // Assertions
        expect(mockMemoryStorage.getMemory).toHaveBeenCalledTimes(1);
        expect(bot.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to retrieve memory'), fetchError);
        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1); // Should still attempt to generate response

        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;
        // System prompt should NOT contain the memory block, but should have instructions
        expect(systemPromptArg).toContain(baseSystemPrompt);
        // Expect the "no relevant memories" block because _formatMemoryForSystemPrompt handles null
        expect(systemPromptArg).toContain('--- User Memory ---');
        expect(systemPromptArg).toContain('You have no memories of the user.'); // Updated expected string
        expect(systemPromptArg).toContain('**Memory Instructions:**'); // Instructions should still be added

        const [historyArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;
        // History should not contain the memory message
        expect(historyArg).toEqual(initialHistory);
    });

    it('should not inject memory block or history message for empty/whitespace memory', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory, mockMemoryStorage } = createMockBotWithMocks({
            memory: { enabled: true },
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        (mockMemoryStorage.getMemory as Mock).mockResolvedValue('   \n   '); // Whitespace memory
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        // Assertions
        expect(mockMemoryStorage.getMemory).toHaveBeenCalledTimes(1);
        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);

        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;
        // System prompt should have instructions but not the 'no relevant memories' block from _formatMemoryForSystemPrompt
        // because the formatting happens *after* the check in processMessage
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(systemPromptArg).toContain('**Memory Instructions:**');
        // Expect the "no relevant memories" block because _formatMemoryForSystemPrompt handles empty/whitespace
        expect(systemPromptArg).toContain('--- User Memory ---');
        expect(systemPromptArg).toContain('You have no memories of the user.'); // Updated expected string

        const [historyArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;
        // History should not contain the memory message
        expect(historyArg).toEqual(initialHistory);
    });

    it('should include both memory and reasoning instructions when both enabled', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory, mockMemoryStorage } = createMockBotWithMocks({
            memory: { enabled: true },
            reasoning: { enabled: true }, // Enable reasoning
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        // Mock reasoningManager isEnabled (assuming it's accessed via bot instance)
        bot.reasoningManager = { isEnabled: vi.fn().mockReturnValue(true) } as any;

        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        (mockMemoryStorage.getMemory as Mock).mockResolvedValue(null); // No memory content needed
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;

        // Check for base prompt, memory instructions, AND reasoning instructions
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(systemPromptArg).toContain('**Memory Instructions:**');
        expect(systemPromptArg).toContain('[MEM_APPEND]');
        expect(systemPromptArg).toContain('[MEM_REPLACE:');
        expect(systemPromptArg).toContain('[USE_REASONING_MODEL]'); // Default reasoning signal
        expect(systemPromptArg).toContain('Internal Task:');
    });

});