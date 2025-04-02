// LLMcordTS/tests/core/LLMCordBot.capabilities.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMCordBot } from '../../src/core/LLMCordBot.js'; // Added .js extension
import { BaseProvider, ChatMessage } from '../../src/providers/baseProvider.js'; // Removed unused ChatMessageContentPartText
import { Config } from '../../src/types/config.js'; // Added .js extension
import { Message, Collection, Attachment } from 'discord.js'; // Added Collection, Attachment
import { ProviderFactory } from '../../src/providers/providerFactory.js'; // Added .js extension
import { loadConfig } from '../../src/core/config.js'; // Added .js extension
import { Logger } from '@/core/logger'; // Import the actual Logger for spyOn
import { ToolRegistry } from '../../src/core/toolRegistry.js'; // Import ToolRegistry for mocking
import { MessageProcessor } from '../../src/processing/MessageProcessor.js'; // Added
import { AxiosInstance } from 'axios';
import { IMessageNode } from '../../src/types/message.js'; // Removed unused IWarning
// Removed duplicate imports added in previous step

// Mock dependencies using relative paths if needed by vi.mock
vi.mock('../../src/core/config.js'); // Added .js extension
// Mock Logger with necessary methods
const mockLoggerInstance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn().mockReturnValue('info'), // Mock getLevel to return a default
    createChildLogger: vi.fn().mockReturnThis(), // Mock child logger creation if needed
    getSubLogger: vi.fn().mockReturnThis(), // Mock sub-logger creation
    trace: vi.fn(),
    fatal: vi.fn(),
};
// Logger will be mocked using vi.spyOn in beforeEach
vi.mock('../../src/providers/providerFactory.js'); // Added .js extension
vi.mock('../../src/memory/SQLiteMemoryStorage.js'); // Added .js extension
vi.mock('../../src/status/statusManager.js'); // Added .js extension
vi.mock('../../src/discord/slashCommandHandler.js'); // Added .js extension
vi.mock('../../src/utils/rateLimiter.js'); // Added .js extension
vi.mock('../../src/core/toolRegistry.js'); // Mock ToolRegistry
// REMOVED: vi.mock('../../src/processing/MessageProcessor.js'); // Don't mock the class we are testing indirectly or directly
vi.mock('../../src/processing/MessageProcessor.js'); // Mock MessageProcessor class
vi.mock('discord.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('discord.js')>();
    return {
        ...actual,
        Client: vi.fn(() => ({
            on: vi.fn(),
            login: vi.fn().mockResolvedValue('mock-token'),
            user: { id: 'mock-bot-id', toString: () => '<@mock-bot-id>' },
            destroy: vi.fn(),
            isReady: vi.fn().mockReturnValue(true),
        })),
        EmbedBuilder: vi.fn(() => ({
            setDescription: vi.fn().mockReturnThis(),
            setColor: vi.fn().mockReturnThis(),
        })),
        ChannelType: actual.ChannelType,
        GatewayIntentBits: actual.GatewayIntentBits,
        Partials: actual.Partials,
    };
});

// Helper to create a mock Message
const createMockMessage = (content: string, id: string, authorId: string = 'user123', authorBot: boolean = false, replyToId: string | null = null): Message => {
    const mockMsg = {
        id: id,
        content: content,
        author: { id: authorId, bot: authorBot, tag: 'User#1234', displayName: 'User' },
        channel: {
            id: 'channel123',
            type: 0, // GUILD_TEXT
            messages: {
                fetch: vi.fn().mockImplementation(async (fetchId) => {
                    if (replyToId && fetchId === replyToId) {
                        return createMockMessage('Parent message', replyToId, 'user456');
                    }
                    throw new Error('Message not found');
                }),
            },
            send: vi.fn().mockResolvedValue({ id: `reply-${id}`, edit: vi.fn() }),
            isTextBased: vi.fn().mockReturnValue(true),
        },
        reply: vi.fn().mockResolvedValue({ id: `reply-${id}`, edit: vi.fn() }),
        reference: replyToId ? { messageId: replyToId } : null,
        attachments: new Map(),
        toString: () => `<@${authorId}>`,
    } as unknown as Message;
    return mockMsg;
};


describe('LLMCordBot Capability Handling', () => {
    let bot: LLMCordBot;
    let mockProvider: BaseProvider;
    let MockProviderFactory: typeof ProviderFactory;
    let mockLoadConfig: typeof loadConfig;
    let MockToolRegistry: typeof ToolRegistry; // Add type for mocked ToolRegistry
    let mockToolRegistryInstance: { // Define shape for the mock instance
        loadTools: ReturnType<typeof vi.fn>;
        getToolDefinitions: ReturnType<typeof vi.fn>;
        executeTool: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
        vi.clearAllMocks();

        // Import mocked types/classes AFTER vi.mock calls
        MockProviderFactory = (await import('../../src/providers/providerFactory.js')).ProviderFactory; // Added .js extension
        mockLoadConfig = (await import('../../src/core/config.js')).loadConfig; // Added .js extension
        MockToolRegistry = (await import('../../src/core/toolRegistry.js')).ToolRegistry; // Import mocked ToolRegistry

        // Define the mock instance for ToolRegistry
        mockToolRegistryInstance = {
            loadTools: vi.fn().mockResolvedValue(undefined), // Mock loadTools
            getToolDefinitions: vi.fn().mockReturnValue([]), // Mock getToolDefinitions to return empty array by default
            executeTool: vi.fn().mockResolvedValue('mock tool result'), // Mock executeTool
        };

        // Mock the ToolRegistry constructor and methods
        vi.mocked(MockToolRegistry).mockImplementation(() => mockToolRegistryInstance as any); // Return our mock instance

        mockProvider = {
            supportsVision: vi.fn().mockReturnValue(false),
            supportsSystemPrompt: vi.fn().mockReturnValue(true),
            supportsTools: vi.fn().mockReturnValue(false), // Add mock for supportsTools
            supportsUsernames: vi.fn().mockReturnValue(false), // Added mock
            supportsStreaming: vi.fn().mockReturnValue(true), // Added mock
            generateStream: vi.fn().mockImplementation(async function* () {
                yield { content: 'Mock response', isFinal: true, finishReason: 'stop' };
            }),
            getProviderInfo: vi.fn().mockReturnValue({ provider: 'mock', model: 'test-model' }),
        };

        // Mock the factory implementation AFTER importing it
        // Add 'config' back but cast to any to bypass private check
        vi.mocked(MockProviderFactory).mockImplementation(() => ({
            config: {} as Config, // Add dummy config property
            getDefaultProvider: vi.fn().mockReturnValue(mockProvider),
            getProvider: vi.fn().mockReturnValue(mockProvider),
        } as any)); // Cast to any

        // Mock config loading AFTER importing it
        // Add missing memory.storageType
        vi.mocked(mockLoadConfig).mockResolvedValue({
            discord: { token: 'mock-token', clientId: 'mock-client-id', streaming_update_interval_ms: 1500, use_plain_responses: false },
            llm: { defaultProvider: 'mock-provider', defaultSystemPrompt: 'Test System Prompt', requestTimeoutMs: 10000, defaultMaxTokens: 4000, maxAttachmentSizeBytes: 10485760 },
            memory: { enabled: false, storageType: 'sqlite', maxHistoryLength: 25, sqlite: { path: 'dummy.db' } }, // Added storageType
            reasoning: { enabled: false },
            logging: { level: 'info' }, // Changed 'silent' to a valid level 'info'
            permissions: { allowAll: true },
            // Corrected rateLimit property names
            rateLimit: { user: { maxCalls: 5, intervalSeconds: 60 }, global: { maxCalls: 100, intervalSeconds: 60 } },
            model: 'mock-provider/test-model', // Corrected model to be a string
            // providers: { 'mock-provider': { type: 'mock', apiKey: 'mock', model: 'test-model' } }, // Keep providers separate if needed by factory mock logic, or remove if unused
        } as Config); // Cast to Config

        // Spy on Logger.createRootLogger before creating the bot instance
        vi.spyOn(Logger, 'createRootLogger').mockReturnValue(mockLoggerInstance as any as Logger); // Cast to bypass private props check
        bot = new LLMCordBot();
        await bot.initialize();
        bot.llmProvider = mockProvider;

        // Add MessageProcessor instantiation for the first describe block
        const mockHttpClient = { get: vi.fn() } as unknown as AxiosInstance;
        const mockMessageNodeCache = new Map<string, IMessageNode>();
        const clientId = bot.config.discord?.clientId ?? 'mock-client-id-fallback';
        bot.httpClient = mockHttpClient; // Assign if needed by other parts of initialize/bot
        bot.messageNodeCache = mockMessageNodeCache; // Assign if needed

        // Instantiate the REAL MessageProcessor
        bot.messageProcessor = new MessageProcessor(
            bot.config,
            bot.logger,
            bot.llmProvider,
            mockHttpClient,
            mockMessageNodeCache,
            clientId
        );

        // Mock buildMessageHistory for tests in this block, as they focus on processMessage logic AFTER history build
        vi.spyOn(bot.messageProcessor, 'buildMessageHistory').mockResolvedValue({
             history: [{ role: 'user', content: 'Hello bot' }], // Use content relevant to the test
             warnings: []
        });
    });

    it('should pass system prompt directly if provider supports it', async () => {
        vi.mocked(mockProvider.supportsSystemPrompt).mockReturnValue(true);
        const message = createMockMessage('Hello bot', 'msg1');

        // Mock buildMessageHistory for this specific test run if needed, otherwise rely on beforeEach mock
        // vi.spyOn(bot.messageProcessor, 'buildMessageHistory').mockResolvedValueOnce({ history: [{ role: 'user', content: 'Hello bot' }], warnings: [] });
        await bot.processMessage(message);

        expect(mockProvider.generateStream).toHaveBeenCalled();
        const callArgs = vi.mocked(mockProvider.generateStream).mock.calls[0];
        expect(callArgs).toBeDefined();
        if (!callArgs) return;

        expect(callArgs[0]).toBeInstanceOf(Array);
        // Expect the combined prompt (base + memory block + instructions)
        // Removed unused variable expectedSystemPrompt
        // Check system prompt contains relevant parts, exact match might be brittle
        expect(callArgs[1]).toContain('Test System Prompt'); // Base prompt
        expect(callArgs[1]).toContain('You have no memories of the user.'); // Default memory block when no memory fetched
    });

    it('should prepend system prompt if provider does NOT support it', async () => {
        vi.mocked(mockProvider.supportsSystemPrompt).mockReturnValue(false);
        const message = createMockMessage('Hello bot', 'msg1');

        // Mock buildMessageHistory for this specific test run if needed
        // vi.spyOn(bot.messageProcessor, 'buildMessageHistory').mockResolvedValueOnce({ history: [{ role: 'user', content: 'Hello bot' }], warnings: [] });
        await bot.processMessage(message);

        expect(mockProvider.generateStream).toHaveBeenCalled();
        const callArgs = vi.mocked(mockProvider.generateStream).mock.calls[0];
        expect(callArgs).toBeDefined();
        if (!callArgs) return;

        expect(callArgs[0]).toBeInstanceOf(Array);

        const modifiedHistory = callArgs[0] as ChatMessage[];
        const firstUserMessage = modifiedHistory.find(m => m.role === 'user');
        expect(firstUserMessage).toBeDefined();
        // Expect the combined prefix (base + memory block + instructions) followed by the separator
        const expectedPrefix = 'Test System Prompt\n\n--- User Memory ---\nYou have no memories of the user.\n--- End Memory ---'; // Default memory block
        const expectedSeparator = "\n\n---\n\n";
        expect(firstUserMessage?.content).toContain(`${expectedPrefix.trim()}${expectedSeparator}`);
        expect(firstUserMessage?.content).toContain('Hello bot');

        expect(callArgs[1]).toBeUndefined();
    });

    // TODO: Add tests for vision support


describe('LLMCordBot buildMessageHistory', () => {
    let bot: LLMCordBot;
    let mockProvider: BaseProvider;
    let MockProviderFactory: typeof ProviderFactory;
    let mockLoadConfig: typeof loadConfig;

    // Helper to create mock attachments
    const createMockAttachment = (id: string, name: string, contentType: string, size: number, url: string) => ({
        id,
        name,
        contentType,
        size,
        url,
    });

    // Helper to create a mock Message with attachments
    const createMockMessageWithAttachments = (
        content: string,
        id: string,
        attachments: ReturnType<typeof createMockAttachment>[],
        authorId: string = 'user123',
        authorBot: boolean = false,
        replyToId: string | null = null
    ): Message => {
        const mockMsg = createMockMessage(content, id, authorId, authorBot, replyToId);
        // Use Collection instead of Map
        mockMsg.attachments = new Collection<string, Attachment>(attachments.map(att => [att.id, att as Attachment]));
        return mockMsg;
    };

    beforeEach(async () => {
        vi.clearAllMocks();

        MockProviderFactory = (await import('../../src/providers/providerFactory.js')).ProviderFactory;
        mockLoadConfig = (await import('../../src/core/config.js')).loadConfig;

        mockProvider = {
            supportsVision: vi.fn().mockReturnValue(true), // Assume vision support for these tests
            supportsSystemPrompt: vi.fn().mockReturnValue(true),
            supportsTools: vi.fn().mockReturnValue(false),
            supportsUsernames: vi.fn().mockReturnValue(false), // Added mock
            supportsStreaming: vi.fn().mockReturnValue(true), // Added mock
            generateStream: vi.fn().mockImplementation(async function* () {
                yield { content: 'Mock response', isFinal: true, finishReason: 'stop' };
            }),
            getProviderInfo: vi.fn().mockReturnValue({ provider: 'mock', model: 'test-model' }),
        };

        vi.mocked(MockProviderFactory).mockImplementation(() => ({
            config: {} as Config,
            getDefaultProvider: vi.fn().mockReturnValue(mockProvider),
            getProvider: vi.fn().mockReturnValue(mockProvider),
        } as any));

        // Default mock config for history tests
        const baseConfig: Config = {
            discord: { token: 'mock-token', clientId: 'mock-client-id' },
            llm: { defaultProvider: 'mock-provider', requestTimeoutMs: 5000, maxAttachmentSizeBytes: 10 * 1024 * 1024 },
            memory: { enabled: false, storageType: 'sqlite', maxHistoryLength: 5, maxImages: 2, sqlite: { path: 'dummy.db' } }, // Default maxImages = 2
            logging: { level: 'info' },
            permissions: {}, // Simplified
            rateLimit: { user: { maxCalls: 5, intervalSeconds: 60 } },
            model: 'mock-provider/test-model',
        };
        vi.mocked(mockLoadConfig).mockResolvedValue(baseConfig);

        // Mock HTTP client for fetching images
        const mockAxiosInstance = {
            get: vi.fn().mockResolvedValue({ status: 200, data: Buffer.from('mockimagedata').toString('base64') })
        };

        // Spy on Logger.createRootLogger before creating the bot instance
        vi.spyOn(Logger, 'createRootLogger').mockReturnValue(mockLoggerInstance as any as Logger); // Cast to bypass private props check
        bot = new LLMCordBot();
        await bot.initialize();
        bot.llmProvider = mockProvider;
        bot.httpClient = mockAxiosInstance as any; // Assign mock axios
        bot.messageNodeCache = new Map<string, IMessageNode>(); // Recreate cache

        // Instantiate MessageProcessor
        const clientId = bot.config.discord?.clientId ?? 'mock-client-id-fallback';
        bot.messageProcessor = new MessageProcessor(
            bot.config,
            bot.logger,
            bot.llmProvider,
            bot.httpClient,
            bot.messageNodeCache,
            clientId
        );
        // Ensure messageNodeCache is cleared specifically for this describe block's tests
        bot.messageNodeCache.clear();
    });

    it('should include images up to the configured limit (maxImages = 2)', async () => {
        // Config already mocked with maxImages: 2 in beforeEach
        const attachments = [
            createMockAttachment('att1', 'img1.png', 'image/png', 1000, 'http://example.com/img1.png'),
            createMockAttachment('att2', 'img2.jpg', 'image/jpeg', 1000, 'http://example.com/img2.jpg'),
            createMockAttachment('att3', 'img3.gif', 'image/gif', 1000, 'http://example.com/img3.gif'),
        ];
        const message = createMockMessageWithAttachments('Message with 3 images', 'msg-img-1', attachments);

        const { history, warnings } = await bot.messageProcessor.buildMessageHistory(message); // Use processor

        expect(history.length).toBe(1);
        // Add check before accessing history[0]
        expect(history[0]).toBeDefined();
        const messageContent = history[0]?.content;
        expect(Array.isArray(messageContent)).toBe(true);
        if (!Array.isArray(messageContent)) return; // Type guard

        const imageParts = messageContent.filter(part => part.type === 'image');
        expect(imageParts.length).toBe(2); // Should be limited to 2
        expect(warnings.some(w => w.message === 'Message msg-img-1 images truncated to 2.')).toBe(true); // Updated warning check
    });

    it('should include all images if below the configured limit (maxImages = 5)', async () => {
        // Override config for this test
        const testConfig = await mockLoadConfig(''); // Get base config
        testConfig.memory.maxImages = 5;
        vi.mocked(mockLoadConfig).mockResolvedValue(testConfig);
        // Re-initialize bot with new config (or manually set config property if easier)
        bot.config = testConfig; // Manually update config for simplicity here
        bot.messageNodeCache.clear();

        const attachments = [
            createMockAttachment('att1', 'img1.png', 'image/png', 1000, 'http://example.com/img1.png'),
            createMockAttachment('att2', 'img2.jpg', 'image/jpeg', 1000, 'http://example.com/img2.jpg'),
        ];
        const message = createMockMessageWithAttachments('Message with 2 images', 'msg-img-2', attachments);

        const { history, warnings } = await bot.messageProcessor.buildMessageHistory(message); // Use processor

        expect(history.length).toBe(1);
        // Add check before accessing history[0]
        expect(history[0]).toBeDefined();
        const messageContent = history[0]?.content;
        expect(Array.isArray(messageContent)).toBe(true);
        if (!Array.isArray(messageContent)) return; // Type guard

        const imageParts = messageContent.filter(part => part.type === 'image');
        expect(imageParts.length).toBe(2); // Should include both
        expect(warnings.length).toBe(0); // No warnings expected
    });

    it('should include zero images if configured limit is 0 (maxImages = 0)', async () => {
        const testConfig = await mockLoadConfig('');
        testConfig.memory.maxImages = 0;
        vi.mocked(mockLoadConfig).mockResolvedValue(testConfig);
        bot.config = testConfig;
        bot.messageNodeCache.clear();

        const attachments = [
            createMockAttachment('att1', 'img1.png', 'image/png', 1000, 'http://example.com/img1.png'),
        ];
        const message = createMockMessageWithAttachments('Message with 1 image', 'msg-img-3', attachments);

        const { history, warnings } = await bot.messageProcessor.buildMessageHistory(message); // Use processor

        expect(history.length).toBe(1);
        // Add check before accessing history[0]
        expect(history[0]).toBeDefined();
        const messageContent = history[0]?.content;
        // Content should be just the text part
        expect(typeof messageContent).toBe('string');
        expect(messageContent).toContain('Message with 1 image');
        expect(warnings.some(w => w.message === 'Message msg-img-3 images truncated to 0.')).toBe(true); // Updated warning check
    });

    it('should handle undefined maxImages in config by using default (2)', async () => {
        const testConfig = await mockLoadConfig('');
        delete testConfig.memory.maxImages; // Remove the setting
        vi.mocked(mockLoadConfig).mockResolvedValue(testConfig);
        bot.config = testConfig;
        bot.messageNodeCache.clear();

        const attachments = [
            createMockAttachment('att1', 'img1.png', 'image/png', 1000, 'http://example.com/img1.png'),
            createMockAttachment('att2', 'img2.jpg', 'image/jpeg', 1000, 'http://example.com/img2.jpg'),
            createMockAttachment('att3', 'img3.gif', 'image/gif', 1000, 'http://example.com/img3.gif'),
        ];
        const message = createMockMessageWithAttachments('Message with 3 images', 'msg-img-4', attachments);

        const { history, warnings } = await bot.messageProcessor.buildMessageHistory(message); // Use processor

        expect(history.length).toBe(1);
        // Add check before accessing history[0]
        expect(history[0]).toBeDefined();
        const messageContent = history[0]?.content;
        expect(Array.isArray(messageContent)).toBe(true);
        if (!Array.isArray(messageContent)) return; // Type guard

        const imageParts = messageContent.filter(part => part.type === 'image');
        expect(imageParts.length).toBe(2); // Should default to 2
        expect(warnings.some(w => w.message === 'Message msg-img-4 images truncated to 2.')).toBe(true); // Updated warning check
    });


    it('should add user prefix if provider does NOT support usernames', async () => {
        vi.mocked(mockProvider.supportsUsernames).mockReturnValue(false);
        const message = createMockMessage('Hello', 'msg-user-1', 'user123');

        const { history, warnings } = await bot.messageProcessor.buildMessageHistory(message); // Use processor

        expect(history.length).toBe(1);
        expect(history[0]).toBeDefined();
        expect(history[0]?.role).toBe('user');
        expect(history[0]?.name).toBeUndefined(); // Name should not be set
        expect(history[0]?.content).toMatch(/^User \(User\/user123\): Hello$/); // Prefix should be added
        expect(warnings.length).toBe(0);
    });

    it('should add name property and NOT user prefix if provider supports usernames', async () => {
        vi.mocked(mockProvider.supportsUsernames).mockReturnValue(true);
        const message = createMockMessage('Hi there', 'msg-user-2', 'user456');

        const { history, warnings } = await bot.messageProcessor.buildMessageHistory(message); // Use processor

        expect(history.length).toBe(1);
        expect(history[0]).toBeDefined();
        expect(history[0]?.role).toBe('user');
        expect(history[0]?.name).toBe('user456'); // Name should be set to userId
        expect(history[0]?.content).toBe('Hi there'); // No prefix should be added
        expect(warnings.length).toBe(0);
    });

    // Add more tests: e.g., history spanning multiple messages with images
});

});
