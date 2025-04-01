// LLMcordTS/tests/core/config.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'; // Added afterEach
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { loadConfig, getConfig, getConfigValue } from '@/core/config'; // Use path alias
// import { Config } from '@/types/config'; // Removed unused import

// Mock dependencies
vi.mock('fs');
vi.mock('js-yaml');

// Mock path.resolve only for the specific config path resolution
// Keep original behavior for other paths if necessary
const originalPathResolve = path.resolve;
vi.mock('path', async (importOriginal) => {
    const originalPath = await importOriginal<typeof path>();
    return {
        ...originalPath,
        resolve: vi.fn((...args: string[]) => {
            // Check if it's trying to resolve the default config path from __dirname
            // Add type check for args[1] before calling endsWith
            if (args.length > 1 && typeof args[1] === 'string' && args[1].endsWith('config.yaml')) {
                 // Return a predictable mock path regardless of __dirname
                return '/mock/path/config.yaml';
            }
            // Fallback to original resolve for other cases
            return originalPathResolve(...args);
        }),
    };
});


describe('Configuration Loading', () => {
    const mockConfigPath = '/mock/path/config.yaml';

    // Define a partial user config for testing merging
    const mockUserConfig = {
        discord: { token: 'user_token_from_yaml', clientId: 'user_client_id_from_yaml' }, // Provide required fields
        llm: { defaultProvider: 'user_provider_from_yaml' }, // Overrides provider
        logging: { level: 'debug' }, // Overrides logging level
        customSection: { value: 'test' },
        model: 'mock/model', // Add required model setting
        providers: { mock: { apiKey: 'mock_key' } } // Add mock provider details
    };
    const mockYamlContent = yaml.dump(mockUserConfig); // Generate YAML string from mock object

    beforeEach(() => {
        // Reset mocks before each test
        vi.resetAllMocks();
        // Reset the internal loadedConfig state by forcing reload in relevant tests
        // This ensures tests don't interfere via the getConfig cache.
    });

    it('should load config from YAML file and merge with defaults', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(mockYamlContent);
        vi.mocked(yaml.load).mockReturnValue(mockUserConfig);

        // Use loadConfig directly to test the loading mechanism itself
        const config = loadConfig(mockConfigPath);

        // Assert specific merged values
        expect(config.discord.token).toBe('user_token_from_yaml');
        expect(config.discord.clientId).toBeDefined(); // Should come from the real default
        expect(config.llm.defaultProvider).toBe('user_provider_from_yaml');
        expect((config as any).customSection?.value).toBe('test'); // User-specific section
        expect(config.logging?.level).toBe('debug'); // Overridden by user config
        expect(config.memory?.enabled).toBeDefined(); // Should come from the real default

        // Verify mocks were called
        expect(fs.existsSync).toHaveBeenCalledWith(mockConfigPath);
        expect(fs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf8');
        expect(yaml.load).toHaveBeenCalledWith(mockYamlContent);
    });

    it('should throw an error if required discord token is missing after merge', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        // Simulate a user config *without* the token
        const userConfigWithoutToken = { llm: { defaultProvider: 'user_provider' } };
        vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(userConfigWithoutToken));
        vi.mocked(yaml.load).mockReturnValue(userConfigWithoutToken);

        // The internal default config lacks a token, so merging won't add it.
        expect(() => loadConfig(mockConfigPath)).toThrow(/Discord token is missing/);
    });

     it('should throw an error if required discord clientId is missing after merge', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        // Simulate a user config *with* token but somehow missing clientId
        // This relies on the internal default *not* providing clientId, which is no longer true.
        // Test by having yaml.load return an object missing the clientId.
        const userConfigMissingClientId = { discord: { token: 'user_token' } }; // yaml load result
        vi.mocked(fs.readFileSync).mockReturnValue('discord: { token: user_token }'); // Dummy file content
        vi.mocked(yaml.load).mockReturnValue(userConfigMissingClientId);

        expect(() => loadConfig(mockConfigPath)).toThrow(/Discord client ID is missing/);
    });


    it('should throw error if YAML parsing fails', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('invalid: yaml: content');
        const parseError = new Error('YAML parse error');
        vi.mocked(yaml.load).mockImplementation(() => { throw parseError; });

        expect(() => loadConfig(mockConfigPath)).toThrow(/Failed to load or parse config file: YAML parse error/);
    });

     it('should throw error if config file read fails', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        const readError = new Error('File read error');
        vi.mocked(fs.readFileSync).mockImplementation(() => { throw readError; });

        expect(() => loadConfig(mockConfigPath)).toThrow(/Failed to load or parse config file: File read error/);
        expect(yaml.load).not.toHaveBeenCalled(); // Should not reach yaml.load
    });


    it('getConfig should return cached config on subsequent calls', () => {
         vi.mocked(fs.existsSync).mockReturnValue(true);
         const mockConfigForCacheTest = {
             discord: { token: 'test_token', clientId: 'test_client_id' },
             model: 'mock/model',
             providers: { mock: { apiKey: 'mock_key' } } // Add mock provider details
         };
         vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfigForCacheTest));
         vi.mocked(yaml.load).mockReturnValue(mockConfigForCacheTest);

         const config1 = getConfig(true, mockConfigPath); // Force load
         const config2 = getConfig(); // Get cached

         expect(config1).toBe(config2); // Should be the same object instance
         expect(fs.readFileSync).toHaveBeenCalledTimes(1); // Should only read once
     });

     it('getConfigValue should retrieve nested values correctly', () => {
         vi.mocked(fs.existsSync).mockReturnValue(true);
         const testConfig = {
             discord: { token: 'test_token', clientId: 'test_client_id' },
             llm: { defaultProvider: 'test_provider', openai: { apiKey: 'test_key' } },
             memory: { enabled: true, sqlite: { path: './test.db' } },
             model: 'mock/model', // Add required model setting
             providers: { mock: { apiKey: 'mock_key' } } // Add mock provider details
         };
         vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(testConfig));
         vi.mocked(yaml.load).mockReturnValue(testConfig);

         getConfig(true, mockConfigPath); // Force load config

         expect(getConfigValue('discord.token')).toBe('test_token');
         expect(getConfigValue('llm.openai.apiKey')).toBe('test_key');
         expect(getConfigValue('memory.sqlite.path')).toBe('./test.db');
         expect(getConfigValue<boolean>('memory.enabled')).toBe(true);
     });

     it('getConfigValue should return default value if key not found', () => {
         vi.mocked(fs.existsSync).mockReturnValue(true);
         const testConfig = { discord: { token: 'test_token', clientId: 'test_client_id' }, model: 'mock/model', providers: { mock: { apiKey: 'mock_key' } } }; // Add required model setting and provider
         vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(testConfig));
         vi.mocked(yaml.load).mockReturnValue(testConfig);

         getConfig(true, mockConfigPath); // Force load config

         expect(getConfigValue('llm.nonExistentKey', 'defaultValue')).toBe('defaultValue');
         // Check against a value expected from the *real* defaults merged in config.ts
         expect(getConfigValue('logging.level', 'fallback')).toBe('info');
         expect(getConfigValue('completely.missing.path', 123)).toBe(123);
     });

      it('getConfigValue should return undefined if key not found and no default provided', () => {
         vi.mocked(fs.existsSync).mockReturnValue(true);
         const testConfig = { discord: { token: 'test_token', clientId: 'test_client_id' }, model: 'mock/model', providers: { mock: { apiKey: 'mock_key' } } }; // Add required model setting and provider
         vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(testConfig));
         vi.mocked(yaml.load).mockReturnValue(testConfig);

         getConfig(true, mockConfigPath); // Force load config

         expect(getConfigValue('llm.nonExistentKey')).toBeUndefined();
         expect(getConfigValue('customSection.value')).toBeUndefined();
     });



describe('Environment Variable Overrides', () => {
    const mockConfigPath = '/mock/path/env_override_config.yaml';
    const baseUserConfig = {
        discord: { token: 'yaml_token', clientId: 'yaml_client_id' },
        llm: {
            defaultProvider: 'yaml_provider',
            ollama: { baseURL: 'http://yamlhost:11434', defaultModel: 'yaml_model' },
        },
        memory: { enabled: true, maxHistoryLength: 10 },
        permissions: { allowedUsers: ['yaml_user'] },
        model: 'yaml_provider/yaml_model', // Required setting
        providers: { yamlProvider: { apiKey: 'yaml_key' } } // Use camelCase here to match normalized config
    };
    const baseYamlContent = yaml.dump(baseUserConfig);

    // Store original env vars to restore later
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        // Reset mocks
        vi.resetAllMocks();
        // Mock file system reads for this test suite
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(baseYamlContent);
        vi.mocked(yaml.load).mockReturnValue(JSON.parse(JSON.stringify(baseUserConfig))); // Deep clone

        // Backup and clear relevant env vars using camelCase format
        originalEnv = { ...process.env };
        delete process.env['LLMCORD_discord__token'];
        delete process.env['LLMCORD_llm__defaultProvider'];
        delete process.env['LLMCORD_llm__ollama__baseURL'];
        delete process.env['LLMCORD_memory__enabled'];
        delete process.env['LLMCORD_memory__maxHistoryLength'];
        delete process.env['LLMCORD_permissions__allowedUsers'];
        delete process.env['LLMCORD_logging__level'];
        delete process.env['LLMCORD_providers__newProvider__apiKey'];
    });

    afterEach(() => {
        // Restore original environment variables
        process.env = originalEnv;
    });

    it('should override top-level string value (discord.token)', () => {
        process.env['LLMCORD_discord__token'] = 'env_token';
        const config = loadConfig(mockConfigPath);
        expect(config.discord.token).toBe('env_token');
        expect(config.discord.clientId).toBe('yaml_client_id'); // Should remain from YAML
    });

    it('should override nested string value (llm.ollama.baseURL)', () => {
        process.env['LLMCORD_llm__ollama__baseURL'] = 'http://envhost:11434';
        const config = loadConfig(mockConfigPath);
        expect(config.llm?.ollama?.baseURL).toBe('http://envhost:11434');
        expect(config.llm?.ollama?.defaultModel).toBe('yaml_model'); // Should remain from YAML
    });

    it('should override and coerce boolean value (memory.enabled)', () => {
        process.env['LLMCORD_memory__enabled'] = 'false';
        const config = loadConfig(mockConfigPath);
        expect(config.memory.enabled).toBe(false);
    });

    it('should override and coerce numeric value (memory.maxHistoryLength)', () => {
        process.env['LLMCORD_memory__maxHistoryLength'] = '99';
        const config = loadConfig(mockConfigPath);
        expect(config.memory.maxHistoryLength).toBe(99);
    });

    it('should override array value with JSON string (permissions.allowedUsers)', () => {
        process.env['LLMCORD_permissions__allowedUsers'] = '["env_user1", "env_user2"]';
        const config = loadConfig(mockConfigPath);
        expect(config.permissions.allowedUsers).toEqual(['env_user1', 'env_user2']);
    });

    it('should override default value if not present in YAML (logging.level)', () => {
        // Base config doesn't have logging level, relies on default ('info')
        const configWithoutLogging = {
             discord: { token: 'yaml_token', clientId: 'yaml_client_id' },
             model: 'yaml/model', providers: { yaml: { apiKey: 'key' } }
        };
        vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(configWithoutLogging));
        vi.mocked(yaml.load).mockReturnValue(configWithoutLogging);

        process.env['LLMCORD_logging__level'] = 'warn';
        const config = loadConfig(mockConfigPath);
        expect(config.logging?.level).toBe('warn');
    });

    it('should create intermediate objects for deep overrides (providers.newProvider.apiKey)', () => {
        process.env['LLMCORD_providers__newProvider__apiKey'] = 'env_new_key';
        const config = loadConfig(mockConfigPath);
        // Access using the final camelCase keys
        expect((config.providers as any)?.newProvider?.apiKey).toBe('env_new_key');
        // Ensure existing provider data is not lost - Use bracket notation for dynamic key
        expect(config.providers?.['yamlProvider']?.apiKey).toBe('yaml_key'); // Check camelCase key
    });

     it('should handle invalid JSON for array override gracefully (treat as string)', () => {
        process.env['LLMCORD_permissions__allowedUsers'] = '[invalid json';
        const config = loadConfig(mockConfigPath);
        // It should fall back to treating the value as a string because parsing failed
        expect(config.permissions.allowedUsers).toBe('[invalid json');
    });

    it('should handle invalid numeric coercion gracefully (treat as string)', () => {
        process.env['LLMCORD_memory__maxHistoryLength'] = 'not-a-number';
        const config = loadConfig(mockConfigPath);
        // It should fall back to treating the value as a string because coercion failed
        expect(config.memory.maxHistoryLength).toBe('not-a-number');
    });

    it('should handle invalid boolean coercion gracefully (treat as string)', () => {
        process.env['LLMCORD_memory__enabled'] = 'maybe'; // Not 'true' or 'false'
        const config = loadConfig(mockConfigPath);
        // It should fall back to treating the value as a string because coercion failed
        expect(config.memory.enabled).toBe('maybe');
    });
});

});