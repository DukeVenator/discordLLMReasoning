// LLMcordTS/tests/utils/rateLimiter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '@/utils/rateLimiter';
import { Config } from '@/types/config'; // Import the Config type

// Mock the logger to prevent console output during tests
vi.mock('@/utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Define the shape of the reasoning rate limit object if it exists
type ReasoningRateLimitShape = {
    intervalSeconds: number;
    maxCalls: number;
};

// Helper function to create a mock Config object
const createMockConfig = (
    userRateLimitConfig?: Partial<Config['rateLimit']['user']>,
    globalRateLimitConfig?: Partial<Config['rateLimit']['global']>, // Add global config param
    reasoningRateLimitConfig?: Partial<ReasoningRateLimitShape> | null | undefined,
    reasoningEnabled = true
): Config => {
    // Base config without the reasoning part initially
    const baseConfig: Config = {
        discord: { token: 'mock_token', clientId: 'mock_client_id' },
        llm: { defaultProvider: 'mock' },
        memory: { enabled: false, storageType: 'sqlite', sqlite: { path: '' } },
        model: 'mock/mock-model', // Added missing mandatory property
        logging: { level: 'info' },
        permissions: {},
        rateLimit: {
            user: { // Default user limits
                intervalSeconds: 60,
                maxCalls: 5,
                ...(userRateLimitConfig ?? {}), // Apply user overrides
            },
            // Conditionally add global property only if globalRateLimitConfig is provided
            ...(globalRateLimitConfig && globalRateLimitConfig.intervalSeconds !== undefined && globalRateLimitConfig.maxCalls !== undefined
                ? { global: { intervalSeconds: globalRateLimitConfig.intervalSeconds, maxCalls: globalRateLimitConfig.maxCalls } }
                : {}),
        },
        // reasoning property is optional, so we can omit it if not enabled
    };

    // Add the reasoning property only if it's enabled
    if (reasoningEnabled) {
        // Start building the reasoning object
        const reasoningConfig: Config['reasoning'] = {
             enabled: true,
             // provider, model, prompt are omitted as they are optional
        };

        // Always add the rateLimit property with defaults if reasoning is enabled
        // Allow overrides if reasoningRateLimitConfig is provided
        reasoningConfig.rateLimit = {
            intervalSeconds: 300, // Default
            maxCalls: 2,          // Default
            ...(reasoningRateLimitConfig ?? {}), // Spread overrides if provided, otherwise empty object
        };
        // } // End of previous if block - removed
        // If reasoningRateLimitConfig is null/undefined, the defaults are used.

        baseConfig.reasoning = reasoningConfig;
    }
    // If reasoningEnabled is false, the entire reasoning property is omitted from baseConfig

    return baseConfig;
};


describe('RateLimiter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks(); // Restore timers and any other mocks
    });

    // --- Initialization Tests ---
    it('should initialize with default values from mock config', () => {
        const mockConfig = createMockConfig(); // Pass undefined for global and reasoning by default
        const limiter = new RateLimiter(mockConfig);

        // Check internal state based on the adapted constructor logic
        expect((limiter as any).userLimitEnabled).toBe(true); // Check user limit enabled
        expect((limiter as any).globalLimitEnabled).toBe(false); // Global not defined by default
        expect((limiter as any).userLimit).toBe(5);
        expect((limiter as any).userPeriodMs).toBe(60000);
        expect((limiter as any).userCooldownMs).toBe(12000); // 60000 / 5

        // Reasoning limits (defaults from helper)
        expect((limiter as any).reasoningUserLimit).toBe(2);
        expect((limiter as any).reasoningUserPeriodMs).toBe(300000);
        expect((limiter as any).reasoningUserCooldownMs).toBe(150000); // 300000 / 2
    });

    it('should initialize as disabled if rateLimit section is missing', () => {
        const mockConfig = createMockConfig(undefined); // No rateLimit section
        // Manually remove rateLimit for clarity
        delete (mockConfig as any).rateLimit;
        const limiter = new RateLimiter(mockConfig);
        expect((limiter as any).userLimitEnabled).toBe(false);
        expect((limiter as any).globalLimitEnabled).toBe(false);
    });

     it('should initialize as disabled if rateLimit config is invalid (maxCalls <= 0)', () => {
        const mockConfig = createMockConfig({ maxCalls: 0, intervalSeconds: 60 });
        const limiter = new RateLimiter(mockConfig);
        expect((limiter as any).userLimitEnabled).toBe(false);
        expect((limiter as any).globalLimitEnabled).toBe(false);
    });

    it('should initialize reasoning limits correctly when provided', () => {
        // Pass undefined for user and global, then the reasoning config
        const mockConfig = createMockConfig(undefined, undefined, { maxCalls: 10, intervalSeconds: 120 });
        const limiter = new RateLimiter(mockConfig);
        expect((limiter as any).reasoningUserLimit).toBe(10);
        expect((limiter as any).reasoningUserPeriodMs).toBe(120000);
        expect((limiter as any).reasoningUserCooldownMs).toBe(12000); // 120000 / 10
    });
it('should disable reasoning rate limiting if reasoning config is invalid', () => {
    // Reasoning enabled, but rateLimit invalid
    // Pass undefined for user, global, and reasoning limits, but true for reasoningEnabled
    const mockConfig = createMockConfig(undefined, undefined, { maxCalls: 0, intervalSeconds: 120 }, true);
    const limiter = new RateLimiter(mockConfig);
    // Check reasoning cooldown - should be 0 if limits are invalid
        // Check reasoning cooldown - should be 0 if limits are invalid
        expect((limiter as any).reasoningUserCooldownMs).toBe(0);
        // Check should still allow requests if limits are invalid
        const [allowed] = limiter.checkReasoningRateLimit('user1');
        expect(allowed).toBe(true);
    });

    // --- User Rate Limit Tests --- // Renamed describe block implicitly
    it('should allow requests within the user limit', () => { // Renamed test
        const mockConfig = createMockConfig({ maxCalls: 3, intervalSeconds: 10 }, undefined); // Pass undefined for global
        const limiter = new RateLimiter(mockConfig);
        const userId = 'user1';

        expect(limiter.checkRateLimit(userId)).toEqual([true, 'ok']);
        expect(limiter.checkRateLimit(userId)).toEqual([true, 'ok']);
        expect(limiter.checkRateLimit(userId)).toEqual([true, 'ok']);
    });

    it('should deny requests exceeding the user limit', () => { // Renamed test
        const mockConfig = createMockConfig({ maxCalls: 2, intervalSeconds: 10 }, undefined); // Pass undefined for global
        const limiter = new RateLimiter(mockConfig);
        const userId = 'user2';

        limiter.checkRateLimit(userId); // 1
        limiter.checkRateLimit(userId); // 2
        expect(limiter.checkRateLimit(userId)).toEqual([false, 'user']); // 3 - Denied
    });

    it('should allow requests again after user cooldown', () => { // Renamed test
        const mockConfig = createMockConfig({ maxCalls: 2, intervalSeconds: 10 }, undefined); // Pass undefined for global
        const limiter = new RateLimiter(mockConfig);
        const userId = 'user3';

        limiter.checkRateLimit(userId); // 1
        limiter.checkRateLimit(userId); // 2
        expect(limiter.checkRateLimit(userId)[0]).toBe(false); // 3 - Denied

        vi.advanceTimersByTime(4999); // Just before cooldown ends
        expect(limiter.checkRateLimit(userId)[0]).toBe(false); // Still denied

        vi.advanceTimersByTime(2); // Pass cooldown threshold
        expect(limiter.checkRateLimit(userId)).toEqual([true, 'ok']); // Allowed again
        expect(limiter.checkRateLimit(userId)).toEqual([true, 'ok']); // Allowed (2nd in new window)
        expect(limiter.checkRateLimit(userId)[0]).toBe(false); // Denied again
    });

     it('should reset user limit after the period', () => { // Renamed test
        const mockConfig = createMockConfig({ maxCalls: 1, intervalSeconds: 10 }, undefined); // Pass undefined for global
        const limiter = new RateLimiter(mockConfig);
        const userId = 'user4';

        limiter.checkRateLimit(userId); // 1
        expect(limiter.checkRateLimit(userId)[0]).toBe(false); // 2 - Denied

        vi.advanceTimersByTime(9999); // Just before period ends
        expect(limiter.checkRateLimit(userId)[0]).toBe(false); // Still denied

        vi.advanceTimersByTime(2); // Pass period end
        expect(limiter.checkRateLimit(userId)).toEqual([true, 'ok']); // Allowed again (limit reset)
        expect(limiter.checkRateLimit(userId)[0]).toBe(false); // Denied again
    // --- Global Rate Limit Tests ---
    describe('Global Rate Limit Tests', () => {
        it('should allow requests within the global limit from multiple users', () => {
            const mockConfig = createMockConfig(
                { maxCalls: 5, intervalSeconds: 60 }, // User limit (high)
                { maxCalls: 3, intervalSeconds: 10 }  // Global limit (low)
            );
            const limiter = new RateLimiter(mockConfig);
            const user1 = 'globalUser1';
            const user2 = 'globalUser2';

            expect(limiter.checkRateLimit(user1)).toEqual([true, 'ok']); // Global 1
            expect(limiter.checkRateLimit(user2)).toEqual([true, 'ok']); // Global 2
            expect(limiter.checkRateLimit(user1)).toEqual([true, 'ok']); // Global 3
        });

        it('should deny requests exceeding the global limit', () => {
            const mockConfig = createMockConfig(
                { maxCalls: 5, intervalSeconds: 60 },
                { maxCalls: 2, intervalSeconds: 10 }
            );
            const limiter = new RateLimiter(mockConfig);
            const user1 = 'globalUser3';
            const user2 = 'globalUser4';

            limiter.checkRateLimit(user1); // Global 1
            limiter.checkRateLimit(user2); // Global 2
            expect(limiter.checkRateLimit(user1)).toEqual([false, 'global']); // Global 3 - Denied
            expect(limiter.checkRateLimit(user2)).toEqual([false, 'global']); // Global 4 - Denied
        });

        it('should allow requests again after global cooldown', () => {
            const mockConfig = createMockConfig(
                { maxCalls: 5, intervalSeconds: 60 },
                { maxCalls: 2, intervalSeconds: 10 } // Global Cooldown = 10000 / 2 = 5000ms
            );
            const limiter = new RateLimiter(mockConfig);
            const user1 = 'globalUser5';

            limiter.checkRateLimit(user1); // Global 1
            limiter.checkRateLimit(user1); // Global 2
            expect(limiter.checkRateLimit(user1)[1]).toBe('global'); // Global 3 - Denied

            vi.advanceTimersByTime(4999); // Just before cooldown ends
            expect(limiter.checkRateLimit(user1)[1]).toBe('global'); // Still denied

            vi.advanceTimersByTime(2); // Pass cooldown threshold
            expect(limiter.checkRateLimit(user1)).toEqual([true, 'ok']); // Allowed again (Global 1)
        });

         it('should reset global limit after the period', () => {
            const mockConfig = createMockConfig(
                { maxCalls: 5, intervalSeconds: 60 },
                { maxCalls: 1, intervalSeconds: 10 } // Global Cooldown = 10s
            );
            const limiter = new RateLimiter(mockConfig);
            const user1 = 'globalUser6';

            limiter.checkRateLimit(user1); // Global 1
            expect(limiter.checkRateLimit(user1)[1]).toBe('global'); // Global 2 - Denied

            vi.advanceTimersByTime(9999); // Just before period ends
            expect(limiter.checkRateLimit(user1)[1]).toBe('global'); // Still denied

            vi.advanceTimersByTime(2); // Pass period end
            expect(limiter.checkRateLimit(user1)).toEqual([true, 'ok']); // Allowed again (Global 1, limit reset)
            expect(limiter.checkRateLimit(user1)[1]).toBe('global'); // Denied again (Global 2)
        });

        it('should deny based on global limit even if user limit allows', () => {
             const mockConfig = createMockConfig(
                { maxCalls: 5, intervalSeconds: 60 }, // High user limit
                { maxCalls: 1, intervalSeconds: 10 }  // Low global limit
            );
            const limiter = new RateLimiter(mockConfig);
            const user1 = 'globalUser7';
            const user2 = 'globalUser8';

            expect(limiter.checkRateLimit(user1)).toEqual([true, 'ok']); // User 1/5, Global 1/1
            // User 2 is within their user limit, but global limit is hit
            expect(limiter.checkRateLimit(user2)).toEqual([false, 'global']); // User 1/5, Global 2/1 - Denied
        });

        it('getCooldownRemaining should return remaining global cooldown when global limit is hit first', () => {
            const mockConfig = createMockConfig(
                { maxCalls: 5, intervalSeconds: 60 }, // User Cooldown = 12s
                { maxCalls: 1, intervalSeconds: 10 }  // Global Cooldown = 10s
            );
            const limiter = new RateLimiter(mockConfig);
            const userId = 'globalCoolUser1';

            limiter.checkRateLimit(userId); // Hit global limit
            expect(limiter.checkRateLimit(userId)[1]).toBe('global'); // Denied by global

            vi.advanceTimersByTime(3000); // Advance 3 seconds
            // Should return global cooldown remaining
            expect(limiter.getCooldownRemaining(userId)).toBeCloseTo(7.0); // 10 - 3 = 7

            vi.advanceTimersByTime(6999); // Advance just before global cooldown ends
            expect(limiter.getCooldownRemaining(userId)).toBeCloseTo(0.001);

            vi.advanceTimersByTime(2); // Pass global cooldown end
            expect(limiter.getCooldownRemaining(userId)).toBe(0); // No cooldown remaining
        });

         it('getCooldownRemaining should return the longer cooldown (user vs global)', () => {
            const mockConfig = createMockConfig(
                { maxCalls: 1, intervalSeconds: 20 }, // User Cooldown = 20s
                { maxCalls: 1, intervalSeconds: 10 }  // Global Cooldown = 10s
            );
            const limiter = new RateLimiter(mockConfig);
            const userId = 'globalCoolUser2';

            limiter.checkRateLimit(userId); // Hit both user and global limit
            expect(limiter.checkRateLimit(userId)[1]).toBe('global'); // Denied by global (checked first)

            vi.advanceTimersByTime(5000); // Advance 5 seconds
            // Global cooldown would be 5s, User cooldown is 15s. Should return 15s.
            expect(limiter.getCooldownRemaining(userId)).toBeCloseTo(15.0);

            vi.advanceTimersByTime(6000); // Advance another 6 seconds (Total 11s)
            // Global cooldown is passed (10s). User cooldown is 9s. Should return 9s.
             expect(limiter.getCooldownRemaining(userId)).toBeCloseTo(9.0); // 20 - 11 = 9

            vi.advanceTimersByTime(9001); // Advance past user cooldown (Total 20.001s)
            expect(limiter.getCooldownRemaining(userId)).toBe(0);
        });

    });
    // --- End Global Rate Limit Tests ---

    });

    // --- Reasoning Rate Limit Tests ---
     it('should allow requests within the reasoning limit', () => {
        const mockConfig = createMockConfig(undefined, undefined, { maxCalls: 3, intervalSeconds: 10 });
        const limiter = new RateLimiter(mockConfig);
        const userId = 'reasonUser1';

        expect(limiter.checkReasoningRateLimit(userId)).toEqual([true, 'ok']);
        expect(limiter.checkReasoningRateLimit(userId)).toEqual([true, 'ok']);
        expect(limiter.checkReasoningRateLimit(userId)).toEqual([true, 'ok']);
    });

    it('should deny requests exceeding the reasoning limit', () => {
        const mockConfig = createMockConfig(undefined, undefined, { maxCalls: 1, intervalSeconds: 10 });
        const limiter = new RateLimiter(mockConfig);
        const userId = 'reasonUser2';

        limiter.checkReasoningRateLimit(userId); // 1
        expect(limiter.checkReasoningRateLimit(userId)).toEqual([false, 'user']); // 2 - Denied
    });

     it('should allow reasoning requests again after cooldown', () => {
        const mockConfig = createMockConfig(undefined, undefined, { maxCalls: 2, intervalSeconds: 20 }); // Cooldown = 20000 / 2 = 10000ms
        const limiter = new RateLimiter(mockConfig);
        const userId = 'reasonUser3';

        limiter.checkReasoningRateLimit(userId); // 1
        limiter.checkReasoningRateLimit(userId); // 2
        expect(limiter.checkReasoningRateLimit(userId)[0]).toBe(false); // 3 - Denied

        vi.advanceTimersByTime(9999); // Just before cooldown ends
        expect(limiter.checkReasoningRateLimit(userId)[0]).toBe(false); // Still denied

        vi.advanceTimersByTime(2); // Pass cooldown threshold
        expect(limiter.checkReasoningRateLimit(userId)).toEqual([true, 'ok']); // Allowed again
    });

    // --- Cooldown Calculation Tests ---
    it('getCooldownRemaining should return 0 when not limited (user only)', () => { // Renamed test
        const mockConfig = createMockConfig({ maxCalls: 5, intervalSeconds: 10 }, undefined); // Pass undefined for global
        const limiter = new RateLimiter(mockConfig);
        const userId = 'userCool1';
        limiter.checkRateLimit(userId);
        expect(limiter.getCooldownRemaining(userId)).toBe(0);
    });

    it('getCooldownRemaining should return remaining user cooldown', () => { // Renamed test
        const mockConfig = createMockConfig({ maxCalls: 1, intervalSeconds: 10 }, undefined); // Pass undefined for global
        const limiter = new RateLimiter(mockConfig);
        const userId = 'userCool2';

        limiter.checkRateLimit(userId); // Hit limit
        expect(limiter.checkRateLimit(userId)[0]).toBe(false); // Denied

        vi.advanceTimersByTime(3000); // Advance 3 seconds
        expect(limiter.getCooldownRemaining(userId)).toBeCloseTo(7.0); // 10 - 3 = 7

        vi.advanceTimersByTime(6999); // Advance just before end
         expect(limiter.getCooldownRemaining(userId)).toBeCloseTo(0.001);

        vi.advanceTimersByTime(2); // Pass end
        expect(limiter.getCooldownRemaining(userId)).toBe(0);
    });

     it('getReasoningCooldownRemaining should return remaining reasoning cooldown', () => {
        const mockConfig = createMockConfig(undefined, undefined, { maxCalls: 1, intervalSeconds: 20 }); // Cooldown = 20s
        const limiter = new RateLimiter(mockConfig);
        const userId = 'reasonCool1';

        limiter.checkReasoningRateLimit(userId); // Hit limit
        expect(limiter.checkReasoningRateLimit(userId)[0]).toBe(false); // Denied

        vi.advanceTimersByTime(5000); // Advance 5 seconds
        expect(limiter.getReasoningCooldownRemaining(userId)).toBeCloseTo(15.0); // 20 - 5 = 15

        vi.advanceTimersByTime(14998); // Advance just before end
        expect(limiter.getReasoningCooldownRemaining(userId)).toBeCloseTo(0.002);

        vi.advanceTimersByTime(3); // Pass end
        expect(limiter.getReasoningCooldownRemaining(userId)).toBe(0);
    });

     it('getCooldownRemaining should return 0 if limiter is disabled', () => {
        const mockConfig = createMockConfig();
        delete (mockConfig as any).rateLimit; // Disable general limit
        delete mockConfig.reasoning?.rateLimit; // Disable reasoning limit
        const limiter = new RateLimiter(mockConfig);
        const userId = 'userCoolDisabled';

        expect(limiter.getCooldownRemaining(userId)).toBe(0);
        expect(limiter.getReasoningCooldownRemaining(userId)).toBe(0);
    });

});