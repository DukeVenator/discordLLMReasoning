/**
 * @fileoverview Defines the TypeScript interfaces for the bot's configuration structure (`config.yaml`).
 */
/**
 * Defines the structure for the application's configuration.
 */
export interface Config {
  discord: {
    token: string;
    clientId: string;
    /** Optional: For deploying commands to a specific guild instantly (testing). */
    guildId?: string; // Optional: For guild-specific command deployment
    intents?: number[]; // Specify necessary intents
    /** Specify necessary Discord gateway partials (e.g., 'CHANNEL' for DMs). */
    partials?: string[]; // Specify necessary partials
    presence?: {
      status: 'online' | 'idle' | 'dnd' | 'invisible';
      activity?: {
        name: string;
        type: 'Playing' | 'Streaming' | 'Listening' | 'Watching' | 'Competing';
        /** Required if type is 'Streaming'. */
        url?: string; // Required if type is 'Streaming'
      };
    };
    /** Interval in milliseconds to update streaming responses. Defaults to 1500. */
    streamingUpdateIntervalMs?: number;
    /** Use plain text messages instead of embeds for responses. Defaults to false. */
    usePlainResponses?: boolean;
    /** List of custom statuses for the bot to cycle through. */
    statuses?: string[];
    /** Interval in seconds for updating the bot's status. Defaults to 300. */
    statusUpdateIntervalSeconds?: number;
    /** Allow the bot to be used in Direct Messages. Defaults to true. */
    allowDms?: boolean; // Moved inside discord
  };
  llm: {
    /** The default LLM provider to use if not specified elsewhere. Allows custom string values. */
    defaultProvider: 'openai' | 'gemini' | 'ollama' | string; // Allow custom providers
    // Provider-specific configurations
    openai?: {
      apiKey: string;
      defaultModel?: string;
      /** Optional: For OpenAI-compatible API proxies or alternative endpoints. */
      baseURL?: string; // For proxies or alternative endpoints
      /** Optional: Generation temperature (e.g., 0.7). Overrides defaultTemperature. */
      temperature?: number;
      /** Optional: Maximum tokens for the generated response. Overrides defaultMaxTokens. */
      maxOutputTokens?: number;
      /** Optional: Provider-specific parameters to pass directly to the API. */
      extraParams?: Record<string, unknown>;
    };
    gemini?: {
      apiKey: string;
      defaultModel?: string;
      /** Optional: Generation temperature (e.g., 0.7). Overrides defaultTemperature. */
      temperature?: number;
      /** Optional: Maximum tokens for the generated response. Overrides defaultMaxTokens. */
      maxOutputTokens?: number;
      /** Optional: Provider-specific parameters to pass directly to the API. */
      extraParams?: Record<string, unknown>;
    };
    ollama?: {
      baseURL: string; // e.g., http://localhost:11434
      defaultModel?: string;
      /** Ollama `keep_alive` parameter (e.g., '5m', -1). Controls how long models stay loaded. */
      keepAlive?: string | number; // ollama keep_alive parameter
      /** Optional: Generation temperature (e.g., 0.7). Overrides defaultTemperature. */
      temperature?: number;
      /** Optional: Maximum tokens for the generated response. Overrides defaultMaxTokens. */
      maxOutputTokens?: number;
      /** Optional: Provider-specific parameters to pass directly to the API. */
      extraParams?: Record<string, unknown>;
      /** Optional: Explicitly declare if the selected Ollama model supports vision. Defaults based on provider logic if unset. */
      supportsVision?: boolean;
    };
    // Common LLM settings
    /** Default timeout for LLM API requests in milliseconds. */
    requestTimeoutMs?: number;
    /** Default maximum tokens to generate in LLM responses. */
    defaultMaxTokens?: number;
    /** Default temperature for LLM generation (controls randomness). */
    defaultTemperature?: number;
    /** Default system prompt to send to the LLM. */
    defaultSystemPrompt?: string;
    /** Maximum size in bytes for a single attachment to be processed (e.g., for base64 encoding). Defaults to 10MB. */
    maxAttachmentSizeBytes?: number;
  };
  memory: {
    enabled: boolean; // Add top-level enabled flag for the memory feature
    /** Type of storage for memory (currently only 'sqlite'). */
    storageType: 'sqlite'; // Expandable later if needed
    sqlite: {
      path: string; // Path to the SQLite database file
    };
    /** Optional prefix added to the injected memory content. Defaults to "[User Memory/Notes]:\n". */
    memoryPrefix?: string;

    /** Max number of user/assistant message pairs to keep in short-term history (for context). */
    maxHistoryLength?: number; // Max messages to keep in short-term memory
    /** Approximate character length limit for the total stored memory before condensation is triggered. */
    maxMemoryLength?: number; // Max total memory length (chars)
    /** Approximate token limit per message stored in history (for truncation). */
    maxTokensPerMessage?: number; // Limit message length stored
    /** Maximum number of images to include in the history sent to the LLM. */
    maxImages?: number;
    /** Whether to publish memory changes as a separate message. Defaults to false. */
    publishMemory?: boolean;

    /** Configuration for LLM-suggested memory updates. */
    suggestions?: {
      /** The opening tag for memory append suggestions. Defaults to '[MEM_APPEND]'. */
      appendMarkerStart?: string;
      /** The closing tag for memory append suggestions. Defaults to '[/MEM_APPEND]'. */
      appendMarkerEnd?: string;
      /** The opening tag for memory replace suggestions. Defaults to '[MEM_REPLACE]'. */
      replaceMarkerStart?: string;
      /** The closing tag for memory replace suggestions. Defaults to '[/MEM_REPLACE]'. */
      replaceMarkerEnd?: string;
      /** Whether to remove the suggestion tags from the final response sent to the user. Defaults to true. */
      stripFromResponse?: boolean;
    };


    condensation?: {
      enabled: boolean;
      /** Percentage of `maxMemoryLength` at which condensation should trigger. Defaults to 80. */
      condensationThresholdPercent?: number;
      /** Target percentage of `maxMemoryLength` to aim for after condensation. Defaults to 50. */
      targetLengthPercent?: number;
      /** How often (in minutes) to attempt memory condensation. */
      intervalMinutes?: number; // How often to condense
      /** Custom prompt template used when asking the LLM to summarize memory. Use {current_memory} and {target_length}. */
      condensationPrompt?: string; // Prompt template for condensation
      /** Optional system prompt to guide the condensation LLM. */
      condensationSystemPrompt?: string; // System prompt for condensation LLM
      /** Specific LLM provider to use for condensation (defaults to main provider). */
      provider?: string; // Specific provider for condensation
      /** Specific LLM model to use for condensation. */
      model?: string; // Specific model for condensation
      /** Max tokens for the generated condensation summary. */
      maxTokens?: number; // Max tokens for condensation summary
      /** Optional: Target token count for fallback truncation if condensation fails. Defaults to 75% of maxTokens. */
      fallbackTruncateTokens?: number;
      /** Optional: Generation temperature for condensation LLM. Overrides defaultTemperature. */
      temperature?: number;
      /** Optional: Custom prompt for condensation LLM. */
      prompt?: string; // Renamed from condensationPrompt for consistency
    };
  };
  reasoning?: {
    enabled: boolean;
    /** Specific LLM provider to use for reasoning calls (defaults to main provider). */
    provider?: string; // Specific provider for reasoning
    /** Specific LLM model to use for reasoning calls. */
    reasoningModel?: string; // Specific model for reasoning (renamed from 'model')
    /** Custom system prompt to use for reasoning LLM calls. */
    systemPrompt?: string; // Custom system prompt for reasoning LLM call (renamed from 'prompt')
    /** Whether to include the main default system prompt in the reasoning call. Defaults to true. */
    includeDefaultPrompt?: boolean;
    /** Extra instructions to append to the system prompt for reasoning calls. */
    extraInstructions?: string;
    /** The string that signals the start of a reasoning request block. Defaults to '[REASONING_REQUEST]'. */
    signalStart?: string;
    /** The string that signals the end of a reasoning request block. Defaults to '[/REASONING_REQUEST]'. */
    signalEnd?: string;
    /** Strategy for modifying history before sending to reasoning LLM ('keep_all', 'truncate'). Defaults to 'keep_all'. */
    historyModificationStrategy?: 'keep_all' | 'truncate'; // Add other strategies later if needed
    /** Max number of user/assistant message pairs if historyModificationStrategy is 'truncate'. */
    maxHistoryLength?: number;
    /** Optional LLM generation parameters specific to reasoning calls. */
    generationParams?: {
      temperature?: number;
      maxOutputTokens?: number;
      // Add other common or provider-specific params as needed
      [key: string]: any; // Allow arbitrary extra parameters
    };
    rateLimit?: {
      // Optional rate limiting for reasoning calls
      /** Time window in seconds for reasoning rate limit. */
      intervalSeconds: number;
      /** Max reasoning calls allowed within the interval. */
      maxCalls: number;
    };
  };
  search?: { // Optional search configuration
    provider: 'brave' | 'none'; // Currently supported: brave or none
    brave?: {
      apiKey: string; // Required if provider is 'brave'
    };
    /** Number of search results to return. Defaults to 3. */
    maxResults?: number;
  };

  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    /** Optional path for logging output to a file. */
    filePath?: string; // Optional file logging
  };
  // allowDms?: boolean; // Moved inside discord interface

  permissions: {
    /** List of Discord Role IDs allowed to use the bot. */
    allowedRoles?: string[]; // Role IDs or names
    /** List of Discord User IDs allowed to use the bot. */
    allowedUsers?: string[]; // User IDs
    /** List of Discord User IDs with admin privileges (bypass other checks). */
    adminUsers?: string[]; // Users with elevated privileges
    /** List of Discord User IDs explicitly blocked from using the bot. */
    blockUsers?: string[];
    /** List of Discord Role IDs explicitly blocked from using the bot. */
    blockRoles?: string[];
    /** List of Discord Channel IDs where the bot is allowed. If empty or undefined, allowed everywhere not blocked. */
    allowedChannels?: string[];
    /** List of Discord Channel IDs where the bot is explicitly blocked. */
    blockedChannels?: string[];
    /** List of Discord Category IDs where the bot is allowed. If empty or undefined, allowed everywhere not blocked. */
    allowedCategories?: string[];
    /** List of Discord Category IDs where the bot is explicitly blocked. */
    blockedCategories?: string[];
  };
  rateLimit: {
    user: {
      /** Time window in seconds for the user-specific command rate limit. */
      intervalSeconds: number;
      /** Max commands allowed within the interval per user. */
      maxCalls: number;
    };
    global?: { // Optional global rate limiting
      /** Time window in seconds for the global command rate limit. */
      intervalSeconds: number;
      /** Max total commands allowed across all users within the interval. */
      maxCalls: number;
    };
  };
  /** The selected model identifier (e.g., 'provider_name/model_name'). */
  model: string;
  /** Configuration for different LLM providers. */
  providers?: {
    [providerName: string]: {
      apiKey?: string;
      baseURL?: string;
      // Add other provider-specific options here if needed
    };
  };
  // Add other configuration sections as needed
}

/**
 * Defines the structure for default configuration values.
 * This allows for partial user configurations to be merged safely.
 */
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export type DefaultConfig = DeepPartial<Config>;