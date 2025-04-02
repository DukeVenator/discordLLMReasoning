import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { Message, TextChannel, User } from 'discord.js'; // Removed unused EmbedBuilder
import { ResponseManager } from '../../src/discord/ResponseManager';
import { ResponseManagerOptions } from '../../src/types/discord'; // Correct import path
import { Config } from '../../src/types/config';
import { Logger } from '../../src/core/logger'; // Adjust path as needed

// --- Mocks ---

// Mock Logger
vi.mock('../../src/core/logger', () => {
  const mockLog = vi.fn();
  const MockLogger = vi.fn().mockImplementation(() => ({
    debug: mockLog,
    info: mockLog,
    warn: mockLog,
    error: mockLog,
    fatal: mockLog,
    getSubLogger: vi.fn().mockReturnThis(), // Return the same mock instance for sub-loggers
    level: 'info', // Mock property
    setLevel: vi.fn(),
    getLevel: vi.fn().mockReturnValue('info'),
  }));
  return { Logger: MockLogger };
});

// Mock discord.js Message and related parts
const mockReply = vi.fn();
const mockEdit = vi.fn();
const mockSend = vi.fn();

const createMockMessage = (): Message => {
  const msg = {
    id: 'test-message-id',
    author: { id: 'test-user-id', tag: 'testuser#0000' } as User,
    channel: {
      id: 'test-channel-id',
      isTextBased: vi.fn().mockReturnValue(true),
      send: mockSend, // Mock send for follow-up messages
    } as unknown as TextChannel, // Use unknown for easier mocking
    reply: mockReply,
    // Add other properties/methods if ResponseManager uses them
  } as unknown as Message; // Use unknown for easier mocking

  // Mock the edit method on the object returned by reply/send
  mockReply.mockResolvedValue({
    ...msg,
    edit: mockEdit,
    content: 'Initial Content',
    embeds: [],
  });
  mockSend.mockResolvedValue({
    ...msg,
    edit: mockEdit,
    content: 'Follow-up Content',
    embeds: [],
  });

  return msg;
};

// Mock Config
const createMockConfig = (overrides: Partial<Config['discord']> = {}): Config =>
  ({
    discord: {
      token: 'test-token',
      clientId: 'test-client-id',
      streamingUpdateIntervalMs: 100, // Use a short interval for testing
      usePlainResponses: false,
      ...overrides,
    },
    llm: { defaultProvider: 'mock' },
    memory: {
      enabled: false,
      storageType: 'sqlite',
      sqlite: { path: 'dummy.db' },
    },
    logging: { level: 'debug' },
    permissions: {},
    rateLimit: { user: { intervalSeconds: 10, maxCalls: 5 } },
    model: 'mock/mock-model',
    // Add other necessary config parts with default mock values
  }) as Config; // Cast for simplicity, ensure all used parts are mocked

// --- Test Suite ---

describe('ResponseManager', () => {
  let mockMessage: Message;
  let mockConfig: Config;
  let mockLogger: Logger;
  let options: ResponseManagerOptions;

  beforeEach(() => {
    vi.clearAllMocks(); // Reset mocks before each test
    mockMessage = createMockMessage();
    mockConfig = createMockConfig();
    // Use the static factory method which should return the mocked instance
    mockLogger = Logger.createRootLogger('debug');
    options = {
      originalMessage: mockMessage,
      config: mockConfig,
      logger: mockLogger,
      initialContent: 'Testing...',
    };
  });

  it('should initialize correctly', () => {
    const manager = new ResponseManager(options);
    expect(manager).toBeInstanceOf(ResponseManager);
    // Check if sub-logger was requested
    expect(mockLogger.getSubLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ResponseManager',
        messageId: 'test-message-id',
        userId: 'test-user-id',
      }),
    );
  });

  describe('sendInitialResponse', () => {
    it('should send the initial response using message.reply', async () => {
      const manager = new ResponseManager(options);
      await manager.sendInitialResponse();

      expect(mockMessage.reply).toHaveBeenCalledTimes(1);
      expect(mockMessage.reply).toHaveBeenCalledWith('Testing...'); // Check initial content
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initial response sent'),
      );
    });

    it('should use default initial content if not provided', async () => {
      // Omit the property instead of setting to undefined
      const { initialContent, ...optsWithoutInitial } = options;
      const manager = new ResponseManager(optsWithoutInitial);
      await manager.sendInitialResponse();

      expect(mockMessage.reply).toHaveBeenCalledTimes(1);
      expect(mockMessage.reply).toHaveBeenCalledWith('🧠 Thinking...'); // Check default content
    });

    it('should handle errors during initial send', async () => {
      const testError = new Error('Discord API Error');
      mockReply.mockRejectedValueOnce(testError); // Simulate reply failure

      const manager = new ResponseManager(options);

      await expect(manager.sendInitialResponse()).rejects.toThrow(testError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send initial response'),
        testError,
      );
    });

    it('should not send if initial response already exists', async () => {
      const manager = new ResponseManager(options);
      await manager.sendInitialResponse(); // First send
      mockReply.mockClear(); // Clear mocks for the second call check
      (mockLogger.warn as Mock).mockClear();

      await manager.sendInitialResponse(); // Second attempt

      expect(mockMessage.reply).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Initial response already sent.',
      );
    });
  });

  describe('updateResponse', () => {
    beforeEach(() => {
      vi.useFakeTimers(); // Enable fake timers for throttling tests
    });

    afterEach(() => {
      vi.useRealTimers(); // Restore real timers after each test
    });

    it('should buffer content and send update immediately if interval passed', async () => {
      const manager = new ResponseManager(options);
      await manager.sendInitialResponse(); // Send initial message first
      mockEdit.mockClear(); // Clear edit mock after initial send

      await manager.updateResponse('Chunk 1');
      // Should not send immediately as interval (100ms) hasn't passed
      expect(mockEdit).not.toHaveBeenCalled();

      // Advance time beyond the interval
      vi.advanceTimersByTime(150);

      // Trigger the scheduled update (or next update call will send)
      await manager.updateResponse(' Chunk 2'); // This call should trigger the send

      expect(mockEdit).toHaveBeenCalledTimes(1);
      // Check if the payload contains the combined buffered content
      // Note: _createPayload adds the streaming indicator ' ⚪'
      expect(mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: 'Chunk 1 Chunk 2 ⚪',
            }),
          ]),
        }),
      );
    });

    it('should send update immediately if isFinal is true', async () => {
      const manager = new ResponseManager(options);
      await manager.sendInitialResponse();
      mockEdit.mockClear();

      // Test finalization separately using manager.finalize()
      await manager.updateResponse('Final chunk');
      await manager.finalize(); // Call finalize to check final state

      expect(mockEdit).toHaveBeenCalledTimes(1);
      // Check final payload (no streaming indicator, green color)
      expect(mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: 'Final chunk', // No indicator
              color: 0x00ff00, // Green color
            }),
          ]),
        }),
      );
    });

    it('should schedule an update if interval has not passed and not final', async () => {
      const manager = new ResponseManager(options);
      await manager.sendInitialResponse();
      mockEdit.mockClear();

      await manager.updateResponse('Buffered chunk');

      // Should not have called edit yet
      expect(mockEdit).not.toHaveBeenCalled();

      // Advance time, but less than the interval
      vi.advanceTimersByTime(50);
      expect(mockEdit).not.toHaveBeenCalled(); // Still shouldn't have called

      // Advance time past the interval to trigger the scheduled update
      vi.advanceTimersByTime(100);
      // Need to wait for the setTimeout promise to resolve
      await vi.runOnlyPendingTimersAsync(); // Or vi.runAllTimersAsync()

      expect(mockEdit).toHaveBeenCalledTimes(1);
      expect(mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: 'Buffered chunk ⚪',
            }),
          ]),
        }),
      );
    });

    it('should clear pending timeout if an update is sent manually before timeout fires', async () => {
      const manager = new ResponseManager(options);
      await manager.sendInitialResponse();
      mockEdit.mockClear();

      await manager.updateResponse('Chunk 1'); // Schedules an update
      expect(mockEdit).not.toHaveBeenCalled();

      // Send another update before the timeout fires
      vi.advanceTimersByTime(50); // Advance time slightly
      await manager.updateResponse(' Chunk 2'); // Send update
      await manager.finalize(); // Finalize manually

      expect(mockEdit).toHaveBeenCalledTimes(1); // Should have sent the final update
      expect(mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: 'Chunk 1 Chunk 2',
              color: 0x00ff00,
            }),
          ]),
        }),
      );

      // Advance time past the original timeout period
      vi.advanceTimersByTime(100);
      await vi.runOnlyPendingTimersAsync();

      // Edit should NOT have been called again by the original timeout
      expect(mockEdit).toHaveBeenCalledTimes(1);
    });

    it('should handle empty final update correctly', async () => {
      const manager = new ResponseManager(options);
      await manager.sendInitialResponse();
      mockEdit.mockClear();

      // Send content, then immediately send final empty update
      await manager.updateResponse('Some content');
      vi.advanceTimersByTime(150); // Ensure first update sends
      await vi.runOnlyPendingTimersAsync();
      expect(mockEdit).toHaveBeenCalledTimes(1);
      mockEdit.mockClear(); // Clear for final update check

      await manager.finalize(); // Finalize with empty buffer

      expect(mockEdit).toHaveBeenCalledTimes(1);
      // Should call _applyFinalFormatting, which might edit if needed (e.g., code blocks)
      // In this basic case without code blocks, it might just edit to the final state (green color)
      expect(mockEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: 'Some content', // Content from previous update
              color: 0x00ff00, // Final color
            }),
          ]),
        }),
      );
    });

    it('should not update if response is already finished', async () => {
      const manager = new ResponseManager(options);
      await manager.sendInitialResponse();
      await manager.updateResponse('Final content');
      await manager.finalize(); // Finish the response
      mockEdit.mockClear();
      (mockLogger.warn as Mock).mockClear();

      await manager.updateResponse('Extra content'); // Attempt update after finish

      expect(mockEdit).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Attempted to update response after it was marked as finished',
        ),
      );
    });

    it('should log error and return if initial response was not sent', async () => {
      const manager = new ResponseManager(options);
      // Do NOT call sendInitialResponse()
      (mockLogger.error as Mock).mockClear();

      await manager.updateResponse('Some chunk');

      expect(mockEdit).not.toHaveBeenCalled();
      expect(mockReply).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          'Cannot update response: Initial response not sent or failed.',
        ),
      );
    });
  }); // End of describe('updateResponse') - moved below the new tests
  it('should truncate content if it exceeds DISCORD_MESSAGE_LIMIT within a single message', async () => {
    const manager = new ResponseManager(options);
    await manager.sendInitialResponse(); // botResponse is message 1
    // Simulate message 1 already having some content near the limit
    manager['totalSentLength'] = 1950; // Directly manipulate private state for testing
    manager['botResponse']!.content = 'A'.repeat(1950); // Simulate existing content
    mockEdit.mockClear();

    const extraContent = 'B'.repeat(100); // This will push it over 2000

    await manager.updateResponse(extraContent);
    await manager.finalize(); // Final update

    expect(mockEdit).toHaveBeenCalledTimes(1);
    // Expect the description to be truncated with "..."
    // Available space = 2000 - 1950 = 50. Need 3 for '...'. Max new chars = 47.
    const expectedTruncatedChunk = extraContent.substring(0, 47) + '...';
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            // Description should be the original content + truncated chunk
            description: 'A'.repeat(1950) + expectedTruncatedChunk,
            color: 0x00ff00, // Final color
          }),
        ]),
      }),
    );
    // Logger should warn about truncation
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Segment truncated due to Discord limit'),
    );
  });

  it('should split content into a new message if it significantly exceeds DISCORD_MESSAGE_LIMIT', async () => {
    const manager = new ResponseManager(options);
    await manager.sendInitialResponse(); // botResponse is message 1
    // Simulate message 1 already having some content near the limit
    manager['totalSentLength'] = 1900;
    manager['botResponse']!.content = 'A'.repeat(1900);
    mockEdit.mockClear();
    mockSend.mockClear();

    const part2 = 'B'.repeat(200); // This will cause a split

    // Send second part (triggers split)
    await manager.updateResponse(part2);
    await manager.finalize(); // Final update

    // 1. Edit message 1 to its truncated limit
    expect(mockEdit).toHaveBeenCalledTimes(2); // Once for msg1 truncation, once for msg2 content
    // Available space = 2000 - 1900 = 100. Need 3 for '...'. Max new chars = 97.
    const expectedMsg1Chunk = part2.substring(0, 97) + '...';
    expect(mockEdit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: 'A'.repeat(1900) + expectedMsg1Chunk, // Truncated content for msg 1
            color: 0x00ff00, // Final color for this message part
          }),
        ]),
      }),
    );

    // 2. Send a new message (message 2) with a placeholder
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({ description: '...' }),
        ]), // Placeholder for new message
      }),
    );

    // 3. Edit message 2 with the remaining content
    // The mockSend resolved value has the edit mock attached
    const remainingContent = part2.substring(97); // Content that didn't fit in msg1 chunk
    expect(mockEdit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: remainingContent, // Remaining content for msg 2
            color: 0x00ff00, // Final color overall
          }),
        ]),
      }),
    ); // Removed extra parenthesis

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Segment truncated due to Discord limit'),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Sent new follow-up message'),
    );
  });
}); // This now closes the describe('updateResponse') block

// --- TODO: Add more updateResponse tests ---
// - Code block handling (_applyFinalFormatting)
// - Plain text vs Embeds
// - Error handling during edit/send (rate limit, length)

// --- TODO: Add tests for handleError ---
describe('handleError', () => {
  // Move beforeEach setup inside this describe block for proper scope
  let mockMessageHandleError: Message;
  let mockConfigHandleError: Config;
  let mockLoggerHandleError: Logger;
  let optionsHandleError: ResponseManagerOptions;

  beforeEach(() => {
    vi.clearAllMocks(); // Reset mocks before each test
    mockMessageHandleError = createMockMessage();
    mockConfigHandleError = createMockConfig();
    mockLoggerHandleError = Logger.createRootLogger('debug');
    optionsHandleError = {
      originalMessage: mockMessageHandleError,
      config: mockConfigHandleError,
      logger: mockLoggerHandleError,
      initialContent: 'Testing...', // Not strictly needed for error tests but keeps structure
    };
  });

  it('should edit the existing response message with the error', async () => {
    const manager = new ResponseManager(optionsHandleError);
    await manager.sendInitialResponse(); // Ensure botResponse exists
    mockEdit.mockClear(); // Clear edit mock after initial send

    const testError = new Error('LLM Processing Failed');
    await manager.handleError(testError);

    expect(mockEdit).toHaveBeenCalledTimes(1);
    expect(mockEdit).toHaveBeenCalledWith(
      '❌ An error occurred: LLM Processing Failed',
    );
    expect(mockLoggerHandleError.error).toHaveBeenCalledWith(
      expect.stringContaining('Handling error during response management'),
      testError,
    );
  });

  it('should reply with an error if the initial response failed to send', async () => {
    const manager = new ResponseManager(optionsHandleError);
    // Do NOT call sendInitialResponse, simulate it failed (botResponse is null)
    mockReply.mockClear(); // Clear reply mock

    const testError = new Error('Something went wrong');
    await manager.handleError(testError);

    expect(mockEdit).not.toHaveBeenCalled(); // Should not edit
    expect(mockMessageHandleError.reply).toHaveBeenCalledTimes(1); // Should reply instead
    expect(mockMessageHandleError.reply).toHaveBeenCalledWith(
      '❌ An error occurred: Something went wrong',
    );
    expect(mockLoggerHandleError.error).toHaveBeenCalledWith(
      expect.stringContaining('Handling error during response management'),
      testError,
    );
  });

  it('should log an error if sending the error message itself fails', async () => {
    const manager = new ResponseManager(optionsHandleError);
    await manager.sendInitialResponse(); // Ensure botResponse exists
    mockEdit.mockClear();
    (mockLoggerHandleError.error as Mock).mockClear(); // Clear logger error mock

    const initialError = new Error('Original Error');
    const sendError = new Error('Failed to send error message');
    mockEdit.mockRejectedValueOnce(sendError); // Make the edit call fail

    await manager.handleError(initialError);

    expect(mockEdit).toHaveBeenCalledTimes(1); // Attempted the edit
    expect(mockLoggerHandleError.error).toHaveBeenCalledWith(
      expect.stringContaining('Handling error during response management'),
      initialError,
    );
    expect(mockLoggerHandleError.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to send error message to Discord'),
      sendError,
    );
  });

  it('should clear update timeout when handling error', async () => {
    vi.useFakeTimers();
    const manager = new ResponseManager(optionsHandleError);
    await manager.sendInitialResponse();
    // Schedule an update
    await manager.updateResponse('Some data');
    expect(mockEdit).not.toHaveBeenCalled(); // Update is scheduled, not sent

    // Handle an error before the timer fires
    const error = new Error('Interruption');
    await manager.handleError(error);

    // Advance timer - the original update should NOT fire
    vi.advanceTimersByTime(200);
    await vi.runOnlyPendingTimersAsync();

    // Edit should only have been called by handleError, not the scheduled update
    expect(mockEdit).toHaveBeenCalledTimes(1);
    expect(mockEdit).toHaveBeenCalledWith(
      expect.stringContaining('❌ An error occurred: Interruption'),
    );

    vi.useRealTimers();
  });
}); // End describe('handleError')
