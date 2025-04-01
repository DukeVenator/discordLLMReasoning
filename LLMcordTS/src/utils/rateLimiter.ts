/**
 * @fileoverview Implements rate limiting logic for bot interactions.
 * Handles both general user/global limits and specific limits for the reasoning feature.
 */
import { Config } from '@/types/config'; // Import directly from types
import { logger } from '@/core/logger'; // Import shared logger instance

// Use the imported logger directly

interface RateLimitData {
  lastRequestTime: number; // Store time in milliseconds
  requestCount: number;
}

/**
 * Manages rate limits for bot commands and reasoning requests.
 * Reads configuration for general and reasoning-specific limits and applies them.
 */
export class RateLimiter {
  /** Whether general rate limiting is enabled based on config. */
  /** Whether general user rate limiting is enabled based on config. */
  private userLimitEnabled: boolean;
  /** Whether global rate limiting is enabled based on config. */
  private globalLimitEnabled: boolean;

  // User limits
  /** Max general requests per user per period. */
  private userLimit: number;
  /** General user rate limit period in milliseconds. */
  private userPeriodMs: number;
  /** Minimum time between general requests for a user (ms). */
  private userCooldownMs: number;

  // Global limits
  /** Max general requests globally per period. Null if not configured. */
  private globalLimit: number | null;
  /** Global general rate limit period in milliseconds. Null if not configured. */
  private globalPeriodMs: number | null;
  /** Minimum time between general requests globally (ms). 0 if not configured. */
  private globalCooldownMs: number;

  // Reasoning User limits
  /** Max reasoning requests per user per period. */
  private reasoningUserLimit: number;
  /** Reasoning user rate limit period in milliseconds. */
  private reasoningUserPeriodMs: number;
  /** Minimum time between reasoning requests for a user (ms). */
  private reasoningUserCooldownMs: number;

  // Reasoning Global limits
  /** Max reasoning requests globally per period (null if disabled/not configured). */
  private reasoningGlobalLimit: number | null;
  /** Global reasoning rate limit period in milliseconds (null if disabled/not configured). */
  private reasoningGlobalPeriodMs: number | null;
  /** Minimum time between reasoning requests globally (ms, 0 if disabled). */
  private reasoningGlobalCooldownMs: number;

  // State
  /** Stores general rate limit state per user ID. */
  private userData: Map<string, RateLimitData> = new Map();
  /** Current count for the global general rate limit window. */
  private globalRequestCount: number = 0;
  /** Timestamp of the last request for the global general limit. */
  private globalLastRequestTime: number = 0;

  // Reasoning State
  /** Stores reasoning rate limit state per user ID. */
  private reasoningUserData: Map<string, RateLimitData> = new Map();
  /** Current count for the global reasoning rate limit window. */
  private reasoningGlobalRequestCount: number = 0;
  /** Timestamp of the last request for the global reasoning limit. */
  private reasoningGlobalLastRequestTime: number = 0;

  /**
   * Creates an instance of RateLimiter.
   * Reads rate limit settings from the provided configuration object for both
   * general usage and the optional reasoning feature.
   * Calculates cooldown periods based on limits and intervals.
   * @param {Config} config - The loaded application configuration.
   */
  constructor(config: Config) {
   // Access nested properties directly with defaults based on the TS Config type structure.

   // --- User Rate Limits ---
   const userRateLimitConfig = config.rateLimit?.user;
   this.userLimitEnabled = userRateLimitConfig != null &&
                           (userRateLimitConfig.maxCalls ?? 0) > 0 &&
                           (userRateLimitConfig.intervalSeconds ?? 0) > 0;

   this.userLimit = userRateLimitConfig?.maxCalls ?? 5;
   const userPeriodSec = userRateLimitConfig?.intervalSeconds ?? 60;
   this.userPeriodMs = userPeriodSec * 1000;
   this.userCooldownMs = 0;
   if (this.userLimitEnabled && this.userLimit > 0 && this.userPeriodMs > 0) {
     this.userCooldownMs = this.userPeriodMs / this.userLimit;
   } else {
       this.userLimitEnabled = false; // Ensure disabled if values are invalid
   }

   // --- Global Rate Limits ---
   const globalRateLimitConfig = config.rateLimit?.global;
   this.globalLimitEnabled = globalRateLimitConfig != null &&
                             (globalRateLimitConfig.maxCalls ?? 0) > 0 &&
                             (globalRateLimitConfig.intervalSeconds ?? 0) > 0;

   this.globalLimit = null;
   this.globalPeriodMs = null;
   this.globalCooldownMs = 0;

   if (this.globalLimitEnabled && globalRateLimitConfig) { // Add explicit check for globalRateLimitConfig
       this.globalLimit = globalRateLimitConfig.maxCalls;
       const globalPeriodSec = globalRateLimitConfig.intervalSeconds;
       this.globalPeriodMs = globalPeriodSec * 1000;
       if (this.globalLimit > 0 && this.globalPeriodMs > 0) {
           this.globalCooldownMs = this.globalPeriodMs / this.globalLimit;
       } else {
           this.globalLimitEnabled = false; // Disable if values are invalid (e.g., 0)
           this.globalLimit = null;
           this.globalPeriodMs = null;
       }
   }


   // --- Using `config.reasoning.rateLimit` for reasoning checks ---
   const reasoningConfig = config.reasoning;
   const reasoningLimitsConfig = reasoningConfig?.rateLimit;
   const reasoningEnabled = reasoningConfig?.enabled ?? false;
   // Enable reasoning rate limiting if reasoning is enabled AND the rateLimit section exists with valid values
   const reasoningRateLimitEnabled = reasoningEnabled &&
                                     reasoningLimitsConfig != null &&
                                     (reasoningLimitsConfig.maxCalls ?? 0) > 0 &&
                                     (reasoningLimitsConfig.intervalSeconds ?? 0) > 0;

   this.reasoningUserLimit = reasoningLimitsConfig?.maxCalls ?? 2;
   const reasoningUserPeriodSec = reasoningLimitsConfig?.intervalSeconds ?? 300;
   this.reasoningUserPeriodMs = reasoningUserPeriodSec * 1000;
   this.reasoningUserCooldownMs = 0;
   if (reasoningRateLimitEnabled && this.reasoningUserLimit > 0 && this.reasoningUserPeriodMs > 0) {
       this.reasoningUserCooldownMs = this.reasoningUserPeriodMs / this.reasoningUserLimit;
   }

   // Reasoning global limits are not defined in the TS config
   this.reasoningGlobalLimit = null; // Disabled
   this.reasoningGlobalPeriodMs = null; // Disabled
   this.reasoningGlobalCooldownMs = 0;


   // --- Logging ---
   const anyLimitEnabled = this.userLimitEnabled || this.globalLimitEnabled || reasoningRateLimitEnabled;

   if (!anyLimitEnabled && !reasoningEnabled) {
       logger.info('All rate limiting is disabled or not configured.');
   } else {
       if (this.userLimitEnabled) {
           logger.info(
               `User rate limit: ${this.userLimit}/${userPeriodSec}s (cooldown: ${(this.userCooldownMs / 1000).toFixed(2)}s)`
           );
       } else if (userRateLimitConfig) { // Check if config existed but was invalid
            logger.warn('User rate limit config found but invalid (maxCalls/intervalSeconds must be > 0). User rate limiting disabled.');
       }

       if (this.globalLimitEnabled && this.globalLimit !== null && this.globalPeriodMs !== null) {
            logger.info(
               `Global rate limit: ${this.globalLimit}/${this.globalPeriodMs / 1000}s (cooldown: ${(this.globalCooldownMs / 1000).toFixed(2)}s)`
            );
       } else if (globalRateLimitConfig) { // Check if config existed but was invalid
            logger.warn('Global rate limit config found but invalid (maxCalls/intervalSeconds must be > 0). Global rate limiting disabled.');
       }

       if (reasoningRateLimitEnabled) {
            logger.info(
               `Reasoning rate limit: ${this.reasoningUserLimit}/${reasoningUserPeriodSec}s (cooldown: ${(this.reasoningUserCooldownMs / 1000).toFixed(2)}s)`
            );
       } else if (reasoningEnabled && reasoningLimitsConfig) {
           logger.warn('Reasoning rate limit config found but invalid (maxCalls/intervalSeconds must be > 0). Reasoning rate limiting disabled.');
       } else if (reasoningEnabled && !reasoningLimitsConfig) {
           logger.info('Reasoning is enabled but reasoning.rateLimit section is missing or empty in config. Reasoning rate limiting disabled.');
       }
   }
 }

  /**
   * Checks if a user request is allowed based on general rate limits (user and global).
   * If allowed, updates the user and global request counts and timestamps.
   * Note: Global limits are currently placeholders based on defaults, not the TS config type.
   * @param {string} userId - The Discord user ID making the request.
   * @returns {[boolean, 'ok' | 'global' | 'user']} A tuple where the first element is true if allowed, false otherwise,
   * and the second element indicates the reason ('ok', 'global' limit hit, 'user' limit hit).
   */
  /**
   * Checks global and user rate limits.
   * @param userId The Discord user ID.
   * @returns [allow_request: boolean, reason: 'ok' | 'global' | 'user']
   */
  checkRateLimit(userId: string): [boolean, 'ok' | 'global' | 'user'] {
    // If neither user nor global limits are enabled, allow the request
    if (!this.userLimitEnabled && !this.globalLimitEnabled) {
      return [true, 'ok'];
    }

    const currentTime = Date.now();

    // --- Global Check ---
    if (this.globalLimitEnabled && this.globalLimit !== null && this.globalPeriodMs !== null) {
        const globalTimeElapsed = currentTime - this.globalLastRequestTime;
        if (globalTimeElapsed > this.globalPeriodMs) {
            this.globalRequestCount = 0; // Reset count if period passed
        }

        if (this.globalRequestCount >= this.globalLimit) {
            // Global limit reached. Check cooldown.
            if (globalTimeElapsed < this.globalCooldownMs) {
                const remainingCooldown = (this.globalCooldownMs - globalTimeElapsed) / 1000;
                logger.warn( // Use logger constant
                    `Global rate limit hit (${this.globalRequestCount}/${this.globalLimit}). Cooldown: ${remainingCooldown.toFixed(2)}s`
                );
                return [false, 'global'];
            }
            // Cooldown passed, allow potential reset below
        }
    }

    // --- User Check ---
    // Only perform user check if user limits are enabled
    if (this.userLimitEnabled) {
        let userData = this.userData.get(userId);
        if (!userData) {
            userData = { lastRequestTime: 0, requestCount: 0 };
            this.userData.set(userId, userData);
        }

        const userTimeElapsed = currentTime - userData.lastRequestTime;
        if (userTimeElapsed > this.userPeriodMs) {
            userData.requestCount = 0; // Reset count if period passed
        }

        if (userData.requestCount >= this.userLimit) {
            // User limit reached. Check cooldown.
            if (userTimeElapsed < this.userCooldownMs) {
                const remainingCooldown = (this.userCooldownMs - userTimeElapsed) / 1000;
                logger.info( // Use logger constant
                    `User ${userId} rate limit hit (${userData.requestCount}/${this.userLimit}). Cooldown: ${remainingCooldown.toFixed(2)}s`
                );
                return [false, 'user'];
            } else {
                // Cooldown passed, reset user count for the current request
                userData.requestCount = 1;
                userData.lastRequestTime = currentTime;
            }
        } else {
            // User limit OK, increment user count
            userData.requestCount += 1;
            userData.lastRequestTime = currentTime;
        }
    } else {
        // If user limits are disabled, but global limits might be enabled,
        // we still need to proceed to update global state.
        // If both were disabled, we would have returned earlier.
    }


    // --- Update Global State ---
    // Only update global state if global limits are enabled
    if (this.globalLimitEnabled && this.globalLimit !== null && this.globalPeriodMs !== null) {
        const globalTimeElapsed = currentTime - this.globalLastRequestTime; // Calculate here, within the scope
        // Reset global count if period passed OR if limit was hit but cooldown expired
        if (globalTimeElapsed > this.globalPeriodMs || (this.globalRequestCount >= this.globalLimit && globalTimeElapsed >= this.globalCooldownMs)) {
            this.globalRequestCount = 1; // Reset to 1 for the current request
        } else {
            // Otherwise, just increment global count
            this.globalRequestCount += 1;
        }
        this.globalLastRequestTime = currentTime;
    }

    return [true, 'ok'];
  }

  /**
   * Calculates the remaining cooldown time in seconds for a user based on general rate limits.
   * Considers both the user-specific cooldown and the (placeholder) global cooldown.
   * @param {string} userId - The Discord user ID.
   * @returns {number} The maximum remaining cooldown time in seconds.
   */
  /**
   * Get max remaining cooldown (global or user) in seconds.
   * @param userId The Discord user ID.
   * @returns Remaining cooldown in seconds.
   */
  getCooldownRemaining(userId: string): number {
    // If neither limit type is enabled, there's no cooldown
    if (!this.userLimitEnabled && !this.globalLimitEnabled) {
      return 0.0;
    }

    const currentTime = Date.now();
    let globalRemainingMs = 0.0;
    let userRemainingMs = 0.0;

    // --- Check global cooldown ---
    if (this.globalLimitEnabled && this.globalLimit !== null) { // Check enabled and not null
        const globalTimeSinceLast = currentTime - this.globalLastRequestTime;
        if (this.globalRequestCount >= this.globalLimit) {
            const remaining = this.globalCooldownMs - globalTimeSinceLast;
            globalRemainingMs = Math.max(0.0, remaining);
        }
    }

    // --- Check user cooldown ---
    const userData = this.userData.get(userId);
    if (userData) {
      const userTimeSinceLast = currentTime - userData.lastRequestTime;
      if (userData.requestCount >= this.userLimit) {
        const remaining = this.userCooldownMs - userTimeSinceLast;
        userRemainingMs = Math.max(0.0, remaining);
      }
    }

    // Return the longer of the two cooldowns in seconds
    return Math.max(globalRemainingMs, userRemainingMs) / 1000;
  }

   /**
   * Checks if a user request is allowed based on reasoning-specific rate limits (user and global).
   * If allowed, updates the reasoning user and global request counts and timestamps.
   * Skips the check if reasoning limits are not configured or invalid.
   * Note: Global reasoning limits are not currently configurable via the TS config type.
   * @param {string} userId - The Discord user ID making the reasoning request.
   * @returns {[boolean, 'ok' | 'global' | 'user']} A tuple indicating if the request is allowed and the reason.
   */
   /**
   * Checks reasoning model rate limits.
   * @param userId The Discord user ID.
   * @returns [allow_request: boolean, reason: 'ok' | 'global' | 'user']
   */
  checkReasoningRateLimit(userId: string): [boolean, 'ok' | 'global' | 'user'] {
    // Check if reasoning limits are meaningfully configured
    // If not, allow the request as rate limiting isn't active for reasoning
    if (this.reasoningUserLimit <= 0 || this.reasoningUserPeriodMs <= 0) {
        // logger.warn("Reasoning rate limit check skipped: Invalid limits detected (<= 0)."); // Already logged in constructor
        return [true, "ok"]; // Allow if not configured or invalid
    }

    const currentTime = Date.now();
    const globalLimitEnabled = this.reasoningGlobalLimit !== null && this.reasoningGlobalPeriodMs !== null && this.reasoningGlobalLimit > 0;

    // --- Reasoning Global Check ---
    if (globalLimitEnabled) {
        const globalTimeElapsed = currentTime - this.reasoningGlobalLastRequestTime;
        if (globalTimeElapsed > this.reasoningGlobalPeriodMs!) {
            this.reasoningGlobalRequestCount = 0; // Reset count
        }

        if (this.reasoningGlobalRequestCount >= this.reasoningGlobalLimit!) {
            if (globalTimeElapsed < this.reasoningGlobalCooldownMs) {
                const remainingCooldown = (this.reasoningGlobalCooldownMs - globalTimeElapsed) / 1000;
                logger.warn(`Reasoning Global rate limit hit (${this.reasoningGlobalRequestCount}/${this.reasoningGlobalLimit}). Cooldown: ${remainingCooldown.toFixed(2)}s`); // Use logger constant
                return [false, "global"];
            }
            // Cooldown passed, allow potential reset below
        }
    }

    // --- Reasoning User Check ---
    let userData = this.reasoningUserData.get(userId);
    if (!userData) {
        userData = { lastRequestTime: 0, requestCount: 0 };
        this.reasoningUserData.set(userId, userData);
    }

    const userTimeElapsed = currentTime - userData.lastRequestTime;
    if (userTimeElapsed > this.reasoningUserPeriodMs) {
        userData.requestCount = 0; // Reset count
    }

    if (userData.requestCount >= this.reasoningUserLimit) {
        if (userTimeElapsed < this.reasoningUserCooldownMs) {
            const remainingCooldown = (this.reasoningUserCooldownMs - userTimeElapsed) / 1000;
            logger.info(`Reasoning User ${userId} rate limit hit (${userData.requestCount}/${this.reasoningUserLimit}). Cooldown: ${remainingCooldown.toFixed(2)}s`); // Use logger constant
            return [false, "user"];
        } else {
            userData.requestCount = 1;
            userData.lastRequestTime = currentTime;
        }
    } else {
        userData.requestCount += 1;
        userData.lastRequestTime = currentTime;
    }

    // --- Update Reasoning Global State ---
    if (globalLimitEnabled) {
        const globalTimeElapsed = currentTime - this.reasoningGlobalLastRequestTime; // Recalculate for accuracy
        if (globalTimeElapsed > this.reasoningGlobalPeriodMs! || (this.reasoningGlobalRequestCount >= this.reasoningGlobalLimit! && globalTimeElapsed >= this.reasoningGlobalCooldownMs)) {
            this.reasoningGlobalRequestCount = 1;
        } else {
            this.reasoningGlobalRequestCount += 1;
        }
        this.reasoningGlobalLastRequestTime = currentTime;
    }

    return [true, 'ok'];
  }

  /**
   * Calculates the remaining cooldown time in seconds for a user based on reasoning rate limits.
   * Considers both the user-specific reasoning cooldown and the (placeholder) global reasoning cooldown.
   * @param {string} userId - The Discord user ID.
   * @returns {number} The maximum remaining cooldown time in seconds for reasoning requests.
   */
  /**
   * Get max remaining cooldown (global or user) in seconds for the reasoning model.
   * @param userId The Discord user ID.
   * @returns Remaining cooldown in seconds.
   */
  getReasoningCooldownRemaining(userId: string): number {
     // Check if reasoning limits are meaningfully configured
    if (this.reasoningUserLimit <= 0 || this.reasoningUserPeriodMs <= 0) {
        return 0.0; // No cooldown if not configured
    }

    const currentTime = Date.now();
    let globalRemainingMs = 0.0;
    let userRemainingMs = 0.0;
    const globalLimitEnabled = this.reasoningGlobalLimit !== null && this.reasoningGlobalPeriodMs !== null && this.reasoningGlobalLimit > 0;


    // --- Check reasoning global cooldown ---
    if (globalLimitEnabled) {
        const globalTimeSinceLast = currentTime - this.reasoningGlobalLastRequestTime;
        if (this.reasoningGlobalRequestCount >= this.reasoningGlobalLimit!) {
            const remaining = this.reasoningGlobalCooldownMs - globalTimeSinceLast;
            globalRemainingMs = Math.max(0.0, remaining);
        }
    }

    // --- Check reasoning user cooldown ---
    const userData = this.reasoningUserData.get(userId);
    if (userData) {
        const userTimeSinceLast = currentTime - userData.lastRequestTime;
        if (userData.requestCount >= this.reasoningUserLimit) {
            const remaining = this.reasoningUserCooldownMs - userTimeSinceLast;
            userRemainingMs = Math.max(0.0, remaining);
        }
    }

    // Return the longer of the two cooldowns in seconds
    return Math.max(globalRemainingMs, userRemainingMs) / 1000;
  }
}