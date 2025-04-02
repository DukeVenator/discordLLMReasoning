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
  // EmbedBuilder, // Removed - No longer used directly
  // TextChannel, // Removed - No longer used directly
  // DMChannel, // Removed - No longer used directly
  // NewsChannel, // Removed - No longer used directly
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
import { ResponseManager } from '@/discord/ResponseManager'; // Added for response handling

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
    const messageLogger = this.logger.getSubLogger({ // Create logger specific to this message processing
        name: 'MessageProcessing',
        messageId: message.id,
        userId: message.author.id,
        channelId: message.channelId,
    });
    messageLogger.info(
      `Processing message from ${message.author.tag} in channel ${message.channelId}`,
    );

    // --- Instantiate Response Manager ---
    const responseManager = new ResponseManager({
        originalMessage: message,
        config: this.config,
        logger: messageLogger, // Pass the message-specific logger
        initialContent: '🧠 Thinking...', // Or fetch from config if needed
    });

    // --- Build History ---
    // Use the messageProcessor instance to build history
    messageLogger.debug('Building message history...');
    const { history, warnings: userWarnings } = await this.messageProcessor.buildMessageHistory(message); // Updated call and return type handling
    messageLogger.debug(`History built. Length: ${history.length}, Warnings: ${userWarnings.length}`);

    // --- Fetch User Memory (Consolidated) ---
    const userId = message.author.id;
    let userMemoryContent: string | null = null;
    if (this.config.memory.enabled && this.memoryStorage) {
      try {
        userMemoryContent = await this.memoryStorage.getMemory(userId);
        messageLogger.debug(
          `Fetched memory for user ${userId}. Length: ${userMemoryContent?.length ?? 0}`,
        );
      } catch (memError) {
        messageLogger.error(
          `Failed to retrieve memory for user ${userId}:`,
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
    if (history.filter((msg) => msg.role === 'user' || msg.role === 'assistant').length === 0) {
      // Check if only user/assistant messages remain (system/tool roles are ok)
      messageLogger.warn(
        `No user/assistant content found in message or its history. Aborting.`,
      );
      if (userWarnings.length > 0) { // Check length of array
        try {
          // Combine warnings with the reason for stopping
          const stopReason = 'No message content to process';
          const combinedWarnings = userWarnings.map(w => w.message).join('\n'); // Use newline for multiple warnings
          await responseManager.handleError(new Error(`Processing stopped: ${stopReason}${combinedWarnings ? `\n(${combinedWarnings})` : ''}`));
        } catch (replyError) {
          messageLogger.error(
            `Failed to send warning reply via ResponseManager:`,
            replyError,
          );
        }
      } else {
        try {
          // Send a simple notification if there were no other warnings
          await responseManager.handleError(new Error('Processing stopped: No message content found.'));
        } catch (replyError) {
          messageLogger.error(
            `Failed to send stop notification reply via ResponseManager:`,
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
    const formattedMemoryForPrompt = this.config.memory.enabled
      ? this._formatMemoryForSystemPrompt(userMemoryContent)
      : ''; // Don't include memory prompt section if disabled
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
      messageLogger.debug(`Appended memory instructions.`);
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
      messageLogger.debug(
        `[${message.id}] Appended reasoning trigger instructions.`,
      );
    }

    // --- Call LLM & Stream Response ---
    // Removed second old memory injection block (now handled at the start)

    // --- Call LLM & Stream Response ---
    let accumulatedResponse = '';
    // Removed replyMessages, currentReplyMessage, lastUpdateTime, updateIntervalMs, minContentLengthChange, usePlainResponses, characterLimit
    // These are now managed by ResponseManager
    let finalResponseToUser = ''; // Declare here to ensure scope
    // Removed updateDiscordResponse function definition

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

        messageLogger.debug(
          `[${message.id}] Using base generation options: temp=${generationOptions.temperature ?? 'default'}, maxTokens=${generationOptions.maxOutputTokens ?? 'default'}`,
        );
      } else {
        messageLogger.warn( // Re-added the missing logger call
          `Could not parse provider name from config.model: "${modelSetting}". Using default generation parameters.`,
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
        messageLogger.debug(
          `Adding ${this.toolRegistry.getToolDefinitions().length} tools to generation options.`,
        ); // Use ToolRegistry
      }

      // Send initial placeholder message using ResponseManager
      try {
        await responseManager.sendInitialResponse();
        messageLogger.debug(`Sent initial placeholder message via ResponseManager.`);
      } catch (initialReplyError) {
        messageLogger.error(
          `Failed to send initial placeholder reply via ResponseManager:`,
          initialReplyError,
        );
        // If we can't even send the placeholder, abort processing for this message
        return;
      }

      let stream: AsyncGenerator<StreamChunk, void, undefined>;
      let finalSystemPrompt: string | undefined = undefined;
      let historyToUse = [...history]; // Start with a copy of the history

      // --- Log prompt retrieval and capability check ---
      messageLogger.debug(
        `Base system prompt from config: ${baseSystemPromptText ? `'${baseSystemPromptText.substring(0, 50)}...'` : 'undefined'}`,
      );
      messageLogger.debug(
        `Formatted memory for prompt: ${formattedMemoryForPrompt ? `'${formattedMemoryForPrompt.substring(0, 100)}...'` : 'None'}`,
      );
      messageLogger.debug(
        `Instructions: ${instructions ? `'${instructions.substring(0, 100)}...'` : 'None'}`,
      );

      const providerSupportsSystem = this.llmProvider.supportsSystemPrompt();
      messageLogger.debug(
        `Provider supports system prompt: ${providerSupportsSystem}`,
      );

      if (providerSupportsSystem) {
        // Combine all parts for the system prompt argument
        finalSystemPrompt = (
          baseSystemPromptText +
          formattedMemoryForPrompt +
          instructions
        ).trim();
        messageLogger.debug(
          `Passing history and combined system prompt to generateStream. SystemPrompt: ${finalSystemPrompt ? `'${finalSystemPrompt.substring(0, 100)}...'` : 'undefined'}`,
        );
        // History already contains messages, memory was NOT injected here earlier
        stream = this.llmProvider.generateStream(
          historyToUse,
          finalSystemPrompt,
          generationOptions,
        );
      } else {
        // Prepend system prompt, memory, and instructions to the first user message
        messageLogger.debug(
          `Provider does not support system role. Prepending prompt, memory, and instructions to first user message.`,
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
            messageLogger.debug(
              `Combined prompt prepended to message ${userMessageIndex}.`,
            );
          } else {
            messageLogger.warn(
              `Found user message index but message object was undefined.`,
            );
          }
        } else if (combinedPrefix) {
          messageLogger.warn(
            `Could not find user message to prepend combined prompt.`,
          );
        }
        // Call generateStream without the systemPrompt argument
        messageLogger.debug(
          `Passing modified history to generateStream (prepended). History: ${JSON.stringify(historyToUse)}, SystemPrompt: undefined`,
        );
        stream = this.llmProvider.generateStream(
          historyToUse,
          undefined,
          generationOptions,
        );
      }

      messageLogger.debug(`LLM Stream Start`);
      let toolCallsDetected: ToolCallRequest[] | null = null; // Variable to store detected tool calls

      for await (const chunk of stream) {
        // Handle content chunks
        if (chunk.content) {
          // Append to local accumulator *only* if needed elsewhere (e.g., for tag processing)
          if (chunk.content) { // Check if content exists before appending/updating
              accumulatedResponse += chunk.content;
              // Update Discord using ResponseManager - pass only the current chunk
              await responseManager.updateResponse(chunk.content); // No isFinal flag
          }
        }

        // Handle tool call chunks (often arrive in the final chunk)
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          toolCallsDetected = chunk.toolCalls;
          messageLogger.info(
            `[${message.id}] Tool call(s) detected in stream chunk: ${JSON.stringify(chunk.toolCalls)}`,
          );
          // Don't break yet, wait for isFinal
        }

        // Handle final chunk
        if (chunk.isFinal) {
          messageLogger.info(
            `LLM Stream End. Reason: ${chunk.finishReason}. Total length: ${accumulatedResponse.length}. Tool Calls: ${!!toolCallsDetected}`,
          );
          // No update call here - finalize() handles the end state

          // --- Tool Call Handling ---
          if (toolCallsDetected) {
            messageLogger.info(
              `Handling ${toolCallsDetected.length} tool call(s).`,
            );

            // 1. Add the assistant's message requesting the tool call(s) to history
            const assistantContentParts: ChatMessageContentPart[] = [];
            if (accumulatedResponse) {
              assistantContentParts.push({ type: 'text', text: accumulatedResponse });
            }
            toolCallsDetected.forEach((tc) => {
              assistantContentParts.push({
                type: 'functionCall',
                functionCall: { name: tc.toolName, args: tc.args },
              });
            });
            historyToUse.push({ role: 'assistant', content: assistantContentParts });

            // 2. Execute tools and collect results
            const toolResultMessages: ChatMessage[] = [];
            for (const toolCall of toolCallsDetected) {
              const toolResultContent = await this._executeToolCall(toolCall);
              toolResultMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                tool_name: toolCall.toolName,
                content: toolResultContent,
              });
            }

            // 3. Add tool results to history
            historyToUse.push(...toolResultMessages);

            // WORKAROUND RE-ADDED: Gemini API requires the last message to have role 'user'.
            const placeholderText = 'Okay, proceed based on the tool result.';
            historyToUse.push({ role: 'user', content: placeholderText });
            messageLogger.debug(`Added placeholder user message for Gemini API compliance.`);

            // 4. Call LLM again with updated history
            messageLogger.info(`Re-calling LLM after tool execution with updated history (${historyToUse.length} messages).`);
            accumulatedResponse = ''; // Reset for the second stream

            const secondCallOptions = { ...generationOptions };
            // delete secondCallOptions.tools; // Optionally remove tools

            messageLogger.debug(`History before second LLM call: ${JSON.stringify(historyToUse, null, 2)}`);

            let secondSystemPrompt: string | undefined = undefined;
            let secondHistory = [...historyToUse];

            if (providerSupportsSystem) {
              secondSystemPrompt = finalSystemPrompt;
              messageLogger.debug(`Passing history and system prompt for second call.`);
            } else {
              messageLogger.debug(`Prepending combined prompt for second call.`);
              const combinedPrefix = (baseSystemPromptText + formattedMemoryForPrompt + instructions).trim();
              const userMessageIndex = secondHistory.findIndex((msg) => msg.role === 'user');
              if (userMessageIndex !== -1 && combinedPrefix) {
                const userMessage = secondHistory[userMessageIndex];
                if (userMessage) {
                  const separator = '\n\n---\n\n';
                  const prefixWithSeparator = `${combinedPrefix}${separator}`;
                  if (typeof userMessage.content === 'string') {
                    userMessage.content = prefixWithSeparator + userMessage.content;
                  } else {
                    let textPart = userMessage.content.find((part) => part.type === 'text') as ChatMessageContentPartText | undefined;
                    if (textPart) {
                      textPart.text = prefixWithSeparator + textPart.text;
                    } else {
                      userMessage.content.unshift({ type: 'text', text: prefixWithSeparator.trim() });
                    }
                  }
                }
              }
              secondSystemPrompt = undefined;
            }

            const secondStream = this.llmProvider.generateStream(secondHistory, secondSystemPrompt, secondCallOptions);

            // 5. Process the second stream
            for await (const secondChunk of secondStream) {
              if (secondChunk.content) {
                accumulatedResponse += secondChunk.content;
                await responseManager.updateResponse(secondChunk.content); // No isFinal flag
              }
              if (secondChunk.toolCalls && secondChunk.toolCalls.length > 0) {
                messageLogger.warn(`Nested tool calls detected in second LLM response. Ignoring.`);
              }
              if (secondChunk.isFinal) {
                messageLogger.info(`Second LLM Stream End. Reason: ${secondChunk.finishReason}. Final length: ${accumulatedResponse.length}.`);
                // Do NOT break here, let the outer loop handle the final chunk logic
              }
            }
            finalResponseToUser = accumulatedResponse; // Update final response after second stream
          } // --- End Tool Call Handling ---

          // Do NOT break here if it was the final chunk. Let the logic after the loop run.
          // break; // REMOVED: Exit loop on final chunk
        }
      }

      messageLogger.debug(
        `[${message.id}] Full LLM Response processed (length: ${accumulatedResponse.length})`,
      );

      // --- Reasoning Logic (Check if primary response signals reasoning) ---
      if (this.reasoningManager?.isEnabled() && !toolCallsDetected) { // Don't trigger reasoning if tools were called
          const responseToCheckForReasoning = finalResponseToUser || accumulatedResponse;
          const startSignal = this.config.reasoning?.signalStart ?? '[USE_REASONING_MODEL]'; // Get configured start signal

          // Check if the response *exactly* matches the start signal (after trimming)
          if (responseToCheckForReasoning.trim() === startSignal) {
              messageLogger.debug('Reasoning triggered by exact signal match.');
              if (!this.reasoningManager.checkRateLimit(userId)) {
                  const reasoningPrompt = message.content; // Use original user message content as the prompt
                  if (!reasoningPrompt) {
                      messageLogger.warn('Reasoning triggered by exact signal, but original message content is empty. Aborting reasoning.');
                      finalResponseToUser = ''; // Fallback to empty response
                  } else {
                      messageLogger.info(`Invoking reasoning manager for user ${userId} using original message content.`);
                      this.statusManager.setTemporaryStatus('🧠 Reasoning...', 60, undefined, 'idle');
                      try { await responseManager.replaceContent('Warming the servers...'); } catch (e: any) { messageLogger.warn(`Failed to update message to 'Warming the servers...': ${e.message}`); } // Use replaceContent

                      // --- Reasoning Call (Signal-Only Case) ---
                      let accumulatedReasoningResponse = '';
                      let reasoningErrorOccurred = false;
                      let finalReason: FinishReason = 'unknown';
                      let firstChunkReceived = false;
                      let reasoningTimeoutId: NodeJS.Timeout | null = null;

                      try {
                          const reasoningStream = this.reasoningManager.generateReasoningResponse(history, reasoningPrompt, userId);
                          const iterator = reasoningStream[Symbol.asyncIterator]();
                          reasoningTimeoutId = setTimeout(async () => { if (!firstChunkReceived) { messageLogger.info(`Reasoning taking longer than 5s...`); try { await responseManager.replaceContent('🧠 Thinking deeper...'); } catch (e: any) { /* ignore */ } } }, 5000); // Use replaceContent

                          while (true) {
                              const result = await iterator.next();
                              firstChunkReceived = true;
                              if (reasoningTimeoutId) { clearTimeout(reasoningTimeoutId); reasoningTimeoutId = null; }
                              if (result.done) { messageLogger.info(`Reasoning stream iteration finished.`); break; }
                              const chunk = result.value;
                              if (chunk.content) { accumulatedReasoningResponse += chunk.content; await responseManager.updateResponse(chunk.content); }
                              if (chunk.isFinal) {
                                  finalReason = chunk.finishReason ?? 'unknown';
                                  if (finalReason === 'error') { reasoningErrorOccurred = true; messageLogger.error(`Reasoning stream error: ${chunk.content || 'Unknown'}`); accumulatedReasoningResponse = chunk.content || 'Reasoning failed.'; }
                                  else { messageLogger.info(`Reasoning stream finished: ${finalReason}`); }
                                  break;
                              }
                          }
                          if (reasoningTimeoutId) { clearTimeout(reasoningTimeoutId); reasoningTimeoutId = null; } // Final clear

                          if (!reasoningErrorOccurred && accumulatedReasoningResponse.trim()) { finalResponseToUser = accumulatedReasoningResponse.trim(); messageLogger.info(`Reasoning completed successfully.`); }
                          else if (!reasoningErrorOccurred) { messageLogger.warn(`Reasoning stream produced no content. Falling back.`); finalResponseToUser = ''; /* Fallback to empty if original was just signal */ }
                          else { finalResponseToUser = accumulatedReasoningResponse.trim(); /* Use error message */ }

                      } catch (reasoningError) {
                          messageLogger.error(`Reasoning process failed (signal-only case):`, reasoningError);
                          await responseManager.handleError(new Error('Reasoning process failed.'));
                          finalResponseToUser = ''; // Fallback to empty
                      }
                      // --- End Reasoning Call (Signal-Only Case) ---
                  }
              } else { // Rate limited
                  messageLogger.warn(`Reasoning request rate limited for user ${userId}.`);
                  finalResponseToUser = ''; // Fallback to empty if original was just signal
              }
          }
          // Check if the response *contains* the signal but isn't *only* the signal (for tagged prompts)
          // Use the manager's check which uses includes() - this is okay here as we *want* to extract
          else if (this.reasoningManager.checkResponseForSignal(responseToCheckForReasoning)) {
              messageLogger.debug('Reasoning signal detected within response. Attempting to extract prompt between tags.');
              if (!this.reasoningManager.checkRateLimit(userId)) {
                  const reasoningPrompt = this.reasoningManager.getReasoningSignal(responseToCheckForReasoning); // Extract content between tags

                  if (reasoningPrompt !== null) {
                      messageLogger.info(`Invoking reasoning manager for user ${userId} using extracted prompt.`);
                      this.statusManager.setTemporaryStatus('🧠 Reasoning...', 60, undefined, 'idle');
                      try { await responseManager.replaceContent('Warming the servers...'); } catch (e: any) { messageLogger.warn(`Failed to update message to 'Warming the servers...': ${e.message}`); } // Use replaceContent

                      // --- Reasoning Call (Tagged Prompt Case) ---
                      let accumulatedReasoningResponse = '';
                      let reasoningErrorOccurred = false;
                      let finalReason: FinishReason = 'unknown';
                      let firstChunkReceived = false;
                      let reasoningTimeoutId: NodeJS.Timeout | null = null;

                      try {
                          const reasoningStream = this.reasoningManager.generateReasoningResponse(history, reasoningPrompt, userId);
                          const iterator = reasoningStream[Symbol.asyncIterator]();
                          reasoningTimeoutId = setTimeout(async () => { if (!firstChunkReceived) { messageLogger.info(`Reasoning taking longer than 5s...`); try { await responseManager.replaceContent('🧠 Thinking deeper...'); } catch (e: any) { /* ignore */ } } }, 5000); // Use replaceContent

                          while (true) {
                              const result = await iterator.next();
                              firstChunkReceived = true;
                              if (reasoningTimeoutId) { clearTimeout(reasoningTimeoutId); reasoningTimeoutId = null; }
                              if (result.done) { messageLogger.info(`Reasoning stream iteration finished.`); break; }
                              const chunk = result.value;
                              if (chunk.content) { accumulatedReasoningResponse += chunk.content; await responseManager.updateResponse(chunk.content); }
                              if (chunk.isFinal) {
                                  finalReason = chunk.finishReason ?? 'unknown';
                                  if (finalReason === 'error') { reasoningErrorOccurred = true; messageLogger.error(`Reasoning stream error: ${chunk.content || 'Unknown'}`); accumulatedReasoningResponse = chunk.content || 'Reasoning failed.'; }
                                  else { messageLogger.info(`Reasoning stream finished: ${finalReason}`); }
                                  break;
                              }
                          }
                          if (reasoningTimeoutId) { clearTimeout(reasoningTimeoutId); reasoningTimeoutId = null; } // Final clear

                          if (!reasoningErrorOccurred && accumulatedReasoningResponse.trim()) { finalResponseToUser = accumulatedReasoningResponse.trim(); messageLogger.info(`Reasoning completed successfully.`); }
                          else if (!reasoningErrorOccurred) { messageLogger.warn(`Reasoning stream produced no content. Falling back.`); const endSignal = this.config.reasoning?.signalEnd ?? '[/USE_REASONING_MODEL]'; const stripRegex = new RegExp(`${startSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${endSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'); finalResponseToUser = responseToCheckForReasoning.replace(stripRegex, '').trim(); }
                          else { finalResponseToUser = accumulatedReasoningResponse.trim(); /* Use error message */ }

                      } catch (reasoningError) {
                          messageLogger.error(`Reasoning process failed (tagged prompt case):`, reasoningError);
                          await responseManager.handleError(new Error('Reasoning process failed.'));
                          // Fallback: Remove only the start tag
                          finalResponseToUser = responseToCheckForReasoning.replace(startSignal, '').trim();
                      }
                      // --- End Reasoning Call (Tagged Prompt Case) ---

                  } else { // Extraction failed
                      messageLogger.warn('Reasoning signal detected but content extraction failed. Removing tag and proceeding.');
                      finalResponseToUser = responseToCheckForReasoning.replace(startSignal, '').trim();
                  }
              } else { // Rate limited
                  messageLogger.warn(`Reasoning request rate limited for user ${userId}.`);
                  // Fallback: Remove only the start tag
                  finalResponseToUser = responseToCheckForReasoning.replace(startSignal, '').trim();
              }
          } // End of checks for reasoning signal
      } // End of reasoning enabled check
      // Clear reasoning temporary status regardless of outcome
      this.statusManager.clearTemporaryStatus();
      // --- End Reasoning Logic ---

      // --- Process Memory Tags *after* all streams and reasoning ---
      // Use the potentially updated finalResponseToUser from reasoning
      const finalResponseText = finalResponseToUser || accumulatedResponse; // Use reasoning result if available
      messageLogger.debug( 'Text before processing memory suggestions',{ responseText: finalResponseText },);
      this._processMemorySuggestions(
        userId,
        finalResponseText, // Process tags on the final text
        message.id,
      );
      // Note: Tags are processed for storage but NOT stripped from the already sent response here.

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
                messageLogger.info(
                  `Invoking reasoning manager for user ${userId}...`,
                );
                // Pass original history and userId
                // Set temporary status before starting reasoning
                this.statusManager.setTemporaryStatus(
                  '🧠 Reasoning...',
                  60, // Set a reasonable duration, clearTemporaryStatus will handle early completion
                  undefined, // Default type
                  'idle',
                );

                // Edit placeholder using ResponseManager (send an update)
                // Note: ResponseManager handles the message object internally
                try {
                    await responseManager.updateResponse('🧠 Reasoning...'); // Send intermediate update
                } catch (editError: any) { // Added : any type
                    messageLogger.warn(`Failed to update message to 'Reasoning...': ${editError.message}`);
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
                let reasoningTimeoutId: NodeJS.Timeout | null = null;

                // Start a 5-second timer to update status if no chunk received
                reasoningTimeoutId = setTimeout(async () => {
                    if (!firstChunkReceived) {
                        messageLogger.info(`Reasoning taking longer than 5s, updating status...`);
                        try {
                            await responseManager.updateResponse('🧠 Thinking deeper...');
                        } catch (editError: any) { // Added : any type
                            messageLogger.warn(`Failed to edit message to 'Thinking deeper...': ${editError.message}`);
                        }
                    }
                }, 5000);


                // Process the stream using a while loop
                while (true) {
                    const result = await iterator.next();
                    firstChunkReceived = true; // Mark as received once iterator.next() resolves
                    // Clear timeout as soon as the first chunk arrives
                    if (reasoningTimeoutId) {
                        clearTimeout(reasoningTimeoutId);
                        reasoningTimeoutId = null;
                    }

                    if (result.done) {
                        messageLogger.info(`Reasoning stream iteration finished.`);
                        break; // Exit the while loop
                    }

                    const chunk = result.value;
                    messageLogger.debug(`Received reasoning chunk. Content length: ${chunk.content?.length ?? 0}, isFinal: ${chunk.isFinal}`);

                    if (chunk.content) {
                        accumulatedReasoningResponse += chunk.content;
                        // Update using ResponseManager (it handles throttling internally)
                        await responseManager.updateResponse(chunk.content);
                    }

                    if (chunk.isFinal) {
                        // Clear timeout just in case it was still pending
                        if (reasoningTimeoutId) {
                            clearTimeout(reasoningTimeoutId);
                            reasoningTimeoutId = null;
                        }
                        finalReason = chunk.finishReason ?? 'unknown';
                        if (finalReason === 'error') {
                            reasoningErrorOccurred = true;
                            messageLogger.error(`Reasoning stream finished with error: ${chunk.content || 'Unknown error'}`);
                            accumulatedReasoningResponse = chunk.content || 'Reasoning failed.';
                        } else {
                             messageLogger.info(`Reasoning stream finished with reason: ${finalReason}`);
                        }
                        break; // Exit the while loop
                    }
                }
                // Ensure timeout is cleared if loop exits unexpectedly
                if (reasoningTimeoutId) {
                    clearTimeout(reasoningTimeoutId);
                    reasoningTimeoutId = null;
                }

                // Update final response based on accumulated stream content
                if (!reasoningErrorOccurred && accumulatedReasoningResponse.trim()) {
                     finalResponseToUser = accumulatedReasoningResponse.trim();
                     messageLogger.info(`Reasoning completed successfully.`);
                } else if (!reasoningErrorOccurred) {
                     // Stream finished without error but no content was generated
                     messageLogger.warn(`Reasoning stream finished successfully but produced no content. Falling back.`);
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
                messageLogger.error(
                  `Error during reasoning process:`,
                  reasoningError,
                );
                // Let ResponseManager handle displaying an error if possible
                await responseManager.handleError(new Error('Reasoning process failed.')); // Use handleError
                // Fallback: Remove only the start tag from the original response on error
                const startSignal = this.config.reasoning?.signalStart ?? '[REASONING_REQUEST]';
                finalResponseToUser = finalResponseToUser.replace(startSignal, '').trim();
              }
            } else {
               // --- NEW LOGIC for when ONLY START tag is found ---
               messageLogger.info(
                   `Reasoning start tag detected without end tag. Extracting fallback signal.`,
               );
               const startSignal = this.config.reasoning?.signalStart ?? '[REASONING_REQUEST]';
               // Use accumulatedResponse here to ensure we check the raw response before memory tags were stripped
               const startIndex = accumulatedResponse.indexOf(startSignal);

               if (startIndex !== -1) {
                   // Use accumulatedResponse here to extract from the raw response
                   const fallbackSignal = accumulatedResponse.substring(startIndex + startSignal.length).trim();

                   // Proceed with reasoning even if fallbackSignal is empty, as per instructions.
                   // An empty fallbackSignal means the primary model responded *only* with the start tag.
                   messageLogger.debug(`Using fallback signal (may be empty): '${fallbackSignal.substring(0, 50)}...'`);
                   try {
                       // Edit placeholder using ResponseManager
                       try {
                           await responseManager.updateResponse('🧠 Reasoning (fallback)...');
                       } catch (editError: any) { // Added : any type
                           messageLogger.warn(`Failed to update message to 'Reasoning (fallback)...': ${editError.message}`);
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
                       let fallbackTimeoutId: NodeJS.Timeout | null = null;
                       let fallbackFirstChunkReceived = false;

                       fallbackTimeoutId = setTimeout(async () => {
                           if (!fallbackFirstChunkReceived) {
                               messageLogger.info(`Fallback reasoning taking longer than 5s, updating status...`);
                               try {
                                   await responseManager.updateResponse('🤔 Thinking deeper...');
                               } catch (editError: any) { // Added : any type
                                   messageLogger.warn(`Failed to edit message to 'Thinking deeper...': ${editError.message}`);
                               }
                           }
                       }, 5000);

                       for await (const chunk of reasoningStream) {
                           fallbackFirstChunkReceived = true;
                           if (fallbackTimeoutId) {
                               clearTimeout(fallbackTimeoutId);
                               fallbackTimeoutId = null;
                           }
                           messageLogger.debug(`Received fallback reasoning chunk. Content length: ${chunk.content?.length ?? 0}, isFinal: ${chunk.isFinal}`);
                           if (chunk.content) {
                               accumulatedReasoningResponse += chunk.content;
                               // Update using ResponseManager
                               await responseManager.updateResponse(chunk.content);

                           }
                           // TODO: Handle chunk.toolCalls if needed
                           if (chunk.isFinal) {
                               finalReason = chunk.finishReason ?? 'unknown';
                               if (fallbackTimeoutId) { // Clear timeout on final chunk too
                                   clearTimeout(fallbackTimeoutId);
                                   fallbackTimeoutId = null;
                               }
                               if (finalReason === 'error') {
                                   reasoningErrorOccurred = true;
                                   messageLogger.error(`Fallback reasoning stream finished with error: ${chunk.content || 'Unknown error'}`);
                                   accumulatedReasoningResponse = chunk.content || 'Fallback reasoning failed.';
                               } else {
                                   messageLogger.info(`Fallback reasoning stream finished with reason: ${finalReason}`);
                               }
                               break; // Exit loop on final chunk
                           }
                       }

                       // Update final response based on accumulated stream content
                       if (!reasoningErrorOccurred && accumulatedReasoningResponse.trim()) {
                            finalResponseToUser = accumulatedReasoningResponse.trim();
                            messageLogger.info(`Fallback reasoning completed successfully.`);
                       } else if (!reasoningErrorOccurred) {
                            // Stream finished without error but no content was generated
                            messageLogger.warn(`Fallback reasoning stream finished successfully but produced no content. Removing tag.`);
                            // Fallback: Remove only the start tag from the original response
                            finalResponseToUser = accumulatedResponse.replace(startSignal, '').trim(); // Use accumulatedResponse (original)
                       } else {
                            // Error occurred during stream, use the error message from the chunk
                            finalResponseToUser = accumulatedReasoningResponse.trim();
                       }

                   } catch (reasoningError) {
                       messageLogger.error(
                           `Error initiating fallback reasoning process:`, // Updated log message
                           reasoningError,
                       );
                       // Let ResponseManager handle displaying an error if possible
                       await responseManager.handleError(new Error('Fallback reasoning process failed.')); // Use handleError
                       // Removed erroneous ); from failed diff apply
                       // Fallback: Remove only the start tag from the original response
                       finalResponseToUser = accumulatedResponse.replace(startSignal, '').trim();
                   }
                   // Removed the 'else' block that previously handled empty fallbackSignal incorrectly.
               } else {
                   // Should not happen if signalDetected is true, but handle defensively
                   messageLogger.error(`Signal detected but start index not found. This shouldn't happen. Removing tag.`);
                   // Fallback: Remove the start tag just in case
                    finalResponseToUser = finalResponseToUser.replace(startSignal, '').trim();
               }
            }
          } else {
            messageLogger.warn(
              `Reasoning request rate limited for user ${userId}.`,
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
      // Removed unused finalContentWithWarnings variable declaration

      // --- Finalize Response ---
      await responseManager.finalize(); // Call finalize *after* all processing

      // Log warnings after finalization
      if (userWarnings.length > 0) {
          const warningsString = userWarnings.map(w => w.message).join(', ');
      messageLogger.debug('Calling responseManager.finalize()');
          messageLogger.warn(`Processing finished with warnings: ${warningsString}`);
      }
      messageLogger.debug('Finished responseManager.finalize()');

      messageLogger.info(`Message processing complete.`);
      // Removed unused finalContentWithWarnings variable declaration and ensure no lingering updateResponse calls
    } catch (error: any) {
      // Keep the : any type from the actual file content
      messageLogger.error(
        `Error processing message with LLM:`,
        error,
      ); // Keep the exact error message
      try {
        // Attempt to send an error message back to the user via ResponseManager
        await responseManager.handleError(new Error('Sorry, I encountered an error while processing your request.')); // Use handleError
      } catch (replyError) {
        messageLogger.error(
          `Failed to send error reply via ResponseManager:`,
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
