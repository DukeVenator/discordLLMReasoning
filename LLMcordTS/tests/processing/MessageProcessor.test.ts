// LLMcordTS/tests/processing/MessageProcessor.test.ts
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'; // Added Mock import
import { Message, Collection, User, Client } from 'discord.js';
import { AxiosInstance } from 'axios'; // Removed unused AxiosResponse
import { MessageProcessor } from '../../src/processing/MessageProcessor';
import { Config } from '../../src/types/config';
import { Logger } from '../../src/core/logger';
import { BaseProvider } from '../../src/providers/baseProvider';
import { IMessageNode } from '../../src/types/message'; // Removed unused IWarning, IMessageHistory

// --- Mocks ---

// Mock Logger
const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn(() => 'debug'), // Default level for tests
    createChildLogger: vi.fn().mockReturnThis(), // Chainable child logger
} as unknown as Logger;

// Mock Config (provide necessary nested properties)
const mockConfig = {
    memory: {
        enabled: true,
        maxHistoryLength: 10,
        maxImages: 2,
        suggestions: {}, // Add suggestions object if needed by tested code
        sqlite: { path: 'dummy.sqlite' } // Add sqlite path if needed
    },
    llm: {
        requestTimeoutMs: 15000,
        maxAttachmentSizeBytes: 10 * 1024 * 1024, // 10MB
        defaultMaxTokens: 4000,
        defaultSystemPrompt: 'Test prompt',
        defaultTemperature: 0.7,
        openai: {}, // Add provider configs if needed
        gemini: {},
        ollama: {},
    },
    discord: { // Add discord config if needed
        allowDms: true,
        streamingUpdateIntervalMs: 500,
        usePlainResponses: false,
        clientId: 'mock-client-id',
        token: 'mock-token'
    },
    logging: { level: 'debug' },
    model: 'mock-provider/mock-model', // Add model if needed
} as unknown as Config;

// Mock BaseProvider
const mockProvider = {
    supportsVision: vi.fn(() => true), // Default to supporting vision
    supportsUsernames: vi.fn(() => true), // Default to supporting usernames
    supportsSystemPrompt: vi.fn(() => true),
    supportsTools: vi.fn(() => false),
    supportsStreaming: vi.fn(() => true),
    generateStream: vi.fn(),
    getProviderInfo: vi.fn(() => ({ name: 'mock-provider' })),
} as unknown as BaseProvider;

// Mock AxiosInstance
const mockHttpClient = {
    get: vi.fn(),
    post: vi.fn(),
    // Add other methods if needed
} as unknown as AxiosInstance;

// Mock MessageNode Cache
let mockMessageNodeCache: Map<string, IMessageNode>;

// Helper to create a mock Discord Message
const createMockMessage = (
    id: string,
    content: string,
    authorId: string,
    isBot: boolean = false,
    referenceId: string | null = null,
    attachments: any[] = [] // Simplified attachment mock
): Message => {
    const mockUser = { id: authorId, bot: isBot, tag: `user#${authorId}`, displayName: `User ${authorId}` } as User;
    const mockChannel = { // Basic channel mock
        id: `channel-${id}`,
        type: 0, // GUILD_TEXT
        messages: {
            fetch: vi.fn(async (fetchId: string) => {
                // Simulate fetching parent message if needed for tests
                if (fetchId === referenceId && referenceId) {
                     // Return another mock message or specific data
                     return createMockMessage(referenceId, 'Parent message content', 'parent-user-id');
                }
                throw new Error('Message not found');
            }),
        },
    };

    return {
        id: id,
        content: content,
        author: mockUser,
        channel: mockChannel,
        client: { user: { id: 'mock-client-id' } } as Client, // Mock client with user ID
        mentions: { has: vi.fn((userId) => userId === 'mock-client-id') },
        reference: referenceId ? { messageId: referenceId, channelId: mockChannel.id } : null,
        attachments: new Collection(attachments.map(att => [att.id, att])),
        guild: { id: `guild-${id}`, name: 'Test Guild' }, // Mock guild info
        reply: vi.fn(), // Mock reply function
        // Add other necessary properties or methods
    } as unknown as Message;
};

// --- Test Suite ---

describe('MessageProcessor', () => {
    let messageProcessor: MessageProcessor;

    beforeEach(() => {
        // Reset mocks and cache before each test
        vi.clearAllMocks();
        mockMessageNodeCache = new Map<string, IMessageNode>();

        // Create a new instance for each test
        messageProcessor = new MessageProcessor(
            mockConfig,
            mockLogger,
            mockProvider,
            mockHttpClient,
            mockMessageNodeCache,
            'mock-client-id' // Pass the mock client ID
        );
    });

    it('should initialize correctly', () => {
        expect(messageProcessor).toBeInstanceOf(MessageProcessor);
        expect(mockLogger.debug).toHaveBeenCalledWith('MessageProcessor initialized.');
    });

    // --- buildMessageHistory Tests ---
    describe('buildMessageHistory', () => {
        it('should process a single message with text content', async () => {
            const message = createMockMessage('msg1', 'Hello world', 'user1');
            const { history, warnings } = await messageProcessor.buildMessageHistory(message);

            expect(history).toHaveLength(1);
            expect(history[0]!.role).toBe('user'); // Added non-null assertion
            expect(history[0]!.content).toBe('Hello world'); // Added non-null assertion
            expect(history[0]!.name).toBe('user1'); // Assuming provider supports usernames // Added non-null assertion
            expect(warnings).toHaveLength(0);
            expect(mockMessageNodeCache.has('msg1')).toBe(true); // Check if node was cached
        });

        it('should process a reply chain', async () => {
             const parentMessage = createMockMessage('msgParent', 'Parent message', 'user2');
             const childMessage = createMockMessage('msgChild', 'Child reply', 'user1', false, 'msgParent');

             // Mock the fetch call within the child message's channel mock
             (childMessage.channel.messages.fetch as Mock).mockResolvedValueOnce(parentMessage); // Changed cast to 'as Mock'

             const { history, warnings } = await messageProcessor.buildMessageHistory(childMessage);

             expect(history).toHaveLength(2);
             expect(history[0]!.role).toBe('user'); // Added non-null assertion
             expect(history[0]!.content).toBe('Parent message'); // Added non-null assertion
             expect(history[0]!.name).toBe('user2'); // Added non-null assertion
             expect(history[1]!.role).toBe('user'); // Added non-null assertion
             expect(history[1]!.content).toBe('Child reply'); // Added non-null assertion
             expect(history[1]!.name).toBe('user1'); // Added non-null assertion
             expect(warnings).toHaveLength(0);
             expect(mockMessageNodeCache.has('msgChild')).toBe(true);
             expect(mockMessageNodeCache.has('msgParent')).toBe(true);
        });

        // Add more tests here for:
        // - Cache hits
        // - Attachments (images, bad attachments, size limits, vision disabled)
        // - Parent fetch failures
        // - Warning generation (truncation, etc.)
        // - Mention cleaning
        // - Role assignment (assistant)
        // - Username formatting variations
        // - Max history length
        // - Empty messages / messages with only attachments
    });

    // --- (Optional) Tests for processMessageNode (if made public/testable) ---
    // describe('processMessageNode', () => {
    //     // Add tests specifically for node processing logic if needed
    // });
});