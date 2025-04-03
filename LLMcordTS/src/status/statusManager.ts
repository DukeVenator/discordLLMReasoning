/**
 * @fileoverview Manages the Discord bot's presence (status).
 * Handles regular status cycling and temporary status updates.
 */
// LLMcordTS/src/status/statusManager.ts
import { Client, ActivityType, PresenceStatusData } from 'discord.js';
import { LLMCordBot } from '../core/LLMCordBot';
// import { Config } from '../types/config'; // Removed unused import
import { logger } from '@/core/logger'; // Import shared logger instance

const DEFAULT_STATUSES = ['Serving LLMs', 'Thinking...', '/help for commands'];
const DEFAULT_INTERVAL_SECONDS = 300; // 5 minutes
const FALLBACK_STATUS = 'Online'; // Fallback if all else fails

/**
 * Manages the bot's Discord presence (status, activity).
 * Handles cycling through a list of predefined statuses and displaying temporary statuses.
 */
export class StatusManager {
    // private bot: LLMCordBot; // Removed unused property
    private client: Client;
    private statuses: string[];
    private intervalSeconds: number;
    private currentIndex: number = 0;
    private intervalTimer: NodeJS.Timeout | null = null;
    private temporaryStatusTimer: NodeJS.Timeout | null = null;
    private originalStatus: string | null = null; // Stores the cycling status text before a temporary one is set
    private isTemporaryStatusActive: boolean = false;

    /**
     * Creates an instance of StatusManager.
     * @param {LLMCordBot} bot - The main bot instance.
     */
    constructor(bot: LLMCordBot) {
        // this.bot = bot; // Removed assignment to unused property
        this.client = bot.client;
        const config = bot.config;

        // Ensure statuses is always an array, even if config is malformed
        this.statuses = Array.isArray(config.discord?.statuses) && config.discord.statuses.length > 0
            ? config.discord.statuses.filter(s => typeof s === 'string' && s.trim() !== '') // Filter out empty/invalid strings
            : DEFAULT_STATUSES;
        // If filtering resulted in an empty array, revert to defaults
        if (this.statuses.length === 0) {
            logger.warn('Configured statuses were empty or invalid, using default statuses.');
            this.statuses = DEFAULT_STATUSES;
        }

        this.intervalSeconds = config.discord?.statusUpdateIntervalSeconds ?? DEFAULT_INTERVAL_SECONDS;

        logger.info(`StatusManager initialized. Using ${this.statuses.length} statuses. Update interval: ${this.intervalSeconds} seconds.`);
    }

    /**
     * Gets the current status string, handling potential index issues.
     * @private
     */
    private getCurrentStatusString(): string {
        return this.statuses[this.currentIndex] ?? this.statuses[0] ?? FALLBACK_STATUS;
    }

    /**
     * Starts the regular status cycling.
     * Sets the initial status and begins the interval timer.
     */
    start(): void {
        if (!this.client.user) {
            logger.error('StatusManager cannot start: Client user is not available.');
            return;
        }
        if (this.intervalTimer) {
            logger.warn('StatusManager start called but already running. Restarting cycle.');
            this.stop();
        }
        if (this.isTemporaryStatusActive) {
            logger.warn('StatusManager start called while temporary status is active. Temporary status will be cleared.');
            this.clearTemporaryStatus(false);
        }

        logger.info('Starting status cycling...');
        this.currentIndex = 0;
        const initialStatus = this.getCurrentStatusString();
        this.setActivity(initialStatus, ActivityType.Playing, 'online'); // Explicitly set initial status to online

        if (this.statuses.length > 1 && this.intervalSeconds > 0) {
            this.intervalTimer = setInterval(() => {
                this.cycleStatus();
            }, this.intervalSeconds * 1000);
            logger.info(`Status cycling interval set for every ${this.intervalSeconds} seconds.`);
        } else if (this.statuses.length <= 1) {
            logger.info('Only one status defined, no cycling needed.');
        } else {
            logger.warn('Status update interval is zero or negative, cycling disabled.');
        }
    }

    /**
     * Stops the regular status cycling.
     * Clears the interval timer.
     */
    stop(): void {
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
            logger.info('Status cycling stopped.');
        }
        if (this.temporaryStatusTimer) {
            clearTimeout(this.temporaryStatusTimer);
            this.temporaryStatusTimer = null;
            logger.info('Cleared active temporary status timer during stop.');
        }
        this.isTemporaryStatusActive = false;
    }

    /**
     * Cycles to the next status in the list and updates the bot's presence.
     * @private
     */
    private cycleStatus(): void {
        if (this.statuses.length === 0) return; // Safety check
        this.currentIndex = (this.currentIndex + 1) % this.statuses.length;
        const nextStatus = this.getCurrentStatusString(); // Use getter for safety
        logger.debug(`Cycling status to: "${nextStatus}"`);
        this.setActivity(nextStatus);
    }

    /**
     * Sets the bot's activity status.
     * @param {string} text - The text to display.
     * @param {ActivityType} [type=ActivityType.Playing] - The type of activity.
     * @param {PresenceStatusData} [status='online'] - The presence status (online, idle, dnd).
     * @private
     */
    private async setActivity(
        text: string,
        type: ActivityType = ActivityType.Playing,
        status: PresenceStatusData = 'online'
    ): Promise<void> {
        if (!this.client.user) {
            logger.warn('Cannot set activity: client.user is null.');
            return;
        }
        // Ensure text is never undefined/null before sending to Discord API
        const activityText = text ?? FALLBACK_STATUS;
        try {
            logger.info(`[StatusManager] Attempting to set presence: text='${activityText}', type=${type}, status='${status}'`); // Log the intended status
            await this.client.user.setPresence({
                activities: [{ name: activityText, type }],
                status: status,
            });
            logger.debug(`Activity set to "${activityText}" (Type: ${type}, Status: ${status})`);
        } catch (error) {
            logger.error('Failed to set bot activity:', error);
        }
    }

    /**
     * Sets a temporary status for the bot, pausing the regular cycle.
     * @param {string} text - The temporary status text.
     * @param {number} durationSeconds - How long the temporary status should last.
     * @param {ActivityType} [type=ActivityType.Playing] - The type of activity for the temporary status.
     * @param {PresenceStatusData} [status='idle'] - The presence status during the temporary period.
     */
    setTemporaryStatus(
        text: string,
        durationSeconds: number,
        type: ActivityType = ActivityType.Playing,
        status: PresenceStatusData = 'idle'
    ): void {
        if (!this.client.user) {
            logger.warn('Cannot set temporary status: client.user is null.');
            return;
        }
        logger.info(`Setting temporary status "${text}" for ${durationSeconds} seconds.`);

        if (this.temporaryStatusTimer) {
            clearTimeout(this.temporaryStatusTimer);
            this.temporaryStatusTimer = null;
        }

        if (!this.isTemporaryStatusActive) {
            // Store the *actual* current status string being displayed before override
            this.originalStatus = this.getCurrentStatusString();
            if (this.intervalTimer) {
                clearInterval(this.intervalTimer);
                this.intervalTimer = null;
                logger.debug('Paused status cycling for temporary status.');
            }
        }

        this.isTemporaryStatusActive = true;
        this.setActivity(text, type, status); // Set temporary one

        this.temporaryStatusTimer = setTimeout(() => {
            logger.info(`Temporary status "${text}" expired. Restoring regular status.`);
            this.clearTemporaryStatus();
        }, durationSeconds * 1000);
    }

    /**
     * Clears the current temporary status and resumes regular cycling.
     * @param {boolean} [restartCycle=true] - Whether to restart the cycling interval after clearing.
     */
    clearTemporaryStatus(restartCycle: boolean = true): void {
        if (!this.isTemporaryStatusActive) {
            return;
        }

        logger.info('Clearing temporary status...');
        if (this.temporaryStatusTimer) {
            clearTimeout(this.temporaryStatusTimer);
            this.temporaryStatusTimer = null;
        }

        this.isTemporaryStatusActive = false;

        // Restore the original status, falling back if necessary
        const statusToRestore = this.originalStatus ?? this.getCurrentStatusString();
        this.setActivity(statusToRestore); // Restore visually
        this.originalStatus = null; // Clear stored original

        // Restart cycling if needed
        if (restartCycle && this.statuses.length > 1 && this.intervalSeconds > 0) {
            if (this.intervalTimer) {
                clearInterval(this.intervalTimer); // Ensure no duplicates
            }
            this.intervalTimer = setInterval(() => {
                this.cycleStatus();
            }, this.intervalSeconds * 1000);
            logger.info('Resumed status cycling.');
        } else if (restartCycle) {
            logger.info('Regular status restored, but cycling conditions not met.');
        }
    }
}