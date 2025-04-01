/**
 * @fileoverview Handles loading, merging, validation, and access of the bot's configuration.
 * Reads configuration from a YAML file, merges it with default values, performs essential validation,
 * and provides utility functions to access configuration values.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import merge from 'lodash.merge';
import _ from 'lodash'; // Import lodash
import { Config, DefaultConfig } from '@/types/config'; // Using path alias defined in tsconfig
export type { Config } from '@/types/config'; // Re-export the Config type
// import { logger } from '../utils/logger'; // Logger is injected or handled differently now

// --- Default Configuration ---
/**
 * Default configuration values for the bot.
 * These are used when a corresponding value is not provided in the user's config file.
 * Uses camelCase internally, matching the Config type definition.
 */
const defaultConfig: DefaultConfig = {
  discord: {
    // token and clientId MUST be provided by the user
    intents: [
      1, // GUILDS
      1 << 9, // GUILD_MESSAGES
      1 << 15, // MESSAGE_CONTENT (Requires Privileged Intent)
      1 << 12, // DIRECT_MESSAGES - Added for DM functionality
    ],
    partials: ['MESSAGE', 'CHANNEL', 'REACTION', 'USER'], // Added USER partial for DMs
    presence: {
      status: 'online',
      activity: {
        name: 'with LLMs',
        type: 'Playing',
      },
    },
    statusUpdateIntervalSeconds: 300, // Default 5 minutes
    statuses: ['Serving LLMs', 'Thinking...', '/help for commands'],
    streamingUpdateIntervalMs: 1500, // Default 1.5 seconds
    usePlainResponses: false,
  },
  llm: {
    defaultProvider: 'openai', // Default to OpenAI
    requestTimeoutMs: 60000, // 60 seconds
    defaultMaxTokens: 1024,
    defaultTemperature: 0.7,
    defaultSystemPrompt: "You are LLMCord, a helpful Discord bot.",
    maxAttachmentSizeBytes: 10 * 1024 * 1024, // 10MB default
    openai: { // Default OpenAI settings if user enables it
        // apiKey: 'YOUR_OPENAI_API_KEY', // Must be provided by user
        // baseURL: 'https://api.openai.com/v1', // Default handled by library
        // defaultModel: 'gpt-4o', // Example
    },
    gemini: {
        // apiKey: 'YOUR_GOOGLE_API_KEY', // Must be provided by user
        // defaultModel: 'gemini-1.5-pro-latest', // Example
    },
    ollama: {
      // Default Ollama settings if user enables it
      baseURL: 'http://localhost:11434',
      defaultModel: 'llama3',
      keepAlive: '5m',
      supportsVision: false, // Default vision support to false
    },
    // Add other provider defaults as needed
  },
  memory: {
    enabled: false, // Memory disabled by default
    storageType: 'sqlite',
    sqlite: {
      path: './llmcord_memory.sqlite', // Default path relative to project root
    },
    maxHistoryLength: 20,
    maxTokensPerMessage: 500,
    maxImages: 2, // Default max images per message in history
    // promptInjectionMethod: 'system_prompt_prefix', // Removed - Not in type definition
    // memoryPrefix: '[User Memory/Notes]:\n', // Removed - Not in type definition
    // notifyOnUpdate: true, // Removed - Not in type definition
    // notifyAsReply: false, // Removed - Not in type definition
    // notifyDeleteAfter: 0, // Removed - Not in type definition
    condensation: {
      enabled: false, // Disabled by default
      intervalMinutes: 60,
      condensationThresholdPercent: 80,
      // condensationTargetBuffer: 100, // Removed - Use targetLengthPercent in types/config.ts
      condensationPrompt: "Please summarize and condense the following notes, removing redundancy and keeping the most important points. Aim for a maximum length of around {target_len} characters, but do not exceed {max_len} characters.\n\nNOTES:\n```\n{current_memory}\n```\n\nCONDENSED NOTES:",
      // condensationModel: undefined, // Use default model if not specified
      // condensationSystemPrompt: undefined, // Default handled internally if needed
    },
    suggestions: { // Default settings for memory suggestions
        appendMarkerStart: '[MEM_APPEND]',
        appendMarkerEnd: '[/MEM_APPEND]',
        replaceMarkerStart: '[MEM_REPLACE]',
        replaceMarkerEnd: '[/MEM_REPLACE]',
        stripFromResponse: true,
    },
  },
  reasoning: {
    enabled: false, // Disabled by default
    includeDefaultPrompt: true, // Default to including the main prompt
    // reasoningModel: undefined, // Must be provided by user if enabled
    signalStart: '[USE_REASONING_MODEL]',
    signalEnd: '[/USE_REASONING_MODEL]',
    // notifyUser: true, // Removed - Not in type definition
    historyModificationStrategy: 'keep_all',
    // reasoningExtraApiParameters: undefined,
    rateLimit: { // Optional reasoning-specific rate limits
        // userLimit: 2,
        // userPeriod: 300,
        // globalLimit: 10,
        // globalPeriod: 60,
    }
  },
  logging: {
    level: 'info',
  },
  permissions: {
    // Empty by default - restrict access if needed
    allowedRoles: [],
    allowedUsers: [],
    adminUsers: [],
    blockUsers: [],
    blockRoles: [],
    allowedChannels: [],
    blockedChannels: [],
    allowedCategories: [],
    blockedCategories: [],
  },
  rateLimit: {
    // enabled: true, // Removed - Not in type definition; configure via user/global sections
    user: { // User-specific limits are required
      intervalSeconds: 5,
      maxCalls: 3,
    },
    // global is optional, so no default needed here unless explicitly desired
    // global: {
    //     intervalSeconds: 60,
    //     maxCalls: 30,
    // }
    // adminBypass: true, // Optional
  },
  search: { // Default search config
    provider: 'none',
    brave: {
        apiKey: 'YOUR_BRAVE_API_KEY_HERE', // Placeholder
    },
    // Add other search provider defaults here if needed
  },
  // model: undefined, // Must be provided by user
  // providers: undefined, // Must be provided by user
  // extraApiParameters: undefined, // Optional
};

// --- Helper Function for Key Normalization ---

/**
 * Recursively converts object keys to camelCase.
 * Handles nested objects and arrays of objects.
 * @param obj - The object or array to process.
 * @returns A new object/array with camelCased keys.
 */
function normalizeObjectKeysToCamelCase(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(v => normalizeObjectKeysToCamelCase(v));
    } else if (obj !== null && typeof obj === 'object' && obj.constructor === Object) { // Ensure it's a plain object
        return Object.keys(obj).reduce((result, key) => {
            result[_.camelCase(key)] = normalizeObjectKeysToCamelCase(obj[key]);
            return result;
        }, {} as Record<string, any>);
    }
    return obj;
}


// --- Configuration Loading Logic ---

/** Stores the loaded and merged configuration object (singleton pattern). */
let loadedConfig: Config | null = null;

/**
 * Loads configuration from a YAML file, merges with defaults, normalizes keys, applies env vars, and validates.
 * @param configPath - Path to the configuration file (e.g., config.yaml). Defaults to project root.
 * @returns The loaded and merged configuration object.
 * @throws Error if required configuration (like Discord token) is missing or invalid.
 */
export function loadConfig(configPath?: string): Config {
  const resolvedConfigPath =
    configPath || path.resolve(process.cwd(), 'config.yaml'); // Resolve from current working directory

  let userConfigRaw: Record<string, any> = {};

  console.log(`[ConfigLoad] Attempting to load config from: ${resolvedConfigPath}`);

  if (fs.existsSync(resolvedConfigPath)) {
    try {
      console.log(`[ConfigLoad] File found. Reading and parsing...`);
      const fileContents = fs.readFileSync(resolvedConfigPath, 'utf8');
      userConfigRaw = (yaml.load(fileContents) as Record<string, any>) || {};
      console.log(`[ConfigLoad] Successfully loaded and parsed YAML from ${resolvedConfigPath}`);
    } catch (error: any) {
      console.error(`[ConfigLoad] Error loading or parsing configuration file at ${resolvedConfigPath}:`, error);
      throw new Error(`Failed to load or parse config file: ${error.message}`);
    }
  } else {
    console.warn(
      `[ConfigLoad] Configuration file not found at ${resolvedConfigPath}. Using defaults and environment variables only.`
    );
  }

  // --- Normalize User Config Keys to camelCase FIRST ---
  const userConfigNormalized = normalizeObjectKeysToCamelCase(userConfigRaw);
  console.log('[ConfigLoad] Normalized user configuration keys to camelCase.');

  // --- Merge Normalized User Config with Defaults ---
  // Defaults are already camelCase. Merging normalized user config ensures correct overrides.
  const mergedConfig = merge({}, defaultConfig, userConfigNormalized) as Config;
  console.log('[ConfigLoad] Merged normalized user config with defaults.');




  // --- Environment Variable Overrides ---
  // Apply overrides *after* merging
  applyEnvironmentVariableOverrides(mergedConfig);


  // --- Validation ---
  console.log('[ConfigValidate] Checking Discord token...');
  if (!mergedConfig.discord?.token) {
    throw new Error(
      'Discord token is missing. Please provide `discord.token` (or `discord.token`/`bot_token` in YAML) or LLMCORD_discord__token env var.'
    );
  }

  console.log('[ConfigValidate] Checking Discord client ID...');
  if (!mergedConfig.discord?.clientId) {
    throw new Error(
      'Discord client ID is missing. Please provide `discord.clientId` (or `discord.client_id`/`client_id` in YAML) or LLMCORD_discord__clientId env var.'
    );
  }

  console.log('[ConfigValidate] Checking model setting and provider API key...');
  // Validate API key for the *selected* provider based on the 'model' setting
  console.log(`[ConfigValidate] mergedConfig.model: ${mergedConfig.model}`);
  if (mergedConfig.model && typeof mergedConfig.model === 'string') {
    const modelParts = mergedConfig.model.split('/');
    if (modelParts.length === 2) {
      const providerName = modelParts[0];
      console.log(`[ConfigValidate] Parsed providerName: ${providerName}`);
      // Access provider config using camelCase key now
      const camelCaseProviderName = _.camelCase(providerName); // Convert extracted name to camelCase
      console.log(`[ConfigValidate] Accessing provider config at mergedConfig.providers?.['${camelCaseProviderName}']`); // Use camelCase name for lookup
      const providerConfig = mergedConfig.providers?.[camelCaseProviderName as keyof typeof mergedConfig.providers];
      // Duplicate declaration removed
      console.log(`[ConfigValidate] Retrieved providerConfig: ${JSON.stringify(providerConfig)}`);

      if (providerName) { // Keep original providerName for checks like needsApiKey
          const needsApiKey = !['ollama', 'lmstudio', 'vllm', 'oobabooga', 'jan'].includes(providerName);

          if (needsApiKey) {
            // Check camelCased key
            console.log(`[ConfigValidate] Checking API key for provider '${providerName}'...`);
            // Check camelCased key & ensure providerConfig exists first
            if (!providerConfig || !providerConfig.apiKey || (typeof providerConfig.apiKey === 'string' && providerConfig.apiKey.startsWith('YOUR_'))) {
               throw new Error(
                 `API key for the selected provider '${providerName}' is missing or is a placeholder in config.yaml (providers.${providerName}.apiKey) or corresponding env var. Please provide a valid key.`
               );
            }
          }
      }
    } else {
       throw new Error(
         `Invalid format for 'model' setting: '${mergedConfig.model}'. Expected 'provider_name/model_name'.`
       );
    }
  } else {
     throw new Error(
       `The 'model' setting is missing or not a string in config.yaml or corresponding env var. Please specify the model to use (e.g., 'openai/gpt-4o').`
     );
  }

  // Validate Brave Search API Key if selected
  console.log('[ConfigValidate] Checking search provider settings...');
  if (mergedConfig.search?.provider === 'brave') {
    console.log(`[ConfigValidate] Search provider: ${mergedConfig.search?.provider}`);
    if (!mergedConfig.search.brave?.apiKey || mergedConfig.search.brave.apiKey.startsWith('YOUR_')) {
      console.log(`[ConfigValidate] Checking Brave API key...`);
      throw new Error(
        "Search provider is set to 'brave', but a valid API key is missing or is a placeholder in config.yaml (search.brave.apiKey) or LLMCORD_search__brave__apiKey env var. Please provide a valid key."
      );
    }
  }

  // Add more validation as needed

  console.log('[ConfigValidate] All checks passed.');
  return mergedConfig;
}

/**
 * Gets the loaded configuration object. Loads it if it hasn't been loaded yet.
 * Ensures singleton pattern for configuration.
 * @param forceReload - If true, forces reloading the configuration from the file.
 * @param configPath - Optional path to the config file for initial load or reload.
 * @returns The configuration object.
 */
export function getConfig(forceReload = false, configPath?: string): Config {
  if (loadedConfig === null || forceReload) {
    try {
      loadedConfig = loadConfig(configPath);
    } catch (error) {
      console.error('CRITICAL: Failed to initialize configuration:', error);
      if (process.env['NODE_ENV'] !== 'test') {
        process.exit(1);
      } else {
        throw error;
      }
    }
  }
  return loadedConfig;
}

/**
 * Utility function to get a specific configuration value using camelCase dot notation.
 * Example: getConfigValue('discord.token') or getConfigValue('llm.ollama.baseUrl')
 * @param key - The dot-separated camelCase key string.
 * @param defaultValue - Optional default value if the key is not found.
 * @returns The configuration value or the default value.
 */
export function getConfigValue<T = any>(key: string, defaultValue?: T): T | undefined {
    const config = getConfig(); // Ensure config is loaded
    // Use lodash get for safe deep access with dot notation
    const value = _.get(config, key);
    return value !== undefined ? value : defaultValue;
}

/**
 * Utility function to set a specific configuration value in the loaded config object using camelCase dot notation.
 * WARNING: This modifies the configuration in memory only. Changes are lost on restart.
 * Example: setConfigValue('llm.defaultProvider', 'anthropic')
 * @param key - The dot-separated camelCase key string.
 * @param value - The new value to set.
 * @returns True if the value was set successfully, false otherwise (e.g., key path invalid).
 */
export function setConfigValue(key: string, value: any): boolean {
    const config = getConfig();
    if (!config) return false;

    // Basic key validation
    if (!key || typeof key !== 'string' || key.includes('..') || key.startsWith('.') || key.endsWith('.')) {
        console.warn(`Invalid key format for setConfigValue: ${key}`);
        return false;
    }

    // Use lodash set for safe deep setting with dot notation
    // It handles creating intermediate objects if they don't exist.
    // However, we might want type checking/coercion based on existing structure.

    const keys = key.split('.');
    let currentLevel: any = config;
    let parentLevel: any = null;
    let finalKeySegment = '';

    // Traverse to find the parent object and the final key segment
    for (let i = 0; i < keys.length; i++) {
        const currentKeySegment = keys[i];
        if (currentKeySegment === undefined) { // Add check for undefined
            console.warn(`Invalid key segment at index ${i} for key: ${key}`);
            return false; // Or handle error appropriately
        }
        finalKeySegment = currentKeySegment; // Assign checked value

        if (i < keys.length - 1) {
            if (currentLevel && typeof currentLevel === 'object' && currentLevel[finalKeySegment] !== undefined) {
                parentLevel = currentLevel; // Keep track of parent
                currentLevel = currentLevel[finalKeySegment];
            } else {
                 // Path doesn't fully exist, lodash.set would create it, but maybe we want stricter control?
                 // For now, let lodash handle creation. If strictness is needed, add checks here.
                 parentLevel = currentLevel; // Parent is where creation would happen
                 currentLevel = undefined; // Indicate path doesn't exist fully
                 break;
            }
        } else {
             parentLevel = currentLevel; // Final key's parent
        }
    }

     if (parentLevel && typeof parentLevel === 'object') {
        const originalValue = parentLevel[finalKeySegment];
        const originalType = typeof originalValue;
        const newType = typeof value;
        let processedValue = value;

        // Attempt type coercion based on original type if it exists and types differ
        if (originalType !== 'undefined' && originalType !== newType) {
            if (originalType === 'number' && newType === 'string' && !isNaN(Number(value))) {
                processedValue = Number(value);
            } else if (originalType === 'boolean' && newType === 'string') {
                if (value.toLowerCase() === 'true') processedValue = true;
                else if (value.toLowerCase() === 'false') processedValue = false;
                // else keep as string if it's not 'true' or 'false' and types mismatch
            }
            // Add other coercions if needed (e.g., string to array via JSON.parse)
        }

        // Allow setting if types match after coercion OR if original was undefined
        if (originalType === 'undefined' || typeof originalValue === typeof processedValue) {
            _.set(config, key, processedValue); // Use lodash set to handle deep path
            console.log(`Configuration value '${key}' set to '${JSON.stringify(processedValue)}' (in-memory).`);
            return true;
        } else {
            console.warn(`Type mismatch for setConfigValue: Key '${key}' expects type '${originalType}', but received type '${typeof processedValue}' after coercion attempt.`);
            return false;
        }
    } else {
         // Let lodash.set handle creating the path if parentLevel is valid
         if (parentLevel !== null && typeof parentLevel === 'object') {
              _.set(config, key, value);
              console.log(`Configuration value '${key}' created and set to '${JSON.stringify(value)}' (in-memory).`);
              return true;
         } else {
              console.warn(`Invalid path or non-object parent for setConfigValue: ${key}`);
              return false;
         }
    }
}


/**
 * Applies configuration overrides from environment variables.
 * Variables should follow the pattern: LLMCORD_SECTION__KEY=value
 * or LLMCORD_SECTION__SUBSECTION__KEY=value (using double underscores as separators)
 * Assumes env var names match the camelCase config structure directly after the prefix.
 * @param config - The camelCased configuration object to modify.
 */
function applyEnvironmentVariableOverrides(config: Record<string, any>): void {
  const prefix = 'LLMCORD_';
  console.log('[EnvOverride] Checking for environment variable overrides...');

  for (const envVar in process.env) {
    if (envVar.startsWith(prefix)) {
      try {
        const rawKeyPath = envVar.substring(prefix.length);
        // Use double underscore as separator, assume segments match camelCase config keys
        const configPath = rawKeyPath.split('__').join('.');
        const value = process.env[envVar]; // Raw string value

        console.log(`[EnvOverride] Found potential override: ${envVar} -> maps to path '${configPath}' with value '${value}'`);

        if (value !== undefined && configPath) {
          let processedValue: any = value; // Start with the string value

          // --- Simplified Coercion ---
          // 1. Try JSON (Array or Object)
          if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
              try {
                  processedValue = JSON.parse(value.replace(/'/g, '"'));
                  console.log(`[EnvOverride] Coerced '${value}' to JSON for '${configPath}'`);
              } catch (e) {
                  console.warn(`[EnvOverride] Failed to parse JSON for '${envVar}'. Keeping as string.`);
                  processedValue = value; // Keep as string if parse fails
              }
          }
          // 2. Try Number (only if not already parsed as JSON object/array)
          else if (typeof processedValue === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
              processedValue = Number(value);
              console.log(`[EnvOverride] Coerced '${value}' to number for '${configPath}'`);
          }
          // 3. Try Boolean (only if not already parsed/coerced)
          else if (typeof processedValue === 'string') {
              const lowerValue = value.toLowerCase();
              if (lowerValue === 'true') {
                  processedValue = true;
                  console.log(`[EnvOverride] Coerced '${value}' to boolean (true) for '${configPath}'`);
              } else if (lowerValue === 'false') {
                  processedValue = false;
                  console.log(`[EnvOverride] Coerced '${value}' to boolean (false) for '${configPath}'`);
              }
          }
          // If none of the above, processedValue remains the original string

          // --- Manual Path Traversal and Setting ---
          const pathSegments = configPath.split('.');
          const finalKey = pathSegments.pop();

          if (finalKey) {
              let currentObject = config;
              // Traverse/create parent path
              for (const segment of pathSegments) {
                  if (currentObject[segment] === undefined || typeof currentObject[segment] !== 'object' || currentObject[segment] === null) {
                      currentObject[segment] = {}; // Create intermediate object if needed
                  }
                  currentObject = currentObject[segment];
              }
              // Set the final value
              currentObject[finalKey] = processedValue;
              console.log(`[EnvOverride] Setting config['${configPath}'] = ${JSON.stringify(processedValue)} (Type: ${typeof processedValue})`);
          } else {
               console.warn(`[EnvOverride] Invalid config path derived from env var '${envVar}': ${configPath}`);
          }

        } else if (value !== undefined) {
          console.warn(`[EnvOverride] Skipping env var '${envVar}' due to invalid format after conversion (empty path).`);
        }
      } catch (error: any) {
        console.error(`[EnvOverride] CRITICAL ERROR processing environment variable '${envVar}':`, error);
        // Optionally re-throw if you want the whole config load to fail on any env var error
        // throw error;
      }
    }
  }
  console.log('[EnvOverride] Finished checking environment variables.');
}

// Config is loaded explicitly via getConfig() when first needed.