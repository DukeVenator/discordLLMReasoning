import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'; // Added afterEach
import { onMessageCreate } from '../../src/discord/eventHandlers';
import { LLMCordBot } from '../../src/core/LLMCordBot';
import { RateLimiter } from '@/utils/rateLimiter';
import { StatusManager } from '../../src/status/statusManager';
import { Logger } from '../../src/core/logger';
import { Config } from '../../src/types/config';
import { checkPermissions } from '../../src/utils/permissions';
import {
    Message, Client, User, ChannelType, GuildTextBasedChannel, DMChannel, Guild, Collection, Role, MessageMentions, MessageReference, ClientOptions, IntentsBitField, Partials as DiscordPartials, ClientUser // Removed unused imports
} from 'discord.js';

// Mock dependencies
vi.mock('../../src/core/LLMCordBot');
vi.mock('@/utils/rateLimiter');
vi.mock('../../src/core/logger');
vi.mock('../../src/status/statusManager');
vi.mock('../../src/utils/permissions');

// --- Mocked Instances ---
let mockClientInstance: Client;
let mockRateLimiterInstance: RateLimiter;
let mockStatusManagerInstance: StatusManager;
let mockLoggerInstance: Logger;

// Helper to create a mock User object
const createMockUser = (id: string, bot = false): User => ({
    id,
    bot,
    tag: `${id}#1234`,
    username: id,
    discriminator: '1234',
}) as User;

// Helper to create a mock ClientUser object (simplified)
const createMockClientUser = (id: string): ClientUser => ({
    id,
    bot: true,
    tag: `${id}#1234`,
}) as unknown as ClientUser;


// Helper to create a mock Guild object
const createMockGuild = (id: string): Guild => ({
    id,
    name: `Mock Guild ${id}`,
}) as Guild;

// Helper to create a mock GuildTextBasedChannel object
const createMockGuildChannel = (id: string, guild: Guild): GuildTextBasedChannel => ({
    id,
    type: ChannelType.GuildText,
    name: `mock-channel-${id}`,
    guild,
    messages: {
        fetch: vi.fn(), // Mock fetch individually per test
        cache: new Collection<string, Message>(),
    },
    send: vi.fn(),
}) as unknown as GuildTextBasedChannel;

// Helper to create a mock DMChannel object
const createMockDMChannel = (id: string): DMChannel => ({
    id,
    type: ChannelType.DM,
    messages: {
        fetch: vi.fn(),
        cache: new Collection<string, Message>(),
    },
    send: vi.fn(),
}) as unknown as DMChannel;

// Helper to create a mock Message object
const createMockMessage = (
    client: Client,
    overrides: any = {}, // Use any for overrides to simplify mock creation
    isDM = false
): Message => {
    const author = overrides.author ?? createMockUser('mockUserId');
    const guild = isDM ? null : createMockGuild('mockGuildId');
    const channel = isDM
        ? createMockDMChannel('mockDmChannelId')
        : createMockGuildChannel('mockChannelId', guild!);

    // Construct reference with required fields (no type needed here)
    // NOTE: This may cause a TS error (TS2741: Property 'type' is missing),
    // but removing 'type' is necessary for runtime test correctness.
    let reference: MessageReference | null = null;
    if (overrides.reference?.messageId) {
        // @ts-expect-error - Known TS error (TS2741): 'type' is missing but required for runtime test correctness.
        reference = {
            channelId: overrides.reference.channelId ?? channel.id,
            guildId: overrides.reference.guildId ?? guild?.id,
            messageId: overrides.reference.messageId,
            // No 'type' property on MessageReference in v14
        };
    }


    const baseMessage: Partial<Message> = {
        id: `mockMessageId-${Math.random()}`,
        // Apply overrides first, then defaults for missing essential props
        ...overrides,
        author: author,
        content: overrides.content ?? 'Hello bot',
        channel: channel as any,
        guild: guild, // Explicitly set guild (null for DM)
        client: client as Client<true>,
        mentions: overrides.mentions ?? {
            has: vi.fn().mockImplementation((userOrRole: string | User | Role) => {
                const targetId = typeof userOrRole === 'string' ? userOrRole : userOrRole.id;
                return targetId === client.user?.id;
            }),
            users: new Collection<string, User>(),
            roles: new Collection<string, Role>(),
            everyone: false,
            channels: new Collection<string, any>(),
        } as unknown as MessageMentions,
        reference: reference, // Use the constructed reference or null from overrides
        reply: overrides.reply ?? vi.fn().mockResolvedValue({ delete: vi.fn() } as unknown as Message),
        fetchReference: overrides.fetchReference ?? vi.fn(),
    };

    return baseMessage as Message; // Final cast to Message
};

// Helper to create a mock Collection with one message, cast to Message<true>
// Not needed if fetch resolves with single message
// const createMessageCollection = (message: Message): Collection<string, Message<true>> => {
//     const collection = new Collection<string, Message<true>>();
//     collection.set(message.id, message as Message<true>);
//     return collection;
// };


describe('onMessageCreate Event Handler', () => {
    let mockBot: LLMCordBot;
    let mockConfig: Config;
    let setTimeoutSpy: any; // Use any for spy type

    // Use fake timers for tests involving setTimeout
    beforeEach(() => {
        // vi.useFakeTimers(); // Don't enable globally, only in specific tests
        vi.clearAllMocks();
        vi.mocked(checkPermissions).mockClear().mockReturnValue(true);

        const clientOptions: ClientOptions = {
            intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages, IntentsBitField.Flags.DirectMessages, IntentsBitField.Flags.MessageContent],
            partials: [DiscordPartials.Channel],
        };
        mockClientInstance = new (vi.mocked(Client))(clientOptions);
        mockClientInstance.user = createMockClientUser('mockBotId'); // Ensure bot user is set

        mockLoggerInstance = {
            info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()
        } as unknown as Logger;

        mockConfig = {
            allowDms: false,
            permissions: { allowedRoles: [], allowedUsers: [], adminUsers: [], blockUsers: [], blockRoles: [], allowedChannels: [], blockedChannels: [], allowedCategories: [], blockedCategories: [] },
            rateLimit: { user: { intervalSeconds: 60, maxCalls: 5 } },
            discord: { token: 'dummy', clientId: 'dummy' },
            llm: { defaultProvider: 'dummy', defaultSystemPrompt: 'dummy' },
            memory: { enabled: false, storageType: 'sqlite', sqlite: { path: 'dummy.db' } },
            logging: { level: 'info' },
            model: 'dummy/dummy',
            reasoning: { enabled: false },
            search: { provider: 'none' },
        } as Config;

        mockRateLimiterInstance = new (vi.mocked(RateLimiter))(mockConfig);
        const minimalMockBotForStatus = {
             config: mockConfig, client: mockClientInstance, logger: mockLoggerInstance,
        } as unknown as LLMCordBot;
        mockStatusManagerInstance = new (vi.mocked(StatusManager))(minimalMockBotForStatus);

        mockBot = {
            client: mockClientInstance, config: mockConfig, logger: mockLoggerInstance,
            rateLimiter: mockRateLimiterInstance, statusManager: mockStatusManagerInstance,
            processMessage: vi.fn(), slashCommandHandler: { registerCommands: vi.fn() }
        } as unknown as LLMCordBot;

        vi.mocked(mockRateLimiterInstance.checkRateLimit).mockReturnValue([true, 'ok']);
        vi.mocked(mockRateLimiterInstance.getCooldownRemaining).mockReturnValue(5.0);
        vi.mocked(mockStatusManagerInstance.setTemporaryStatus).mockClear();
        vi.mocked(mockBot.processMessage).mockClear();
    });

    // Clean up spies and timers
    afterEach(() => {
        vi.useRealTimers(); // Ensure real timers are restored if fake ones were used
        if (setTimeoutSpy) {
            setTimeoutSpy.mockRestore();
        }
    });


    // --- Test cases ---

    it('should ignore messages from bots', async () => {
        const message = createMockMessage(mockClientInstance, {
            author: createMockUser('otherBotId', true)
        });
        await onMessageCreate(mockBot, message);
        expect(mockBot.processMessage).not.toHaveBeenCalled();
        expect(mockRateLimiterInstance.checkRateLimit).not.toHaveBeenCalled();
    });

    it('should ignore messages with no content', async () => {
        const message = createMockMessage(mockClientInstance, { content: '' });
        await onMessageCreate(mockBot, message);
        expect(mockBot.processMessage).not.toHaveBeenCalled();
        expect(mockRateLimiterInstance.checkRateLimit).not.toHaveBeenCalled();
    });

    // --- Filtering Tests (allowDms: false) ---

    it('should ignore non-DM, non-mention, non-reply messages when allowDms is false', async () => {
        mockConfig.discord.allowDms = false;
        const message = createMockMessage(mockClientInstance, { reference: null });
        vi.mocked(message.mentions.has).mockReturnValue(false);

        await onMessageCreate(mockBot, message);
        expect(mockBot.processMessage).not.toHaveBeenCalled();
        // Updated Expectation
        expect(mockLoggerInstance.debug).toHaveBeenCalledWith(expect.stringContaining('Ignoring message: Did not meet DM/mention/reply criteria.'));
    });

    it('should process mention messages when allowDms is false', async () => {
        mockConfig.discord.allowDms = false;
        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(checkPermissions).mockReturnValue(true);

        await onMessageCreate(mockBot, message);
        expect(mockRateLimiterInstance.checkRateLimit).toHaveBeenCalledWith(message.author.id);
        expect(checkPermissions).toHaveBeenCalledWith(message, mockConfig);
        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
    });

    it('should process reply messages to the bot when allowDms is false', async () => {
        mockConfig.discord.allowDms = false;
        // Ensure replied message author ID matches bot ID
        const repliedMessage = createMockMessage(mockClientInstance, { id: 'repliedMessageId', author: mockClientInstance.user! });
        const message = createMockMessage(mockClientInstance, {
            reference: { messageId: 'repliedMessageId', channelId: 'mockChannelId', guildId: 'mockGuildId' }
        });
        vi.mocked(message.mentions.has).mockReturnValue(false);
        vi.mocked(checkPermissions).mockReturnValue(true);
        // Mock fetch to return the single Message object
        // @ts-expect-error - Known TS error (TS2345): fetch mock expects Collection, but runtime needs Message.
        vi.mocked(message.channel.messages.fetch).mockResolvedValue(repliedMessage as Message<true>);

        await onMessageCreate(mockBot, message);
        expect(message.channel.messages.fetch).toHaveBeenCalledWith('repliedMessageId');
        expect(mockRateLimiterInstance.checkRateLimit).toHaveBeenCalledWith(message.author.id); // Should be called now
        expect(checkPermissions).toHaveBeenCalledWith(message, mockConfig);
        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
    });

     it('should ignore reply messages to other users when allowDms is false', async () => {
        mockConfig.discord.allowDms = false;
        const repliedMessage = createMockMessage(mockClientInstance, { id: 'repliedMessageId', author: createMockUser('anotherUserId') });
        const message = createMockMessage(mockClientInstance, {
            reference: { messageId: 'repliedMessageId', channelId: 'mockChannelId', guildId: 'mockGuildId' }
        });
        vi.mocked(message.mentions.has).mockReturnValue(false);
        // Mock fetch to return the single Message object
        // @ts-expect-error - Known TS error (TS2345): fetch mock expects Collection, but runtime needs Message.
        vi.mocked(message.channel.messages.fetch).mockResolvedValue(repliedMessage as Message<true>);

        await onMessageCreate(mockBot, message);
        expect(message.channel.messages.fetch).toHaveBeenCalledWith('repliedMessageId');
        expect(mockBot.processMessage).not.toHaveBeenCalled();
        // Updated Expectation
        expect(mockLoggerInstance.debug).toHaveBeenCalledWith(expect.stringContaining('Ignoring message: Did not meet DM/mention/reply criteria.'));
    });

    it('should ignore DM messages when allowDms is false', async () => {
        mockConfig.discord.allowDms = false;
        // Explicitly set guild to null for DM test
        const message = createMockMessage(mockClientInstance, { guild: null, reference: null }, true);
        vi.mocked(message.mentions.has).mockReturnValue(false); // Ensure no mention

        await onMessageCreate(mockBot, message);
        expect(mockBot.processMessage).not.toHaveBeenCalled(); // Should NOT be called
        // Updated Expectation
        expect(mockLoggerInstance.debug).toHaveBeenCalledWith(expect.stringContaining('Ignoring message: Did not meet DM/mention/reply criteria.'));
        expect(mockRateLimiterInstance.checkRateLimit).not.toHaveBeenCalled(); // Rate limit check should be skipped
    });


    // --- Filtering Tests (allowDms: true) ---

    it('should process DM messages when allowDms is true', async () => {
        mockConfig.discord.allowDms = true;
        const message = createMockMessage(mockClientInstance, {}, true); // isDM = true

        await onMessageCreate(mockBot, message);
        expect(mockRateLimiterInstance.checkRateLimit).toHaveBeenCalledWith(message.author.id);
        expect(checkPermissions).not.toHaveBeenCalled();
        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
    });

     it('should process mention messages when allowDms is true', async () => {
        mockConfig.discord.allowDms = true;
        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(checkPermissions).mockReturnValue(true);

        await onMessageCreate(mockBot, message);
        expect(mockRateLimiterInstance.checkRateLimit).toHaveBeenCalledWith(message.author.id);
        expect(checkPermissions).toHaveBeenCalledWith(message, mockConfig);
        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
    });

    it('should process reply messages to the bot when allowDms is true', async () => {
        mockConfig.discord.allowDms = true;
        // Ensure replied message author ID matches bot ID
        const repliedMessage = createMockMessage(mockClientInstance, { id: 'repliedMessageId', author: mockClientInstance.user! });
        const message = createMockMessage(mockClientInstance, {
            reference: { messageId: 'repliedMessageId', channelId: 'mockChannelId', guildId: 'mockGuildId' }
        });
        vi.mocked(message.mentions.has).mockReturnValue(false);
        vi.mocked(checkPermissions).mockReturnValue(true);
        // Mock fetch to return the single Message object
        // @ts-expect-error - Known TS error (TS2345): fetch mock expects Collection, but runtime needs Message.
        vi.mocked(message.channel.messages.fetch).mockResolvedValue(repliedMessage as Message<true>);

        await onMessageCreate(mockBot, message);
        expect(message.channel.messages.fetch).toHaveBeenCalledWith('repliedMessageId');
        expect(mockRateLimiterInstance.checkRateLimit).toHaveBeenCalledWith(message.author.id); // Should be called now
        expect(checkPermissions).toHaveBeenCalledWith(message, mockConfig);
        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
    });

    it('should ignore non-DM, non-mention, non-reply messages even when allowDms is true', async () => {
        mockConfig.discord.allowDms = true;
        const message = createMockMessage(mockClientInstance, { reference: null });
        vi.mocked(message.mentions.has).mockReturnValue(false);

        await onMessageCreate(mockBot, message);
        expect(mockBot.processMessage).not.toHaveBeenCalled();
        // Updated Expectation
        expect(mockLoggerInstance.debug).toHaveBeenCalledWith(expect.stringContaining('Ignoring message: Did not meet DM/mention/reply criteria.'));
    });


    // --- Rate Limiting Tests ---

    it('should call processMessage when not rate limited', async () => {
        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(mockRateLimiterInstance.checkRateLimit).mockReturnValue([true, 'ok']);
        vi.mocked(checkPermissions).mockReturnValue(true);

        await onMessageCreate(mockBot, message);
        expect(mockRateLimiterInstance.checkRateLimit).toHaveBeenCalledWith(message.author.id);
        expect(message.reply).not.toHaveBeenCalled();
        expect(mockStatusManagerInstance.setTemporaryStatus).not.toHaveBeenCalled();
        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
    });

    it('should reply, set status, and schedule delete when user rate limited', async () => {
        // Spy on setTimeout before the test runs
        setTimeoutSpy = vi.spyOn(global, 'setTimeout');

        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(mockRateLimiterInstance.checkRateLimit).mockReturnValue([false, 'user']);
        const cooldown = 8.76;
        vi.mocked(mockRateLimiterInstance.getCooldownRemaining).mockReturnValue(cooldown);

        // Ensure reply resolves with an object that has a mock delete
        const mockDelete = vi.fn();
        message.reply = vi.fn().mockResolvedValue({ delete: mockDelete });

        await onMessageCreate(mockBot, message);

        expect(mockRateLimiterInstance.checkRateLimit).toHaveBeenCalledWith(message.author.id);
        expect(mockLoggerInstance.warn).toHaveBeenCalledWith(expect.stringContaining(`User rate limit hit for user ${message.author.id}. Cooldown: ${cooldown.toFixed(2)}s`));
        expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('User rate limit reached. Please wait 8.8 seconds.'));
        expect(mockStatusManagerInstance.setTemporaryStatus).toHaveBeenCalledWith(
            'User Rate Limited', 5, undefined, 'idle'
        );
        expect(mockBot.processMessage).not.toHaveBeenCalled();

        // Check that setTimeout was scheduled
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        const expectedDelay = Math.max(5000, Math.min(cooldown * 1000, 15000));
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expect.closeTo(expectedDelay, 0));

        // We don't advance timers or check mockDelete anymore, just scheduling
    });

     it('should reply, set status, and schedule delete when global rate limited', async () => {
        // Spy on setTimeout
        setTimeoutSpy = vi.spyOn(global, 'setTimeout');

        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(mockRateLimiterInstance.checkRateLimit).mockReturnValue([false, 'global']);
        const cooldown = 12.34;
        vi.mocked(mockRateLimiterInstance.getCooldownRemaining).mockReturnValue(cooldown);

        const mockDelete = vi.fn();
        message.reply = vi.fn().mockResolvedValue({ delete: mockDelete });


        await onMessageCreate(mockBot, message);

        expect(mockRateLimiterInstance.checkRateLimit).toHaveBeenCalledWith(message.author.id);
        expect(mockLoggerInstance.warn).toHaveBeenCalledWith(expect.stringContaining(`Global rate limit hit for user ${message.author.id}. Cooldown: ${cooldown.toFixed(2)}s`));
        expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Global rate limit reached. Please wait 12.3 seconds.'));
         expect(mockStatusManagerInstance.setTemporaryStatus).toHaveBeenCalledWith(
            'Global Rate Limited', 5, undefined, 'idle'
        );
        expect(mockBot.processMessage).not.toHaveBeenCalled();

        // Check that setTimeout was scheduled
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        const expectedDelay = Math.max(5000, Math.min(cooldown * 1000, 15000));
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expect.closeTo(expectedDelay, 0));

        // We don't advance timers or check mockDelete anymore, just scheduling
    });

    // --- Permissions Tests (Guild Messages Only) ---

    it('should call processMessage when permissions check passes for guild message', async () => {
        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(mockRateLimiterInstance.checkRateLimit).mockReturnValue([true, 'ok']);
        vi.mocked(checkPermissions).mockReturnValue(true);

        await onMessageCreate(mockBot, message);

        expect(checkPermissions).toHaveBeenCalledWith(message, mockConfig);
        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
    });

    it('should NOT call processMessage when permissions check fails for guild message', async () => {
        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(mockRateLimiterInstance.checkRateLimit).mockReturnValue([true, 'ok']);
        vi.mocked(checkPermissions).mockReturnValue(false);

        await onMessageCreate(mockBot, message);

        expect(checkPermissions).toHaveBeenCalledWith(message, mockConfig);
        expect(mockLoggerInstance.info).toHaveBeenCalledWith(expect.stringContaining(`lacks permission in channel ${message.channel.id}`));
        expect(mockBot.processMessage).not.toHaveBeenCalled();
    });

    it('should skip permissions check for DM messages', async () => {
        mockConfig.discord.allowDms = true;
        const message = createMockMessage(mockClientInstance, {}, true); // DM message
        vi.mocked(mockRateLimiterInstance.checkRateLimit).mockReturnValue([true, 'ok']);

        await onMessageCreate(mockBot, message);

        expect(checkPermissions).not.toHaveBeenCalled();
        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
    });

    // --- Error Handling ---
    it('should log error if processMessage throws', async () => {
        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(checkPermissions).mockReturnValue(true);
        const testError = new Error('Processing failed');
        vi.mocked(mockBot.processMessage).mockRejectedValue(testError);

        await onMessageCreate(mockBot, message);

        expect(mockBot.processMessage).toHaveBeenCalledWith(message);
        expect(mockLoggerInstance.error).toHaveBeenCalledWith(`Error processing message ID ${message.id}:`, testError);
    });

     it('should handle error if fetching replied message fails and ignore message', async () => {
        mockConfig.discord.allowDms = false;
        const message = createMockMessage(mockClientInstance, {
            reference: { messageId: 'deletedMessageId', channelId: 'mockChannelId', guildId: 'mockGuildId' }
        });
        vi.mocked(message.mentions.has).mockReturnValue(false);
        const fetchError = new Error('Message not found');
        vi.mocked(message.channel.messages.fetch).mockRejectedValue(fetchError);

        await onMessageCreate(mockBot, message);

        expect(message.channel.messages.fetch).toHaveBeenCalledWith('deletedMessageId');
        expect(mockBot.processMessage).not.toHaveBeenCalled();
        // Updated Expectation
        expect(mockLoggerInstance.debug).toHaveBeenCalledWith(expect.stringContaining('Ignoring message: Did not meet DM/mention/reply criteria.'));
    });

     it('should log error if sending rate limit reply fails', async () => {
        const message = createMockMessage(mockClientInstance);
        vi.mocked(message.mentions.has).mockReturnValue(true);
        vi.mocked(mockRateLimiterInstance.checkRateLimit).mockReturnValue([false, 'user']);
        const replyError = new Error('Missing Permissions');
        message.reply = vi.fn().mockRejectedValue(replyError); // Mock reply to reject

        await onMessageCreate(mockBot, message);

        expect(message.reply).toHaveBeenCalled();
        expect(mockLoggerInstance.error).toHaveBeenCalledWith(`Failed to send rate limit message: ${replyError}`);
        expect(mockBot.processMessage).not.toHaveBeenCalled();
    });

});