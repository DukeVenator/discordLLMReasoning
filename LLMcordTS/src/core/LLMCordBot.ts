/**
 * @fileoverview Defines the main LLMCordBot class, responsible for initializing
 * the Discord client, loading configuration, setting up providers and managers,
 * handling events, and processing messages.
 */
// LLMcordTS/src/core/LLMCordBot.ts
import {
  Client,
  GatewayIntentBits,
  Partials,
  Message,
  // ChannelType, // Removed unused import
  EmbedBuilder,
  TextChannel,
  DMChannel,
  NewsChannel,
} from 'discord.js'; // Consolidated imports + DMChannel, NewsChannel
import axios, { AxiosInstance } from 'axios';
import { loadConfig } from './config';
import { Config } from '../types/config';
import { onReady, onMessageCreate } from '@/discord/eventHandlers';
import { StatusManager } from '@/status/statusManager';
import { SlashCommandHandler } from '@/discord/slashCommandHandler';
import { FinishReason } from '@/providers/baseProvider';
import { RateLimiter } from '@/utils/rateLimiter';
import { ProviderFactory } from '@/providers/providerFactory';
import {
  BaseProvider,
  ChatMessage,
  ChatMessageContentPart,
  ChatMessageContentPartText,
  GenerationOptions,
  StreamChunk,
} from '../providers/baseProvider'; // Added GenerationOptions, StreamChunk
import { SQLiteMemoryStorage } from '@/memory/SQLiteMemoryStorage'; // Use SQLite implementation
import { ReasoningManager } from '@/reasoning/manager';
// Removed MessageNode import, using IMessageNode from message.ts now
import { ToolCallRequest } from '@/types/tools'; // Removed unused ToolDefinition
import { Logger } from '@/core/logger'; // Import the Logger class
import { MemoryCommandHandler } from '@/commands/handlers/memoryCommandHandler'; // Corrected path
import { ToolRegistry } from './toolRegistry'; // Import ToolRegistry
import { MessageProcessor } from '@/processing/MessageProcessor'; // Added
import { IMessageNode } from '@/types/message'; // Removed unused IWarning import

// Placeholder imports for future components
// import { ProviderManager } from '../providers/providerManager';
// import { MemoryManager } from '../memory/memoryManager';
// import { ReasoningManager } from '../reasoning/reasoningManager';

/**
 * The main class for the LLMcordTS Discord bot.
 * Orchestrates the different components like the Discord client, configuration,
 * LLM providers, memory, reasoning, and event handling.
 */
export class LLMCordBot {
  /** The Discord.js client instance. */
  public readonly client: Client;
  /** The loaded application configuration. Initialized in `initialize()`. */
  public config!: Config;
  /** Axios instance for making HTTP requests (e.g., to LLM APIs). Initialized in `initialize()`. */
  public httpClient!: AxiosInstance;
  /** Manages the bot's status updates. Initialized in `initialize()`. */
  public statusManager!: StatusManager;
  /** Handles registration and execution of slash commands. Initialized in `initialize()`. */
  public slashCommandHandler!: SlashCommandHandler;
  /** Manages rate limiting for users and commands. Initialized in `initialize()`. */
  public rateLimiter!: RateLimiter;
  /** Factory for creating LLM provider instances. Initialized in `initialize()`. */
  public providerFactory!: ProviderFactory;
  /** The primary LLM provider instance. Initialized in `initialize()`. */
  public llmProvider!: BaseProvider;
  /** Handles persistent user memory storage (if enabled). Initialized in `initialize()`. */
  public memoryStorage: SQLiteMemoryStorage | null = null;
  /** Manages multi-model reasoning logic (if enabled). Initialized in `initialize()`. */
  public reasoningManager: ReasoningManager | null = null;
  /** Handles memory-related commands (if memory enabled). Initialized in `initialize()`. */
  public memoryCommandHandler: MemoryCommandHandler | null = null;
  /** Cache for recently processed MessageNode objects to avoid redundant processing. */
  public messageNodeCache: Map<string, IMessageNode> = new Map(); // Cache for processed messages (Updated type)
  /** The root logger instance for the application. Initialized in `initialize()`. */
  public logger!: Logger;
  /** Manages available tools and their execution. Initialized in `initialize()`. */
  public toolRegistry!: ToolRegistry;
  /** Handles processing messages and building history. Initialized AFTER client is ready. */
  public messageProcessor!: MessageProcessor; // Added

  /**
   * Creates an instance of LLMCordBot.
   * Initializes the Discord.js client with necessary intents and partials.
   */
  constructor() {
    this.client = new Client({
      /**
       * Asynchronously initializes the bot.
       * Loads configuration, sets up the HTTP client, initializes providers and managers,
       * and registers Discord event handlers.
       * Exits the process if critical initialization steps fail (e.g., config loading, provider setup).
       * @returns {Promise<void>}
       */
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // Needed for Direct Messages
    });
  }

  public async initialize(): Promise<void> {
    // Initialize Root Logger FIRST (as other initializations might use it)
    // We need config for log level, but config loading needs this.logger... chicken & egg.
    // Let's create logger with default level, then update it after config load.
    this.logger = Logger.createRootLogger(); // Create with default level
    this.logger.info('Initializing LLMCordBot...');

    // 1. Load Configuration
    try {
      this.config = await loadConfig(); // loadConfig uses its own internal logger for loading phase
      // DEBUG: Log clientId immediately after assignment
      this.logger.debug(
        `[DEBUG Init] Assigned this.config. discord.clientId=${this.config.discord?.clientId}`,
      );
      // Update root logger level based on loaded config
      const configuredLevel = this.config.logging?.level || 'info';
      this.logger.setLevel(configuredLevel);
      this.logger.info(
        `Configuration loaded successfully. Logger level set to: ${this.logger.getLevel()}`,
      ); // Use getLevel()
    } catch (error) {
      this.logger.error('Failed to load configuration:', error);
      process.exit(1); // Exit if config fails to load
    }

    // 2. Initialize HTTP Client (Axios)
    this.httpClient = axios.create({
      timeout: this.config.llm?.requestTimeoutMs || 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.logger.info('HTTP client initialized.');

    // 3. Initialize Managers/Handlers
    this.statusManager = new StatusManager(this); // Pass the bot instance
    // Initialize Provider Factory and Default LLM Provider
    try {
      this.providerFactory = new ProviderFactory(this.config);
      this.llmProvider = this.providerFactory.getDefaultProvider();
      this.logger.info(`Provider factory initialized.`);
      this.logger.info(
        `Default LLM provider initialized: ${this.llmProvider.getProviderInfo ? JSON.stringify(this.llmProvider.getProviderInfo()) : 'Info N/A'}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to initialize provider factory or default provider: ${error.message}`,
      );
      process.exit(1); // Exit if provider fails
    }
    this.slashCommandHandler = new SlashCommandHandler(this);
    this.rateLimiter = new RateLimiter(this.config); // Pass the full config object
    this.logger.info('Core managers (Status, Slash, RateLimit) initialized.');

    // 3.1 Initialize Tool Registry
    try {
      this.toolRegistry = new ToolRegistry(); // Use default tools directory for now
      await this.toolRegistry.loadTools(); // Load tools
      this.logger.info(
        `Tool registry initialized with ${this.toolRegistry.getToolDefinitions().length} tools.`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize tool registry:', error);
      // Decide if this is critical. For now, let's log and continue,
      // but tool functionality will be broken.
      // process.exit(1); // Optionally exit if tools are critical
    }

    // 3.5 Initialize Memory Storage (if enabled)
    if (this.config.memory.enabled) {
      try {
        // Instantiate SQLiteMemoryStorage with path from config and logger
        const dbPath = this.config.memory?.sqlite?.path;
        if (!dbPath) {
          throw new Error(
            'SQLite database path is not defined in the configuration (memory.sqlite.path).',
          );
        }
        // Pass config and providerFactory to the constructor
        this.memoryStorage = new SQLiteMemoryStorage(
          dbPath,
          this.logger,
          this.config,
          this.providerFactory,
        );
        this.logger.info('Memory storage initialized.');
        // TODO: Consider if config or llmProvider are needed later for persistence logic
      } catch (error) {
        this.logger.error('Failed to initialize memory storage:', error);
        this.memoryStorage = null;
      }

      // Initialize Memory Command Handler (only if storage was successful)
      if (this.memoryStorage) {
        try {
          // Pass the successfully initialized memoryStorage and the root logger
          this.memoryCommandHandler = new MemoryCommandHandler(
            this.memoryStorage,
            this.logger,
          ); // Removed config argument
          this.logger.info('Memory command handler initialized.');
        } catch (error) {
          this.logger.error(
            'Failed to initialize memory command handler:',
            error,
          );
          this.memoryCommandHandler = null; // Ensure it's null on error
        }
      } else {
        this.logger.warn(
          'Memory command handler not initialized because memory storage is unavailable.',
        );
        this.memoryCommandHandler = null; // Explicitly set to null if storage is null
      }
    } else {
      this.logger.info('Memory storage is disabled in configuration.');
      this.memoryStorage = null; // Ensure storage is null if disabled
      this.memoryCommandHandler = null; // Ensure handler is null if disabled
    }

    // 3.6 Initialize Reasoning Manager (if enabled)
    // DEBUG: Log the reasoning config before the check
    this.logger.debug(
      `[DEBUG Init] Checking reasoning config: ${JSON.stringify(this.config.reasoning)}`,
    );
    if (this.config.reasoning?.enabled) {
      try {
        // Pass the providerFactory instance
        this.reasoningManager = new ReasoningManager(
          this,
          this.providerFactory,
        );
      } catch (error) {
        this.logger.error('Failed to initialize reasoning manager:', error);
        this.reasoningManager = null;
      }
    } else {
      this.logger.info('Reasoning manager is disabled in configuration.');
    }

    // 4. Register Discord Event Handlers
    this.registerEventHandlers();
    this.logger.info('Discord event handlers registered.');

    this.logger.info('Initialization complete.');
  }

  /**
   * Processes a single Discord message to extract relevant information for the LLM history.
   * Populates a MessageNode object with details like role, user ID, cleaned text content,
   * image attachments (if supported), and fetches the parent message if it's a reply.
   * Handles potential errors during parent message fetching.
   * @param message - The discord.js Message object to process.
   * @param node - The MessageNode object to populate. This object is modified directly.
   * @returns {Promise<void>}
   * @private
   */
  // Removed processMessageNode and buildMessageHistory methods.
  // Their logic is now in the MessageProcessor class.

  /**
   * Registers the necessary Discord event handlers.
   * Binds the bot instance (`this`) to the handler functions.
   * @private
   */
  private registerEventHandlers(): void {
    this.client.on('ready', () => onReady(this));
    this.client.on('messageCreate', (message) =>
      onMessageCreate(this, message),
    );
    // Add other event handlers as needed
  }

  /**
   * Logs the bot into Discord using the token from the configuration.
   * Exits the process if the token is missing or login fails.
   * @returns {Promise<void>}
   */
  public async run(): Promise<void> {
    if (!this.config?.discord?.token) {
      this.logger.error('Bot token is missing. Cannot start the bot.');
      process.exit(1);
    }

    this.logger.info('Logging into Discord...');
    try {
      await this.client.login(this.config.discord.token);
      this.logger.info('Successfully logged in.');
    } catch (error) {
      this.logger.error('Failed to log in to Discord:', error);
      process.exit(1);
    }
  }

  /**
   * Gracefully shuts down the bot.
   * Sets status to invisible, waits briefly, then destroys the client.
   */
  public async shutdown(): Promise<void> {
    this.logger.info('Shutting down gracefully...');
    try {
      // Set status to invisible
      // Use setPresence for immediate effect if setTemporaryStatus isn't suitable for shutdown
      this.client.user?.setPresence({ status: 'invisible' });
      this.logger.info('Presence set to invisible.');

      // Wait a short period for status update to potentially propagate
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Close database connection if memory storage exists
      this.memoryStorage?.close();

      // Destroy the client connection
      this.client.destroy();
      this.logger.info('Discord client destroyed. Shutdown complete.');
    } catch (error) {
      this.logger.error('Error during graceful shutdown:', error);
      // Fallback: Ensure client is destroyed even if presence update fails
      if (this.client.readyTimestamp) {
        // Check if client is still potentially connected
        this.client.destroy();
        this.logger.warn('Discord client destroyed after shutdown error.');
      }
    }
  }

  /**
   * Processes memory update suggestions (e.g., [MEM_APPEND], [MEM_REPLACE]) found in LLM responses.
   * Updates memory storage and optionally strips tags from the response based on configuration.
   * @param userId - The ID of the user whose memory should be updated.
   * @param responseText - The full response text from the LLM.
   * @param messageId - The ID of the original Discord message for logging context.
   * @returns The response text, potentially with memory tags stripped.
   * @private
   */
  private _processMemorySuggestions(
    userId: string,
    responseText: string,
    messageId: string,
  ): string {
    let processedResponse = responseText; // Start with the original response

    if (this.memoryStorage && this.config.memory.enabled) {
      const suggestionsConfig = this.config.memory.suggestions;

      // Get marker config with defaults
      const appendStart =
        suggestionsConfig?.appendMarkerStart ?? '[MEM_APPEND]';
      const appendEnd = suggestionsConfig?.appendMarkerEnd ?? '[/MEM_APPEND]';
      const replaceStart =
        suggestionsConfig?.replaceMarkerStart ?? '[MEM_REPLACE]';
      const replaceEnd =
        suggestionsConfig?.replaceMarkerEnd ?? '[/MEM_REPLACE]';
      const stripTags = suggestionsConfig?.stripFromResponse ?? true; // Default to stripping

      // Escape markers for regex
      const escapeRegex = (s: string) =>
        s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const appendStartEsc = escapeRegex(appendStart);
      const appendEndEsc = escapeRegex(appendEnd);
      const replaceStartEsc = escapeRegex(replaceStart);
      const replaceEndEsc = escapeRegex(replaceEnd);

      // Build regex patterns
      const appendRegex = new RegExp(
        `${appendStartEsc}([\\s\\S]*?)${appendEndEsc}`,
        'gi',
      );
      const replaceRegex = new RegExp(
        `${replaceStartEsc}([\\s\\S]*?)${replaceEndEsc}`,
        'gi',
      );

      // Use responseText for matching
      const appendMatches = [...responseText.matchAll(appendRegex)];
      const replaceMatches = [...responseText.matchAll(replaceRegex)];

      let tagsProcessed = false;

      if (replaceMatches.length > 0) {
        tagsProcessed = true;
        const replaceContent = replaceMatches
          .map((match) => match[1]) // Get content within tags
          .filter((content): content is string => content !== undefined)
          .map((content) => content.trim())
          .join('\n')
          .trim(); // Use literal newline
        // Log immediately if replace tags were found
        this.logger.info(
          `[${messageId}] Found memory replace suggestion for user ${userId}.`,
        );
        if (replaceContent) {
          this.memoryStorage.setMemory(userId, replaceContent); // Use setMemory
        }
      } else if (appendMatches.length > 0) {
        // Only process append if replace wasn't found
        tagsProcessed = true;
        const appendContent = appendMatches
          .map((match) => match[1]) // Get content within tags
          .filter((content): content is string => content !== undefined)
          .map((content) => content.trim())
          .join('\n')
          .trim(); // Use literal newline
        // Log immediately if append tags were found
        this.logger.info(
          `[${messageId}] Found memory append suggestion for user ${userId}.`,
        );
        if (appendContent) {
          this.memoryStorage.appendMemory(userId, appendContent); // Run async
        }
      }

      // Strip tags if configured and if any tags were actually processed
      if (stripTags && tagsProcessed) {
        // Regex to match tags possibly surrounded by whitespace
        const combinedStripRegexWithSpace = new RegExp(
          `\\s*(?:${appendStartEsc}[\\s\\S]*?${appendEndEsc}|${replaceStartEsc}[\\s\\S]*?${replaceEndEsc})\\s*`,
          'gi',
        );
        // Replace tags and surrounding space with a single space to avoid joining words
        processedResponse = processedResponse.replace(
          combinedStripRegexWithSpace,
          ' ',
        );
        // Collapse multiple spaces into one and trim ends
        processedResponse = processedResponse.replace(/\s{2,}/g, ' ').trim();
        this.logger.debug(
          `[${messageId}] Stripped memory suggestion tags from final response.`,
        );
      } else if (tagsProcessed) {
        this.logger.debug(
          `[${messageId}] Memory suggestion tags processed but configured not to strip.`,
        );
      }
    }

    return processedResponse;
  }
  /**
   * Formats the user's memory content for inclusion in the system prompt.
   * @param memoryContent - The raw memory string, or null if none exists.
   * @returns A formatted string block for the system prompt.
   * @private
   */
  private _formatMemoryForSystemPrompt(memoryContent: string | null): string {
    if (memoryContent && memoryContent.trim()) {
      // Escape potential markdown issues if memory contains ``` etc.
      // Basic escaping for backticks for now. More robust escaping might be needed.
      const escapedContent = memoryContent.replace(/```/g, '\\`\\`\\`');
      return `\n\n--- User Memory ---\n${escapedContent}\n--- End Memory ---`;
    } else {
      return '\n\n--- User Memory ---\nYou have no memories of the user.\n--- End Memory ---'; // Changed default text
    }
  }

  /**
   * Formats the user's memory content for inclusion in the message history.
   * @param memoryContent - The raw memory string, or null if none exists.
   * @returns An array containing a system message with the memory, or an empty array if no memory.
   * @private
   */
  // Removed unused _formatMemoryForHistory method
  // Removed duplicated helper functions

  /**
   * Processes an incoming Discord message.
   * This is the main handler for message interactions.
   * 1. Builds the message history using `buildMessageHistory`.
   * 2. Aborts if no processable content is found.
   * 3. Prepares the system prompt.
   * 4. Calls the LLM provider's `generateStream` method.
   * 5. Processes the streamed response, accumulating the full text.
   * 6. Checks for and processes memory tags (`[MEM_APPEND]`, `[MEM_REPLACE]`) if enabled.
   * 7. Checks for and processes reasoning signals (`[REASONING_REQUEST]`) if enabled.
   * 8. Sends the final processed response (or warnings) back to the Discord channel.
   * 9. Handles errors during LLM interaction or Discord replies.
   * @param message - The discord.js Message object representing the incoming message.
   * @returns {Promise<void>}
   */
  public async processMessage(message: Message): Promise<void> {
    this.logger.info(
      `Processing message ID ${message.id} from ${message.author.tag} in channel ${message.channelId}`,
    );

    // --- Build History ---
    // Use the messageProcessor instance to build history
    const { history, warnings: userWarnings } = await this.messageProcessor.buildMessageHistory(message); // Updated call and return type handling

    // --- Fetch User Memory (Consolidated) ---
    const userId = message.author.id;
    let userMemoryContent: string | null = null;
    if (this.config.memory.enabled && this.memoryStorage) {
      try {
        userMemoryContent = await this.memoryStorage.getMemory(userId);
        this.logger.debug(
          `[${message.id}] Fetched memory for user ${userId}. Length: ${userMemoryContent?.length ?? 0}`,
        );
      } catch (memError) {
        this.logger.error(
          `[${message.id}] Failed to retrieve memory for user ${userId}:`,
          memError,
        );
        // Add warning as an IWarning object
        userWarnings.push({ type: 'Generic', message: '⚠️ Failed to load user memory' });
      }
    }

    // --- REMOVED Memory Injection into History ---
    // const memoryHistoryMessages = this._formatMemoryForHistory(userMemoryContent);
    // if (memoryHistoryMessages.length > 0) {
    //     history.unshift(...memoryHistoryMessages); // Add memory message(s) to the beginning
    //     this.logger.debug(`[${message.id}] Injected formatted memory into history.`);
    // }

    // --- Abort if no processable content after history build ---
    // Check history *after* potential memory injection
    if (history.filter((msg) => msg.role !== 'system').length === 0) {
      // Check if only system/memory messages remain
      this.logger.warn(
        `[${message.id}] No user/assistant content found in message or its history (after memory injection). Aborting.`,
      );
      if (userWarnings.length > 0) { // Check length of array
        try {
          // Combine warnings with the reason for stopping
          const stopReason = 'No message content to process';
          // Format warnings from IWarning objects
          const combinedWarnings = userWarnings.map(w => w.message).join(', ');
          await message.reply(
            `Processing stopped: ${stopReason}${combinedWarnings ? ` (${combinedWarnings})` : ''}`,
          );
        } catch (replyError) {
          this.logger.error(
            `[${message.id}] Failed to send warning reply:`,
            replyError,
          );
        }
      } else {
        try {
          // Send a simple notification if there were no other warnings
          await message.reply('Processing stopped: No message content found.');
        } catch (replyError) {
          this.logger.error(
            `[${message.id}] Failed to send stop notification reply:`,
            replyError,
          );
        }
      }
      return;
    }

    // Removed old memory injection block (now handled above)
    // --- Prepare system prompt ---
    // Base system prompt (Instructions ONLY)
    let baseSystemPromptText =
      this.config.llm?.defaultSystemPrompt ??
      'You are LLMCord, a helpful Discord bot.';

    // --- Format Memory Separately ---
    const formattedMemoryForPrompt =
      this._formatMemoryForSystemPrompt(userMemoryContent);
    this.logger.debug(`[${message.id}] Formatted memory for prompt.`);

    // --- Prepare Instructions ---
    let instructions = '';
    // Append Memory Instructions (if enabled)
    if (this.config.memory.enabled) {
      const memoryInstructions =
        '\\n\\n**Memory Instructions:**\\n' +
        'If you learn new, lasting information about the user OR need to modify/remove existing notes based on the conversation, ' +
        'include ONE of the following instructions at the VERY END of your response, after all other text:\\n' +
        '1. To add a new note: `[MEM_APPEND]The new note text here.`\\n' +
        '2. To modify or remove an existing note: `[MEM_REPLACE:Exact old text to find]The new text to replace it with (leave empty to remove).`\\n' +
        '**IMPORTANT:** Use `[MEM_REPLACE]` for *any* change or deletion requested by the user. Find the exact text and provide the new text (or leave it empty to delete).\\n' +
        'Only include ONE instruction per response, if any. Do not mention these instructions in your conversational reply.';
      instructions += memoryInstructions;
      this.logger.debug(`[${message.id}] Appended memory instructions.`);
    }

    // Append Reasoning Trigger Instructions (if enabled)
    if (this.reasoningManager?.isEnabled()) {
      const reasoningSignal =
        this.config.reasoning?.signalStart ?? '[USE_REASONING_MODEL]'; // Use configured signal
      const signalInstruction =
        `\\n\\n---\\n` +
        `Internal Task: If the user's request requires complex reasoning, analysis, multi-step planning, deep creative thought, or is a large task, ` +
        `or if the user asks you to think deeply, please respond *only* with the exact text \\\`${reasoningSignal}\\\` and nothing else. ` +
        `Otherwise, answer the request directly.`;
      instructions += signalInstruction;
      this.logger.debug(
        `[${message.id}] Appended reasoning trigger instructions.`,
      );
    }

    // --- Call LLM & Stream Response ---
    // Removed second old memory injection block (now handled at the start)

    // --- Call LLM & Stream Response ---
    let accumulatedResponse = '';
    let replyMessages: Message[] = []; // Track all messages sent for this response
    let currentReplyMessage: Message | null = null;
    let lastUpdateTime = 0;
    const updateIntervalMs =
      this.config.discord?.streamingUpdateIntervalMs ?? 750; // Default 0.75 seconds
    const minContentLengthChange = 50; // Update only if content changed significantly
    const usePlainResponses = this.config.discord?.usePlainResponses ?? false;
    const characterLimit = usePlainResponses ? 2000 : 4096; // Discord limits
    let finalResponseToUser = ''; // Declare here to ensure scope

    const updateDiscordResponse = async (
      content: string,
      isFinal: boolean = false,
    ): Promise<void> => {
      const now = Date.now();
      // Throttle updates unless it's the final one
      if (!isFinal && now - lastUpdateTime < updateIntervalMs) {
        return;
      }
      // Only update if content actually changed significantly (or it's the final update)
      if (
        !isFinal &&
        content.length -
          (
            currentReplyMessage?.content ??
            currentReplyMessage?.embeds[0]?.description ??
            ''
          ).length <
          minContentLengthChange
      ) {
        return;
      }

      lastUpdateTime = now;
      let contentToSend = content;
      let remainingContent: string | null = null;

      if (contentToSend.length > characterLimit) {
        remainingContent = contentToSend.substring(characterLimit);
        contentToSend = contentToSend.substring(0, characterLimit);
        this.logger.warn(
          `[${message.id}] Response chunk exceeded limit (${characterLimit}). Splitting message.`,
        );
      }

      // Define messagePayload outside the try block to ensure scope for catch block
      let messagePayload: any; // Use 'any' for flexibility or define a specific type

      try {
        const embed = new EmbedBuilder();
        const descriptionText = contentToSend || '...'; // Use placeholder if empty
        const finalDescription = isFinal
          ? descriptionText
          : `${descriptionText} ⚪`;
        const finalColor = isFinal ? 0x00ff00 : 0xffa500; // Green for final, Orange for streaming

        if (isFinal && !contentToSend.trim()) {
          // Handle final empty message case
          this.logger.debug(
            `[${message.id}] Final response is empty, sending completion indicator.`,
          );
          messagePayload = usePlainResponses
            ? { content: '✅' }
            : { embeds: [embed.setDescription('✅').setColor(0x00ff00)] }; // Green check
        } else {
          // Regular message payload
          messagePayload = usePlainResponses
            ? { content: contentToSend || '...' } // Send placeholder if empty
            : {
                embeds: [
                  embed.setDescription(finalDescription).setColor(finalColor),
                ],
              };
        }

        if (!currentReplyMessage) {
          // Send initial message
          // Use messagePayload here
          currentReplyMessage = await message.reply(messagePayload);
          replyMessages.push(currentReplyMessage);
          this.logger.debug(
            `[${message.id}] Sent initial streaming message ${currentReplyMessage.id}`,
          );
        } else {
          // Edit existing message
          await currentReplyMessage.edit(messagePayload);
          this.logger.debug(
            `[${message.id}] Edited streaming message ${currentReplyMessage.id}`,
          );
        }

        // Handle content that exceeded the limit by sending a new message
        if (remainingContent !== null) {
          // Check if the channel is text-based and has the 'send' method (type guard)
          if (
            message.channel.isTextBased() &&
            'send' in message.channel &&
            remainingContent
          ) {
            // Ensure remainingContent is not null/empty
            const followUpEmbed = new EmbedBuilder();
            const followUpDescription = isFinal
              ? remainingContent
              : `${remainingContent} ⚪`;
            const followUpColor = isFinal ? 0x00ff00 : 0xffa500;

            const followUpPayload = usePlainResponses
              ? { content: remainingContent } // Plain text doesn't get indicators/colors
              : {
                  embeds: [
                    followUpEmbed
                      .setDescription(followUpDescription)
                      .setColor(followUpColor),
                  ],
                };
            try {
              // Send the rest in a new message and update currentReplyMessage
              // Type assertion might still be needed if 'send' isn't fully narrowed
              const followUpMessage = await (
                message.channel as TextChannel | DMChannel | NewsChannel
              ).send(followUpPayload);
              currentReplyMessage = followUpMessage; // Update the message being edited
              replyMessages.push(followUpMessage);
              this.logger.debug(
                `[${message.id}] Sent follow-up streaming message ${followUpMessage.id}`,
              );
            } catch (sendError) {
              this.logger.error(
                `[${message.id}] Failed to send follow-up message:`,
                sendError,
              );
              // Decide how to handle this - maybe truncate? For now, log and potentially lose data.
            }
          } else {
            this.logger.warn(
              `[${message.id}] Cannot send follow-up message in channel type: ${message.channel.type} (not text-based or lacks send method)`,
            );
            // Log and potentially lose data if channel doesn't support send
          }
        }
      } catch (error: any) {
        if (error.code === 50035 && error.message.includes('longer than')) {
          // DiscordAPIError[50035]: Invalid Form Body (content: Must be 2000 or fewer in length.)
          this.logger.warn(
            `[${message.id}] Content exceeded limit during edit/reply, likely race condition or calculation error. Truncating slightly.`,
          );
          // Attempt to truncate and retry ONCE. More complex retry logic could be added.
          try {
            const slightlyTruncatedContent = contentToSend.substring(
              0,
              characterLimit - 10,
            ); // Shave off a bit more
            const truncatedPayload = usePlainResponses
              ? { content: slightlyTruncatedContent || '...' }
              : {
                  embeds: [
                    new EmbedBuilder().setDescription(
                      slightlyTruncatedContent || '...',
                    ),
                  ],
                };
            if (currentReplyMessage) {
              // Add type assertion here as well for safety
              await (currentReplyMessage as Message).edit(truncatedPayload);
            } else {
              // This case is less likely but possible if initial reply failed due to length
              currentReplyMessage = await message.reply(truncatedPayload);
              replyMessages.push(currentReplyMessage);
            }
          } catch (retryError) {
            this.logger.error(
              `[${message.id}] Failed to edit/reply even after truncating:`,
              retryError,
            );
          }
        } else if (error.code === 429) {
          // Rate limited
          this.logger.warn(
            `[${message.id}] Discord rate limit hit during streaming update. Skipping update.`,
          );
          // Optional: Implement backoff delay for the *next* update attempt
          lastUpdateTime += 2000; // Add 2 seconds penalty to delay next update
        } else {
          this.logger.error(
            `[${message.id}] Failed to update Discord response:`,
            error,
          );
          // Consider stopping the stream or marking the message with an error indicator
        }
      }
    };

    try {
      // --- Prepare Generation Options ---
      let generationOptions: GenerationOptions | undefined = undefined;
      const modelSetting = this.config.model;
      if (modelSetting && modelSetting.includes('/')) {
        const [providerName] = modelSetting.split('/', 2);
        let providerConfig: any = undefined; // Use 'any' for dynamic access, or add specific checks

        // Safely access provider-specific config
        if (providerName === 'openai' && this.config.llm.openai) {
          providerConfig = this.config.llm.openai;
        } else if (
          (providerName === 'gemini' ||
            providerName === 'google' ||
            providerName === 'google-gemini') &&
          this.config.llm.gemini
        ) {
          providerConfig = this.config.llm.gemini;
        } else if (providerName === 'ollama' && this.config.llm.ollama) {
          providerConfig = this.config.llm.ollama;
        }
        // TODO: Add handling for other potential custom providers if needed

        // Initialize generationOptions if needed
        if (!generationOptions) {
          generationOptions = {};
        }
        // Populate temperature and maxOutputTokens from config if available, respecting undefined
        const tempFromConfig =
          providerConfig?.temperature ?? this.config.llm.defaultTemperature;
        if (tempFromConfig !== undefined) {
          generationOptions.temperature = tempFromConfig;
        }
        const maxTokensFromConfig =
          providerConfig?.maxOutputTokens ?? this.config.llm.defaultMaxTokens;
        if (maxTokensFromConfig !== undefined) {
          generationOptions.maxOutputTokens = maxTokensFromConfig;
        }

        this.logger.debug(
          `[${message.id}] Using base generation options: temp=${generationOptions.temperature ?? 'default'}, maxTokens=${generationOptions.maxOutputTokens ?? 'default'}`,
        );
      } else {
        this.logger.warn(
          `[${message.id}] Could not parse provider name from config.model: "${modelSetting}". Using default generation parameters.`,
        );
        // Initialize generationOptions if needed, potentially with defaults
        if (!generationOptions) {
          generationOptions = {};
        }
        // Assign defaults only if they exist in config
        if (this.config.llm.defaultTemperature !== undefined) {
          generationOptions.temperature = this.config.llm.defaultTemperature;
        }
        if (this.config.llm.defaultMaxTokens !== undefined) {
          generationOptions.maxOutputTokens = this.config.llm.defaultMaxTokens;
        }
      }

      // Add tools to options if the provider supports them
      if (this.llmProvider.supportsTools()) {
        if (!generationOptions) {
          generationOptions = {};
        } // Ensure options object exists
        generationOptions.tools = this.toolRegistry.getToolDefinitions(); // Use ToolRegistry
        this.logger.debug(
          `[${message.id}] Adding ${this.toolRegistry.getToolDefinitions().length} tools to generation options.`,
        ); // Use ToolRegistry
      }

      // Send initial placeholder message BEFORE starting the stream
      try {
        const initialPayload = usePlainResponses
          ? { content: '...' }
          : { embeds: [new EmbedBuilder().setDescription('...')] };
        currentReplyMessage = await message.reply(initialPayload);
        replyMessages.push(currentReplyMessage);
        this.logger.debug(
          `[${message.id}] Sent initial placeholder message ${currentReplyMessage.id}`,
        );
      } catch (initialReplyError) {
        this.logger.error(
          `[${message.id}] Failed to send initial placeholder reply:`,
          initialReplyError,
        );
        // If we can't even send the placeholder, abort processing for this message
        return;
      }

      let stream: AsyncGenerator<StreamChunk, void, undefined>;
      let finalSystemPrompt: string | undefined = undefined;
      let historyToUse = [...history]; // Start with a copy of the history

      // --- Log prompt retrieval and capability check ---
      this.logger.debug(
        `[${message.id}] Base system prompt from config: ${baseSystemPromptText ? `'${baseSystemPromptText.substring(0, 50)}...'` : 'undefined'}`,
      );
      this.logger.debug(
        `[${message.id}] Formatted memory for prompt: ${formattedMemoryForPrompt ? `'${formattedMemoryForPrompt.substring(0, 100)}...'` : 'None'}`,
      );
      this.logger.debug(
        `[${message.id}] Instructions: ${instructions ? `'${instructions.substring(0, 100)}...'` : 'None'}`,
      );

      const providerSupportsSystem = this.llmProvider.supportsSystemPrompt();
      this.logger.debug(
        `[${message.id}] Provider supports system prompt: ${providerSupportsSystem}`,
      );

      if (providerSupportsSystem) {
        // Combine all parts for the system prompt argument
        finalSystemPrompt = (
          baseSystemPromptText +
          formattedMemoryForPrompt +
          instructions
        ).trim();
        this.logger.debug(
          `[${message.id}] Passing history and combined system prompt to generateStream. SystemPrompt: ${finalSystemPrompt ? `'${finalSystemPrompt.substring(0, 100)}...'` : 'undefined'}`,
        );
        // History already contains messages, memory was NOT injected here earlier
        stream = this.llmProvider.generateStream(
          historyToUse,
          finalSystemPrompt,
          generationOptions,
        );
      } else {
        // Prepend system prompt, memory, and instructions to the first user message
        this.logger.debug(
          `[${message.id}] Provider does not support system role. Prepending prompt, memory, and instructions to first user message.`,
        );
        const combinedPrefix = (
          baseSystemPromptText +
          formattedMemoryForPrompt +
          instructions
        ).trim();
        const userMessageIndex = historyToUse.findIndex(
          (msg) => msg.role === 'user',
        );

        if (userMessageIndex !== -1 && combinedPrefix) {
          const userMessage = historyToUse[userMessageIndex];
          if (userMessage) {
            const separator = '\n\n---\n\n'; // Define a clear separator
            const prefixWithSeparator = `${combinedPrefix}${separator}`;
            if (typeof userMessage.content === 'string') {
              userMessage.content = prefixWithSeparator + userMessage.content;
            } else {
              // It's ChatMessageContentPart[]
              let textPart = userMessage.content.find(
                (part) => part.type === 'text',
              ) as ChatMessageContentPartText | undefined;
              if (textPart) {
                textPart.text = prefixWithSeparator + textPart.text;
              } else {
                userMessage.content.unshift({
                  type: 'text',
                  text: prefixWithSeparator.trim(),
                });
              }
            }
            this.logger.debug(
              `[${message.id}] Combined prompt prepended to message ${userMessageIndex}.`,
            );
          } else {
            this.logger.warn(
              `[${message.id}] Found user message index but message object was undefined.`,
            );
          }
        } else if (combinedPrefix) {
          this.logger.warn(
            `[${message.id}] Could not find user message to prepend combined prompt.`,
          );
        }
        // Call generateStream without the systemPrompt argument
        this.logger.debug(
          `[${message.id}] Passing modified history to generateStream (prepended). History: ${JSON.stringify(historyToUse)}, SystemPrompt: undefined`,
        );
        stream = this.llmProvider.generateStream(
          historyToUse,
          undefined,
          generationOptions,
        );
      }

      this.logger.debug(`[${message.id}] LLM Stream Start`);
      let toolCallsDetected: ToolCallRequest[] | null = null; // Variable to store detected tool calls

      for await (const chunk of stream) {
        // Handle content chunks
        if (chunk.content) {
          accumulatedResponse += chunk.content;
          // Update Discord periodically - pass isFinal=false
          await updateDiscordResponse(accumulatedResponse, false);
        }

        // Handle tool call chunks (often arrive in the final chunk)
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          toolCallsDetected = chunk.toolCalls;
          this.logger.info(
            `[${message.id}] Tool call(s) detected in stream chunk: ${JSON.stringify(chunk.toolCalls)}`,
          );
          // Don't break yet, wait for isFinal
        }

        // Handle final chunk
        if (chunk.isFinal) {
          this.logger.info(
            `[${message.id}] LLM Stream End. Reason: ${chunk.finishReason}. Total length: ${accumulatedResponse.length}. Tool Calls: ${!!toolCallsDetected}`,
          );
          // Final update for any remaining content
          await updateDiscordResponse(accumulatedResponse, true);

          // --- Tool Call Handling ---
          if (toolCallsDetected) {
            this.logger.info(
              `[${message.id}] Handling ${toolCallsDetected.length} tool call(s).`,
            );

            // 1. Add the assistant's message requesting the tool call(s) to history
            //    Construct the content array with text and functionCall parts.
            const assistantContentParts: ChatMessageContentPart[] = [];
            if (accumulatedResponse) {
              assistantContentParts.push({
                type: 'text',
                text: accumulatedResponse,
              });
            }
            // Add a functionCall part for each detected tool call
            toolCallsDetected.forEach((tc) => {
              assistantContentParts.push({
                type: 'functionCall',
                functionCall: {
                  name: tc.toolName,
                  args: tc.args,
                },
              });
            });
            historyToUse.push({
              // Add to the history being used for the next call
              role: 'assistant',
              content: assistantContentParts, // Use the constructed parts array
            });

            // 2. Execute tools and collect results
            const toolResultMessages: ChatMessage[] = [];
            for (const toolCall of toolCallsDetected) {
              const toolResultContent = await this._executeToolCall(toolCall);
              toolResultMessages.push({
                role: 'tool', // Use 'tool' role for results
                tool_call_id: toolCall.id, // Associate result with the call ID
                tool_name: toolCall.toolName, // Add the name of the tool that was called
                content: toolResultContent, // Content is the result of the tool execution
              });
            }

            // 3. Add tool results to history
            historyToUse.push(...toolResultMessages);

            // WORKAROUND RE-ADDED: Gemini API requires the last message to have role 'user'.
            // Add a placeholder user message after the tool results with descriptive content.
            const placeholderText = 'Okay, proceed based on the tool result.';
            historyToUse.push({ role: 'user', content: placeholderText });
            this.logger.debug(
              `[${message.id}] Added placeholder user message ('${placeholderText}') to history for Gemini API compliance.`,
            );
            +(
              // 4. Call LLM again with updated history (including tool results and placeholder)
              this.logger.info(
                `[${message.id}] Re-calling LLM after tool execution with updated history (${historyToUse.length} messages).`,
              )
            );

            // Reset response state for the second stream
            accumulatedResponse = ''; // Reset accumulated response
            // Keep replyMessages, currentReplyMessage, lastUpdateTime? Or reset?
            // Let's reset update time, but keep the message objects to edit them.
            lastUpdateTime = 0;

            // Prepare generation options for the second call (potentially without tools)
            const secondCallOptions = { ...generationOptions };
            // Decide if tools should be passed again. Usually not, unless multi-turn tool use is intended.
            // delete secondCallOptions.tools; // Remove tools for the second call

            // ADDED LOG: Inspect history before second call
            this.logger.debug(
              `[${message.id}] History before second LLM call: ${JSON.stringify(historyToUse, null, 2)}`,
            );

            // Determine system prompt handling for the second call based on provider capability
            let secondSystemPrompt: string | undefined = undefined;
            let secondHistory = [...historyToUse]; // Copy history for potential modification

            if (providerSupportsSystem) {
              secondSystemPrompt = finalSystemPrompt; // Reuse the same combined prompt
              this.logger.debug(
                `[${message.id}] Passing history and system prompt for second call.`,
              );
            } else {
              // Prepend the combined prompt again if needed (or handle differently?)
              // For simplicity, let's assume the first message is still user after tool results + placeholder
              this.logger.debug(
                `[${message.id}] Prepending combined prompt for second call.`,
              );
              const combinedPrefix = (
                baseSystemPromptText +
                formattedMemoryForPrompt +
                instructions
              ).trim();
              const userMessageIndex = secondHistory.findIndex(
                (msg) => msg.role === 'user',
              );
              if (userMessageIndex !== -1 && combinedPrefix) {
                const userMessage = secondHistory[userMessageIndex];
                if (userMessage) {
                  const separator = '\n\n---\n\n';
                  const prefixWithSeparator = `${combinedPrefix}${separator}`;
                  if (typeof userMessage.content === 'string') {
                    userMessage.content =
                      prefixWithSeparator + userMessage.content;
                  } else {
                    let textPart = userMessage.content.find(
                      (part) => part.type === 'text',
                    ) as ChatMessageContentPartText | undefined;
                    if (textPart) {
                      textPart.text = prefixWithSeparator + textPart.text;
                    } else {
                      userMessage.content.unshift({
                        type: 'text',
                        text: prefixWithSeparator.trim(),
                      });
                    }
                  }
                }
              }
              secondSystemPrompt = undefined; // Pass undefined system prompt
            }

            const secondStream = this.llmProvider.generateStream(
              secondHistory,
              secondSystemPrompt,
              secondCallOptions,
            );

            // 5. Process the second stream
            for await (const secondChunk of secondStream) {
              if (secondChunk.content) {
                accumulatedResponse += secondChunk.content;
                await updateDiscordResponse(accumulatedResponse, false);
              }
              // Handle potential nested tool calls if the API supports it (unlikely/complex)
              if (secondChunk.toolCalls && secondChunk.toolCalls.length > 0) {
                this.logger.warn(
                  `[${message.id}] Nested tool calls detected in second LLM response. This is not fully supported. Ignoring.`,
                );
              }
              if (secondChunk.isFinal) {
                this.logger.info(
                  `[${message.id}] Second LLM Stream End. Reason: ${secondChunk.finishReason}. Final length: ${accumulatedResponse.length}.`,
                );
                await updateDiscordResponse(accumulatedResponse, true); // Final update for the second response
                break; // Exit second stream loop
              }
            }
            // After handling the second stream, the final response is in accumulatedResponse.
            // We can now let the rest of the function proceed (memory suggestions, final update).
            finalResponseToUser = accumulatedResponse; // Update the final response
          } // --- End Tool Call Handling ---

          break; // Exit loop on final chunk
        }
      }

      this.logger.debug(
        `[${message.id}] Full LLM Response processed (length: ${accumulatedResponse.length})`,
      );

      // --- Process Memory Tags (using helper method) ---
      // Use finalResponseToUser if it was updated by tool calls, otherwise use accumulatedResponse
      const responseToCheckForMemory =
        finalResponseToUser || accumulatedResponse;
      finalResponseToUser = this._processMemorySuggestions(
        userId,
        responseToCheckForMemory,
        message.id,
      );

      // --- Placeholder: Reasoning Logic ---
      if (this.reasoningManager?.isEnabled() && finalResponseToUser) {
        const userId = message.author.id;
        // Use finalResponseToUser which has memory tags removed
        if (this.reasoningManager.checkResponseForSignal(finalResponseToUser)) {
          if (!this.reasoningManager.checkRateLimit(userId)) {
            const signal =
              this.reasoningManager.getReasoningSignal(finalResponseToUser);
            if (signal) {
              try {
                this.logger.info(
                  `[${message.id}] Invoking reasoning manager for user ${userId}...`,
                );
                // Pass original history and userId
                // Set temporary status before starting reasoning
                this.statusManager.setTemporaryStatus(
                  '🧠 Reasoning...',
                  60, // Set a reasonable duration, clearTemporaryStatus will handle early completion
                  undefined, // Default type
                  'idle',
                );

                // Edit placeholder to show reasoning is in progress
                if (currentReplyMessage) {
                    await currentReplyMessage.edit('🧠 Reasoning...');
                }

                let accumulatedReasoningResponse = '';
                let reasoningErrorOccurred = false;
                let finalReason: FinishReason = 'unknown';

                // Get the stream generator
                const reasoningStream = this.reasoningManager.generateReasoningResponse(
                    history,
                    signal,
                    userId,
                );
                const iterator = reasoningStream[Symbol.asyncIterator]();
                let firstChunkReceived = false;

                // Start a 5-second timer
                const timeoutId = setTimeout(() => {
                    if (!firstChunkReceived && currentReplyMessage) {
                        this.logger.info(`[${message.id}] Reasoning taking longer than 5s, updating status...`);
                        currentReplyMessage.edit('🧠 Thinking deeper...').catch(editError => {
                             this.logger.warn(`[${message.id}] Failed to edit message to 'Thinking deeper...': ${editError.message}`);
                        });
                    }
                }, 5000);


                // Process the stream using a while loop
                while (true) {
                    const result = await iterator.next();
                    firstChunkReceived = true; // Mark as received once iterator.next() resolves

                    if (result.done) {
                        clearTimeout(timeoutId); // Clear timeout if stream finishes
                        this.logger.info(`[${message.id}] Reasoning stream iteration finished.`);
                        break; // Exit the while loop
                    }

                    const chunk = result.value;
                    this.logger.debug(`[${message.id}] Received reasoning chunk. Content length: ${chunk.content?.length ?? 0}, isFinal: ${chunk.isFinal}`);

                    if (chunk.content) {
                        accumulatedReasoningResponse += chunk.content;
                        // Throttle intermediate updates
                        const now = Date.now();
                        if (currentReplyMessage && accumulatedReasoningResponse.trim() && (now - lastUpdateTime > updateIntervalMs)) {
                            lastUpdateTime = now;
                            const contentToShow = accumulatedReasoningResponse.substring(0, characterLimit);
                            const intermediatePayload = usePlainResponses
                                ? { content: `${contentToShow} ⚪` }
                                : { embeds: [new EmbedBuilder().setDescription(`${contentToShow} ⚪`).setColor(0xffa500)] };
                            try {
                                await currentReplyMessage.edit(intermediatePayload);
                                this.logger.debug(`[${message.id}] Updated reasoning stream message ${currentReplyMessage.id}`);
                            } catch (editError: any) {
                                this.logger.warn(`[${message.id}] Failed to edit reasoning stream message: ${editError.message}`);
                                if (editError.code === 429) lastUpdateTime = 0;
                            }
                        }
                    }

                    if (chunk.isFinal) {
                        clearTimeout(timeoutId); // Clear timeout on final chunk
                        finalReason = chunk.finishReason ?? 'unknown';
                        if (finalReason === 'error') {
                            reasoningErrorOccurred = true;
                            this.logger.error(`[${message.id}] Reasoning stream finished with error: ${chunk.content || 'Unknown error'}`);
                            accumulatedReasoningResponse = chunk.content || 'Reasoning failed.';
                        } else {
                             this.logger.info(`[${message.id}] Reasoning stream finished with reason: ${finalReason}`);
                        }
                        break; // Exit the while loop
                    }
                }
                // Ensure timeout is cleared if loop exits unexpectedly (e.g., error before isFinal)
                clearTimeout(timeoutId);

                // Update final response based on accumulated stream content
                if (!reasoningErrorOccurred && accumulatedReasoningResponse.trim()) {
                     finalResponseToUser = accumulatedReasoningResponse.trim();
                     this.logger.info(`[${message.id}] Reasoning completed successfully.`);
                } else if (!reasoningErrorOccurred) {
                     // Stream finished without error but no content was generated
                     this.logger.warn(`[${message.id}] Reasoning stream finished successfully but produced no content. Falling back.`);
                     // Fallback: Remove the reasoning tags from the original response
                     const startSignal = this.config.reasoning?.signalStart ?? '[REASONING_REQUEST]';
                     const endSignal = this.config.reasoning?.signalEnd ?? '[/REASONING_REQUEST]';
                     const escapedStart = startSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                     const escapedEnd = endSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                     const stripRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'gi');
                     finalResponseToUser = finalResponseToUser.replace(stripRegex, '').trim(); // Use original finalResponseToUser here
                } else {
                     // Error occurred during stream, use the error message from the chunk
                     finalResponseToUser = accumulatedReasoningResponse.trim();
                }
              } catch (reasoningError) {
                this.logger.error(
                  `[${message.id}] Error during reasoning process:`,
                  reasoningError,
                );
                // Fallback: Remove only the start tag from the original response on error
                const startSignal = this.config.reasoning?.signalStart ?? '[REASONING_REQUEST]';
                finalResponseToUser = finalResponseToUser.replace(startSignal, '').trim();
              }
            } else {
               // --- NEW LOGIC for when ONLY START tag is found ---
               this.logger.info(
                   `[${message.id}] Reasoning start tag detected without end tag. Extracting fallback signal.`,
               );
               const startSignal = this.config.reasoning?.signalStart ?? '[REASONING_REQUEST]';
               // Use accumulatedResponse here to ensure we check the raw response before memory tags were stripped
               const startIndex = accumulatedResponse.indexOf(startSignal);

               if (startIndex !== -1) {
                   // Use accumulatedResponse here to extract from the raw response
                   const fallbackSignal = accumulatedResponse.substring(startIndex + startSignal.length).trim();

                   // Proceed with reasoning even if fallbackSignal is empty, as per instructions.
                   // An empty fallbackSignal means the primary model responded *only* with the start tag.
                   this.logger.debug(`[${message.id}] Using fallback signal (may be empty): '${fallbackSignal.substring(0, 50)}...'`);
                   try {
                       // Edit placeholder to show reasoning is in progress
                       if (currentReplyMessage) {
                           await currentReplyMessage.edit('🧠 Reasoning (fallback)...');
                       }

                       let accumulatedReasoningResponse = '';
                       let reasoningErrorOccurred = false;
                       let finalReason: FinishReason = 'unknown';

                       // Get the stream generator
                       const reasoningStream = this.reasoningManager.generateReasoningResponse(
                           history, // Assuming 'history' is the correct variable name
                           fallbackSignal,
                           userId,
                       );

                       // Iterate over the stream and update message
                        let deeperThinkingTimeout: NodeJS.Timeout | null = null;
                        let deeperThinkingMessageShown = false;

                        if (currentReplyMessage) {
                            deeperThinkingTimeout = setTimeout(async () => {
                                // Check if we haven't received any content yet and haven't already shown the message
                                if (accumulatedReasoningResponse.trim() === '' && !deeperThinkingMessageShown && currentReplyMessage) {
                                    this.logger.info(`[${message.id}] Fallback reasoning taking longer than 5s. Displaying 'Thinking deeper...'`);
                                    deeperThinkingMessageShown = true; // Mark as shown
                                    try {
                                        // Use consistent payload structure
                                        const deeperPayload = usePlainResponses
                                            ? { content: '🤔 Thinking deeper...' }
                                            : { embeds: [new EmbedBuilder().setDescription('🤔 Thinking deeper...').setColor(0xaaaaaa)] }; // Grey embed
                                        await currentReplyMessage.edit(deeperPayload);
                                    } catch (editError) {
                                        this.logger.error(`[${message.id}] Error editing message for 'Thinking deeper...':`, editError);
                                    }
                                }
                            }, 5000); // 5 seconds timeout
                        }


                       for await (const chunk of reasoningStream) {
                           this.logger.debug(`[${message.id}] Received fallback reasoning chunk. Content length: ${chunk.content?.length ?? 0}, isFinal: ${chunk.isFinal}`);
                           if (chunk.content) {
                               accumulatedReasoningResponse += chunk.content;
                               // Throttle intermediate updates
                                const now = Date.now();
                                if (currentReplyMessage && accumulatedReasoningResponse.trim() && (now - lastUpdateTime > updateIntervalMs)) {
                                    lastUpdateTime = now;
                                    // Use consistent payload structure (plain/embed) based on config
                                    const contentToShow = accumulatedReasoningResponse.substring(0, characterLimit); // Ensure within limit
                                    const intermediatePayload = usePlainResponses
                                        ? { content: `${contentToShow} ⚪` } // Add streaming indicator
                                        : { embeds: [new EmbedBuilder().setDescription(`${contentToShow} ⚪`).setColor(0xffa500)] }; // Orange embed
                                    try {
                                        await currentReplyMessage.edit(intermediatePayload);
                                        this.logger.debug(`[${message.id}] Updated fallback reasoning stream message ${currentReplyMessage.id}`);
                                    } catch (editError: any) {
                                        // Log errors during intermediate edits but continue stream
                                        this.logger.warn(`[${message.id}] Failed to edit fallback reasoning stream message: ${editError.message}`);
                                        // Reset update time to allow next attempt sooner if rate limited
                                        if (editError.code === 429) lastUpdateTime = 0;
                                    }
                                }
                            // Clear the 'Thinking deeper...' timeout as soon as the first chunk arrives
                            if (deeperThinkingTimeout) {
                                clearTimeout(deeperThinkingTimeout);
                                deeperThinkingTimeout = null;
                            }

                           }
                           // TODO: Handle chunk.toolCalls if needed
                           if (chunk.isFinal) {
                               finalReason = chunk.finishReason ?? 'unknown';
                               if (finalReason === 'error') {
                                   reasoningErrorOccurred = true;
                                   this.logger.error(`[${message.id}] Fallback reasoning stream finished with error: ${chunk.content || 'Unknown error'}`);
                                   accumulatedReasoningResponse = chunk.content || 'Fallback reasoning failed.';
                               } else {
                                   this.logger.info(`[${message.id}] Fallback reasoning stream finished with reason: ${finalReason}`);
                               }
                               break; // Exit loop on final chunk
                           }
                       }

                       // Update final response based on accumulated stream content
                       if (!reasoningErrorOccurred && accumulatedReasoningResponse.trim()) {
                            finalResponseToUser = accumulatedReasoningResponse.trim();
                            this.logger.info(`[${message.id}] Fallback reasoning completed successfully.`);
                       } else if (!reasoningErrorOccurred) {
                            // Stream finished without error but no content was generated
                            this.logger.warn(`[${message.id}] Fallback reasoning stream finished successfully but produced no content. Removing tag.`);
                            // Fallback: Remove only the start tag from the original response
                            finalResponseToUser = accumulatedResponse.replace(startSignal, '').trim(); // Use accumulatedResponse (original)
                       } else {
                            // Error occurred during stream, use the error message from the chunk
                            finalResponseToUser = accumulatedReasoningResponse.trim();
                       }

                   } catch (reasoningError) {
                       this.logger.error(
                           `[${message.id}] Error initiating fallback reasoning process:`, // Updated log message
                           reasoningError,
                       );
                       // Fallback: Remove only the start tag from the original response
                       finalResponseToUser = accumulatedResponse.replace(startSignal, '').trim();
                   }
                   // Removed the 'else' block that previously handled empty fallbackSignal incorrectly.
               } else {
                   // Should not happen if signalDetected is true, but handle defensively
                   this.logger.error(`[${message.id}] Signal detected but start index not found. This shouldn't happen. Removing tag.`);
                   // Fallback: Remove the start tag just in case
                    finalResponseToUser = finalResponseToUser.replace(startSignal, '').trim();
               }
            }
          } else {
            this.logger.warn(
              `[${message.id}] Reasoning request rate limited for user ${userId}.`,
            );
            // Fallback: Remove only the start tag if rate limited
            const startSignal = this.config.reasoning?.signalStart ?? '[REASONING_REQUEST]';
            finalResponseToUser = finalResponseToUser.replace(startSignal, '').trim();
          }
        }
      }
      // Clear reasoning temporary status regardless of outcome
      this.statusManager.clearTemporaryStatus();

      // --- Final Update ---
      // Add user warnings to the final response if any exist
      const warningsString =
        userWarnings.length > 0 // Corrected from .size to .length for array
          ? `\n\n*(${Array.from(userWarnings).join(', ')})*`
          : '';
      const finalContentWithWarnings =
        (finalResponseToUser ||
          (warningsString ? '' : 'No response generated.')) + warningsString; // Ensure something is sent

      if (finalContentWithWarnings.trim()) {
        await updateDiscordResponse(finalContentWithWarnings, true); // Perform final update
        this.logger.info(`[${message.id}] Final response sent/updated.`);
      } else {
        this.logger.info(
          `[${message.id}] No content left to send after processing tags and adding warnings.`,
        );
        // The logic to handle empty final messages is now inside updateDiscordResponse
      }
    } catch (error: any) {
      // Keep the : any type from the actual file content
      this.logger.error(
        `[${message.id}] Error processing message with LLM:`,
        error,
      ); // Keep the exact error message
      try {
        // Attempt to send an error message back to the user
        await message.reply(
          'Sorry, I encountered an error while processing your request.',
        ); // Keep the exact reply text
      } catch (replyError) {
        this.logger.error(
          `[${message.id}] Failed to send error reply to Discord:`,
          replyError,
        ); // Keep the exact error message
      }
    }
  } // End processMessage

  /**
   * Executes a requested tool call using the ToolRegistry.
   * Parses arguments and calls the appropriate tool implementation.
   * @param toolCall - The tool call request from the LLM.
   * @returns A promise resolving to the stringified result of the tool execution, suitable for the LLM.
   * @private
   */
  private async _executeToolCall(toolCall: ToolCallRequest): Promise<string> {
    // Return type is string for LLM
    this.logger.info(
      `Executing tool: ${toolCall.toolName} with ID: ${toolCall.id}`,
    );
    let result: any;
    try {
      // Ensure args are parsed correctly. Some providers might send an object directly.
      const args =
        typeof toolCall.args === 'string'
          ? JSON.parse(toolCall.args)
          : toolCall.args;

      // Execute the tool using the registry
      result = await this.toolRegistry.executeTool(toolCall.toolName, args);
      this.logger.debug(
        `Tool ${toolCall.toolName} executed successfully with result: ${JSON.stringify(result)}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Error executing tool ${toolCall.toolName} (ID: ${toolCall.id}):`,
        error,
      );
      // Format the error message to be sent back to the LLM
      result = `Error: ${error.message || 'Unknown error during tool execution'}`;
    }

    // Return result in a format suitable for the 'tool' role message
    // Usually, this is just the stringified result, but check provider docs.
    // Ensure even errors are stringified if they aren't already.
    return typeof result === 'string' ? result : JSON.stringify(result);
  }
} // End of LLMCordBot class
