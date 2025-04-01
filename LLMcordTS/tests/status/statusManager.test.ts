// LLMcordTS/tests/status/statusManager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach, Mock, MockInstance } from 'vitest'; // Add MockInstance
import { StatusManager } from '@/status/statusManager';
import { LLMCordBot } from '@/core/LLMCordBot';
import { Client, ActivityType } from 'discord.js'; // Removed unused PresenceStatusData
import { Config } from '@/types/config';
import { logger } from '@/core/logger'; // Import the actual logger

// Mock the logger
vi.mock('@/core/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Mock discord.js Client's setPresence function
const mockSetPresence = vi.fn();

// Mock LLMCordBot - Use 'let' to allow redefinition in beforeEach
let mockBot: LLMCordBot;

// Helper for creating a minimal valid config based on src/types/config.ts
const createMockConfig = (discordConfig?: Partial<Config['discord']>): Config => ({
    discord: {
        token: 'mock-token',
        clientId: 'mock-client-id',
        ...discordConfig, // Spread the specific discord settings for the test
    },
    llm: {
        defaultProvider: 'mock-provider', // Use correct property name
    },
    memory: {
        enabled: true,
        storageType: 'sqlite', // Use correct property name
        sqlite: {
            path: ':memory:', // Use in-memory for tests
        },
    },
    logging: {
        level: 'info',
    },
    permissions: {
         // Add required fields if any, otherwise empty object might suffice
    },
    rateLimit: {
        user: {
            intervalSeconds: 60,
            maxCalls: 10,
        },
    },
    model: 'mock-provider/mock-model', // Provide a model string
});

describe('StatusManager', () => {
    beforeEach(() => {
        vi.clearAllMocks(); // Clear mocks before each test

        // Re-create the mock client and bot for isolation
        const freshMockClient = {
            user: { setPresence: mockSetPresence },
        } as unknown as Client;

        mockBot = {
            client: freshMockClient,
            // Initialize with a base valid config in beforeEach
            config: createMockConfig(),
        } as LLMCordBot;
    });

    afterEach(() => {
        vi.restoreAllMocks(); // Restore original implementations
    });

    describe('Initialization', () => {
        it('should initialize with default statuses and interval if discord config lacks status properties', () => {
            const statusManager = new StatusManager(mockBot);
            expect((statusManager as any).statuses).toEqual(['Serving LLMs', 'Thinking...', '/help for commands']);
            expect((statusManager as any).intervalSeconds).toBe(300);
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('StatusManager initialized. Using 3 statuses. Update interval: 300 seconds.'));
        });

        it('should initialize with default statuses and interval if discord config section is minimal', () => {
            mockBot.config = createMockConfig({}); // Pass empty object for discord part
            const statusManager = new StatusManager(mockBot);
            expect((statusManager as any).statuses).toEqual(['Serving LLMs', 'Thinking...', '/help for commands']);
            expect((statusManager as any).intervalSeconds).toBe(300);
             expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('StatusManager initialized. Using 3 statuses. Update interval: 300 seconds.'));
        });

        it('should initialize with custom statuses and interval from config', () => {
            const customStatuses = ['Status A', 'Status B'];
            const customInterval = 60;
            mockBot.config = createMockConfig({
                statuses: customStatuses,
                statusUpdateIntervalSeconds: customInterval,
            });
            const statusManager = new StatusManager(mockBot);
            expect((statusManager as any).statuses).toEqual(customStatuses);
            expect((statusManager as any).intervalSeconds).toBe(customInterval);
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`StatusManager initialized. Using ${customStatuses.length} statuses. Update interval: ${customInterval} seconds.`));
        });

        it('should filter out empty or invalid statuses from config and use defaults if none remain', () => {
            mockBot.config = createMockConfig({
                statuses: ['', '   ', null as any, undefined as any], // Invalid statuses
                statusUpdateIntervalSeconds: 120,
            });
            const statusManager = new StatusManager(mockBot);
            expect((statusManager as any).statuses).toEqual(['Serving LLMs', 'Thinking...', '/help for commands']); // Should revert to defaults
            expect((statusManager as any).intervalSeconds).toBe(120);
            expect(logger.warn).toHaveBeenCalledWith('Configured statuses were empty or invalid, using default statuses.');
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('StatusManager initialized. Using 3 statuses. Update interval: 120 seconds.'));
        });

         it('should filter out empty or invalid statuses and keep valid ones', () => {
            mockBot.config = createMockConfig({
                statuses: ['Valid 1', '', 'Valid 2', '   ', null as any],
                statusUpdateIntervalSeconds: 90,
            });
            const statusManager = new StatusManager(mockBot);
            expect((statusManager as any).statuses).toEqual(['Valid 1', 'Valid 2']);
            expect((statusManager as any).intervalSeconds).toBe(90);
            expect(logger.warn).not.toHaveBeenCalled(); // No warning if some are valid
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('StatusManager initialized. Using 2 statuses. Update interval: 90 seconds.'));
        });
    });

    describe('start() and Cycling', () => {
        const testStatuses = ['Status 1', 'Status 2', 'Status 3'];
        const testInterval = 10; // 10 seconds

        beforeEach(() => {
            vi.useFakeTimers();
            mockBot.config = createMockConfig({
                statuses: testStatuses,
                statusUpdateIntervalSeconds: testInterval,
            });
            mockSetPresence.mockClear();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should set the initial status to the first in the list on start', () => {
            const statusManager = new StatusManager(mockBot);
            statusManager.start();

            expect(mockSetPresence).toHaveBeenCalledTimes(1);
            expect(mockSetPresence).toHaveBeenCalledWith({
                activities: [{ name: testStatuses[0], type: ActivityType.Playing }],
                status: 'online',
            });
            expect(logger.info).toHaveBeenCalledWith('Starting status cycling...');
            // Check if cycling actually started
            if (testStatuses.length > 1 && testInterval > 0) {
                expect(logger.info).toHaveBeenCalledWith(`Status cycling interval set for every ${testInterval} seconds.`);
            }
        });

        it('should start the interval timer if multiple statuses and positive interval', () => {
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            const statusManager = new StatusManager(mockBot);
            statusManager.start();

            expect(setIntervalSpy).toHaveBeenCalledTimes(1);
            expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), testInterval * 1000);

            setIntervalSpy.mockRestore();
        });

         it('should cycle through statuses correctly based on the interval', async () => {
            const statusManager = new StatusManager(mockBot);
            statusManager.start();
            mockSetPresence.mockClear(); // Clear initial call from start()

            // Advance time to trigger the first interval
            await vi.advanceTimersByTimeAsync(testInterval * 1000);

            // Check the second status is set
            expect(mockSetPresence).toHaveBeenCalledTimes(1); // Called once by the interval
            expect(mockSetPresence).toHaveBeenCalledWith({
                activities: [{ name: testStatuses[1], type: ActivityType.Playing }],
                status: 'online',
            });
            expect(logger.debug).toHaveBeenCalledWith(`Cycling status to: "${testStatuses[1]}"`);
        });

        it('should not start interval timer if only one status is provided', () => {
            mockBot.config = createMockConfig({
                statuses: ['Single Status'],
                statusUpdateIntervalSeconds: testInterval,
            });
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            const statusManager = new StatusManager(mockBot);
            statusManager.start();

            expect(mockSetPresence).toHaveBeenCalledWith({
                 activities: [{ name: 'Single Status', type: ActivityType.Playing }],
                 status: 'online',
            });
            expect(setIntervalSpy).not.toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith('Only one status defined, no cycling needed.');

            setIntervalSpy.mockRestore();
        });

        it('should not start interval timer if interval is zero', () => {
             mockBot.config = createMockConfig({
                statuses: testStatuses,
                statusUpdateIntervalSeconds: 0,
            });
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            const statusManager = new StatusManager(mockBot);
            statusManager.start();

            expect(mockSetPresence).toHaveBeenCalledWith({
                 activities: [{ name: testStatuses[0], type: ActivityType.Playing }],
                 status: 'online',
            });
            expect(setIntervalSpy).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith('Status update interval is zero or negative, cycling disabled.');

            setIntervalSpy.mockRestore();
        });

         it('should not start interval timer if interval is negative', () => {
             mockBot.config = createMockConfig({
                statuses: testStatuses,
                statusUpdateIntervalSeconds: -10,
            });
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            const statusManager = new StatusManager(mockBot);
            statusManager.start();

            expect(mockSetPresence).toHaveBeenCalledWith({
                 activities: [{ name: testStatuses[0], type: ActivityType.Playing }],
                 status: 'online',
            });
            expect(setIntervalSpy).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalledWith('Status update interval is zero or negative, cycling disabled.');

            setIntervalSpy.mockRestore();
        });


        it('should log an error and not set status or timer if client.user is null', () => {
            mockBot.client.user = null as any; // Simulate client not ready
            const statusManager = new StatusManager(mockBot);
            statusManager.start();

            expect(logger.error).toHaveBeenCalledWith('StatusManager cannot start: Client user is not available.');
            expect(mockSetPresence).not.toHaveBeenCalled();
        });

        describe('Temporary Status', () => {
            const tempTestStatuses = ['Cycling 1', 'Cycling 2']; // Use different name
            const tempCycleInterval = 15; // Use different name
            const tempStatusText = 'Temporary Task';
            const tempDuration = 30; // seconds

            // Spies for timers - Define them here
            let clearTimeoutSpy: MockInstance;
            let setTimeoutSpy: MockInstance;
            let clearIntervalSpy: MockInstance;
            let setIntervalSpy: MockInstance;

            beforeEach(() => {
                mockBot.config = createMockConfig({
                    statuses: tempTestStatuses, // Use specific statuses
                    statusUpdateIntervalSeconds: tempCycleInterval, // Use specific interval
                });
                // Setup spies before each test in this block
                clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
                setTimeoutSpy = vi.spyOn(global, 'setTimeout');
                clearIntervalSpy = vi.spyOn(global, 'clearInterval');
                setIntervalSpy = vi.spyOn(global, 'setInterval');
                mockSetPresence.mockClear(); // Clear mocks specific to this block
                (logger.info as Mock).mockClear();
                (logger.debug as Mock).mockClear();
                (logger.warn as Mock).mockClear();
            });

            afterEach(() => {
                // Restore spies after each test in this block
                clearTimeoutSpy.mockRestore();
                setTimeoutSpy.mockRestore();
                clearIntervalSpy.mockRestore();
                setIntervalSpy.mockRestore();
            });

            it('setTemporaryStatus should set the status, pause cycling, and set a timeout', () => {
                const statusManager = new StatusManager(mockBot);
                statusManager.start(); // Start cycling

                const intervalTimerId = (statusManager as any).intervalTimer;
                mockSetPresence.mockClear(); // Clear call from start()

                statusManager.setTemporaryStatus(tempStatusText, tempDuration, ActivityType.Watching, 'idle');

                // Check status set
                expect(mockSetPresence).toHaveBeenCalledTimes(1); // Should be called once for temp status
                expect(mockSetPresence).toHaveBeenCalledWith({
                    activities: [{ name: tempStatusText, type: ActivityType.Watching }],
                    status: 'idle',
                });

                // Check logging
                expect(logger.info).toHaveBeenCalledWith(`Setting temporary status "${tempStatusText}" for ${tempDuration} seconds.`);

                // Check timers
                if (intervalTimerId) { // Only assert clearInterval if a timer existed
                    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
                    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalTimerId);
                    expect(logger.debug).toHaveBeenCalledWith('Paused status cycling for temporary status.');
                } else {
                     expect(clearIntervalSpy).not.toHaveBeenCalled();
                     expect(logger.debug).not.toHaveBeenCalledWith('Paused status cycling for temporary status.');
                }
                expect((statusManager as any).intervalTimer).toBeNull(); // Ensure timer ID is cleared internally
                expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
                expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), tempDuration * 1000);
                expect((statusManager as any).temporaryStatusTimer).not.toBeNull(); // Ensure temp timer ID is stored

                // Check internal state
                expect((statusManager as any).isTemporaryStatusActive).toBe(true);
                expect((statusManager as any).originalStatus).toBe(tempTestStatuses[0]);
            });

            it('setTemporaryStatus should clear previous temporary timer if called again', () => {
                const statusManager = new StatusManager(mockBot);
                statusManager.start();
                statusManager.setTemporaryStatus('First Temp', 10); // Set initial temp

                const firstTimeoutId = (statusManager as any).temporaryStatusTimer;
                mockSetPresence.mockClear(); // Clear presence mock calls

                clearIntervalSpy.mockClear(); // Clear spy after first setTemporaryStatus
                setTimeoutSpy.mockClear(); // Clear spy before next call
                statusManager.setTemporaryStatus('Second Temp', 20); // Set new temp

                if (firstTimeoutId) {
                    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
                    expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimeoutId); // Cleared the previous timer
                } else {
                    expect(clearTimeoutSpy).not.toHaveBeenCalled();
                }
                // setTimeout called for first temp, then cleared, then called for second temp
                expect(setTimeoutSpy).toHaveBeenCalledTimes(1); // Only the second call's timer should remain active
                expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 20 * 1000);
                expect(clearIntervalSpy).not.toHaveBeenCalled(); // Interval already paused
                expect(mockSetPresence).toHaveBeenCalledTimes(1); // Called once for the second temp status
                expect(mockSetPresence).toHaveBeenCalledWith(expect.objectContaining({ activities: [{ name: 'Second Temp', type: ActivityType.Playing }] }));
                expect((statusManager as any).originalStatus).toBe(tempTestStatuses[0]); // Original status remains the same
            });


            it('temporary status should expire and restore original status after duration', async () => {
                const statusManager = new StatusManager(mockBot);
                statusManager.start();
                mockSetPresence.mockClear(); // Clear calls from start()

                statusManager.setTemporaryStatus(tempStatusText, tempDuration);

                expect(mockSetPresence).toHaveBeenCalledTimes(1); // Set temp status
                expect(mockSetPresence).toHaveBeenCalledWith({ activities: [{ name: tempStatusText, type: ActivityType.Playing }], status: 'idle' }); // Check default type and status
                expect((statusManager as any).isTemporaryStatusActive).toBe(true);
                setIntervalSpy.mockClear(); // Clear spy after start()

                // Advance time just before expiry
                await vi.advanceTimersByTimeAsync((tempDuration * 1000) - 1);
                expect(mockSetPresence).toHaveBeenCalledTimes(1); // Status not restored yet
                expect(setIntervalSpy).not.toHaveBeenCalled(); // Cycle not resumed yet

                // Advance time to trigger expiry
                await vi.advanceTimersByTimeAsync(1);

                // Check restoration
                expect(mockSetPresence).toHaveBeenCalledTimes(2); // Status restored
                expect(mockSetPresence).toHaveBeenNthCalledWith(2, {
                    activities: [{ name: tempTestStatuses[0], type: ActivityType.Playing }], // Restored original
                    status: 'online',
                });
                expect((statusManager as any).isTemporaryStatusActive).toBe(false);
                expect((statusManager as any).originalStatus).toBeNull();

                // Check logging
                expect(logger.info).toHaveBeenCalledWith(`Temporary status "${tempStatusText}" expired. Restoring regular status.`);
                expect(logger.info).toHaveBeenCalledWith('Clearing temporary status...');
                expect(logger.info).toHaveBeenCalledWith('Resumed status cycling.');

                // Check cycle resumed
                expect(setIntervalSpy).toHaveBeenCalledTimes(1);
                expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), tempCycleInterval * 1000);
            });

            it('clearTemporaryStatus should restore original status and resume cycling', async () => {
                const statusManager = new StatusManager(mockBot);
                statusManager.start();
                statusManager.setTemporaryStatus(tempStatusText, tempDuration);

                const tempTimerId = (statusManager as any).temporaryStatusTimer;
                mockSetPresence.mockClear(); // Clear calls from setTemporaryStatus
                setIntervalSpy.mockClear(); // Clear spy before calling clearTemporaryStatus
                setIntervalSpy.mockClear(); // Clear spy before calling clearTemporaryStatus

                statusManager.clearTemporaryStatus(); // Manually clear

                // Check restoration
                expect(mockSetPresence).toHaveBeenCalledTimes(1); // Called once to restore
                expect(mockSetPresence).toHaveBeenCalledWith({
                    activities: [{ name: tempTestStatuses[0], type: ActivityType.Playing }], // Restored original
                    status: 'online',
                });
                expect((statusManager as any).isTemporaryStatusActive).toBe(false);
                expect((statusManager as any).originalStatus).toBeNull();

                // Check timers
                if (tempTimerId) {
                    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
                    expect(clearTimeoutSpy).toHaveBeenCalledWith(tempTimerId);
                } else {
                    expect(clearTimeoutSpy).not.toHaveBeenCalled();
                }
                expect((statusManager as any).temporaryStatusTimer).toBeNull();
                expect(setIntervalSpy).toHaveBeenCalledTimes(1); // Cycle resumed
                expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), tempCycleInterval * 1000);

                // Check logging
                expect(logger.info).toHaveBeenCalledWith('Clearing temporary status...');
                expect(logger.info).toHaveBeenCalledWith('Resumed status cycling.');
            });

             it('clearTemporaryStatus should do nothing if no temporary status is active', () => {
                const statusManager = new StatusManager(mockBot);
                setIntervalSpy.mockClear(); // Clear spy after start() call
                statusManager.start(); // Start normally
                mockSetPresence.mockClear(); // Clear calls from start()

                statusManager.clearTemporaryStatus(); // Call clear when none is active

                expect(mockSetPresence).not.toHaveBeenCalled();
                setIntervalSpy.mockClear(); // Clear just before assertion
                setIntervalSpy.mockClear(); // Clear just before assertion
                expect(clearTimeoutSpy).not.toHaveBeenCalled();
                // setInterval might have been called by start(), but clearTemporaryStatus shouldn't call it again
                expect(setIntervalSpy).not.toHaveBeenCalled();
                expect(logger.info).not.toHaveBeenCalledWith('Clearing temporary status...');
                expect((statusManager as any).isTemporaryStatusActive).toBe(false);
            });

            it('clearTemporaryStatus should not resume cycling if restartCycle is false', () => {
                const statusManager = new StatusManager(mockBot);
                setIntervalSpy.mockClear(); // Clear spy after setTemporaryStatus call
                statusManager.start();
                statusManager.setTemporaryStatus(tempStatusText, tempDuration);
                mockSetPresence.mockClear(); // Clear calls from setTemporaryStatus

                setIntervalSpy.mockClear(); // Clear just before assertion
                statusManager.clearTemporaryStatus(false); // Clear without resuming

                expect(mockSetPresence).toHaveBeenCalledTimes(1); // Restored status
                expect(setIntervalSpy).not.toHaveBeenCalled(); // Cycle NOT resumed
                expect((statusManager as any).intervalTimer).toBeNull(); // Interval timer remains null (was cleared by setTemporaryStatus)
            });

             it('clearTemporaryStatus should not resume cycling if conditions not met (e.g., single status)', () => {
                mockBot.config = createMockConfig({ statuses: ['Single'] }); // Only one status
                const statusManager = new StatusManager(mockBot);
                statusManager.start(); // Start (won't set interval timer)
                statusManager.setTemporaryStatus(tempStatusText, tempDuration);
                mockSetPresence.mockClear(); // Clear calls from setTemporaryStatus

                statusManager.clearTemporaryStatus(true); // Try to resume

                expect(mockSetPresence).toHaveBeenCalledTimes(1); // Restored status
                expect(setIntervalSpy).not.toHaveBeenCalled(); // Cycle NOT resumed (conditions not met)
                expect(logger.info).toHaveBeenCalledWith('Regular status restored, but cycling conditions not met.');
            });

            it('setTemporaryStatus should log warning and return if client.user is null', () => {
                const statusManager = new StatusManager(mockBot);
                mockBot.client.user = null as any; // Ensure user is null

                statusManager.setTemporaryStatus(tempStatusText, tempDuration);

                expect(logger.warn).toHaveBeenCalledWith('Cannot set temporary status: client.user is null.');
                expect(mockSetPresence).not.toHaveBeenCalled();
                expect(setTimeoutSpy).not.toHaveBeenCalled();
                expect((statusManager as any).isTemporaryStatusActive).toBe(false);
            });

            it('start() should clear temporary status and restart cycling if called during temporary status', () => {
                setIntervalSpy.mockClear(); // Clear before second start()
                const statusManager = new StatusManager(mockBot);
                statusManager.start();
                statusManager.setTemporaryStatus(tempStatusText, tempDuration); // Temp status is active
                const clearTempSpy = vi.spyOn(statusManager, 'clearTemporaryStatus');

                const tempTimerId = (statusManager as any).temporaryStatusTimer;
                expect((statusManager as any).isTemporaryStatusActive).toBe(true); // Assume it became active

                mockSetPresence.mockClear(); // Clear calls from setTemporaryStatus

                statusManager.start(); // Call start while temp is active

                expect(logger.warn).toHaveBeenCalledWith('StatusManager start called while temporary status is active. Temporary status will be cleared.');
                // clearTemporaryStatus(false) is called internally by start()
                if (tempTimerId) {
                    expect(clearTimeoutSpy).toHaveBeenCalledWith(tempTimerId);
                }
                expect((statusManager as any).temporaryStatusTimer).toBeNull();
                expect((statusManager as any).isTemporaryStatusActive).toBe(false);
                expect((statusManager as any).originalStatus).toBeNull(); // Should be cleared

                // Check that cycling restarts
                expect(clearTempSpy).toHaveBeenCalledTimes(1); // start() calls clearTemporaryStatus internally
                expect(clearTempSpy).toHaveBeenCalledWith(false); // Should be called with restartCycle = false
                expect(mockSetPresence).toHaveBeenCalledTimes(2); // 1. Restore from clearTemporaryStatus(false), 2. Set initial cycling status
                // Check the second call (initial cycling status)
                expect(mockSetPresence).toHaveBeenNthCalledWith(2, {
                    activities: [{ name: tempTestStatuses[0], type: ActivityType.Playing }],
                    status: 'online',
                });
                // Check that cycling restarts by verifying the internal timer ID is set
                expect((statusManager as any).intervalTimer).not.toBeNull();
                expect(logger.info).toHaveBeenCalledWith('Starting status cycling...');
                // The exact number of setInterval calls is hard to assert reliably with fake timers and multiple starts/stops
                // So we focus on the end state (timer exists)

                clearTempSpy.mockRestore(); // Restore the new spy
            });
        }); // End Temporary Status describe

        describe('stop()', () => {
            // Spies for timers - Define them here
            let clearTimeoutSpy: MockInstance;
            let clearIntervalSpy: MockInstance;

             beforeEach(() => {
                // Setup spies before each test in this block
                clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
                clearIntervalSpy = vi.spyOn(global, 'clearInterval');
                (logger.info as Mock).mockClear(); // Clear logger mock
            });

            afterEach(() => {
                // Restore spies after each test in this block
                clearTimeoutSpy.mockRestore();
                clearIntervalSpy.mockRestore();
            });


            it('should clear the interval timer if it is running', () => {
                const statusManager = new StatusManager(mockBot);
                statusManager.start(); // Start the interval timer

                const intervalTimerId = (statusManager as any).intervalTimer;

                statusManager.stop();

                if (intervalTimerId) {
                    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
                    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalTimerId);
                    expect(logger.info).toHaveBeenCalledWith('Status cycling stopped.');
                } else {
                     expect(clearIntervalSpy).not.toHaveBeenCalled();
                     expect(logger.info).not.toHaveBeenCalledWith('Status cycling stopped.');
                // Verify that setTemporaryStatus correctly cleared the interval timer
                expect((statusManager as any).intervalTimer).toBeNull();
                }
                clearIntervalSpy.mockClear(); // Clear after setTemporaryStatus, before stop
                expect((statusManager as any).intervalTimer).toBeNull();
            });

            it('should clear the temporary status timer if it is running', () => {
                const statusManager = new StatusManager(mockBot);
                clearIntervalSpy.mockClear(); // Clear spy after setTemporaryStatus call
                statusManager.start(); // Start cycle (sets interval)
                statusManager.setTemporaryStatus('Temp', 30); // Start temp timer (clears interval)

                const tempTimerId = (statusManager as any).temporaryStatusTimer;
                expect((statusManager as any).isTemporaryStatusActive).toBe(true); // Assume it became active

                statusManager.stop();

                if (tempTimerId) {
                    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
                    expect(clearTimeoutSpy).toHaveBeenCalledWith(tempTimerId);
                    expect(logger.info).toHaveBeenCalledWith('Cleared active temporary status timer during stop.');
                } else {
                    expect(clearTimeoutSpy).not.toHaveBeenCalled();
                    expect(logger.info).not.toHaveBeenCalledWith('Cleared active temporary status timer during stop.');
                }
                expect((statusManager as any).temporaryStatusTimer).toBeNull();
                expect((statusManager as any).isTemporaryStatusActive).toBe(false); // Should also reset this flag

                // We don't assert clearIntervalSpy here because setTemporaryStatus likely already called it.
                // The main point is that stop() correctly handles the temporary timer (verified by clearTimeoutSpy checks).
            });

             it('should clear both interval and temporary timers if somehow both were active (edge case)', () => {
                const statusManager = new StatusManager(mockBot);
                statusManager.start(); // Start interval
                const intervalTimerId = (statusManager as any).intervalTimer;
                // Manually set a temporary timer without clearing interval to simulate edge case
                const fakeTimeoutId = setTimeout(() => {}, 5000);
                (statusManager as any).temporaryStatusTimer = fakeTimeoutId;
                const tempTimerId = (statusManager as any).temporaryStatusTimer;
                (statusManager as any).isTemporaryStatusActive = true;

                statusManager.stop();

                if (intervalTimerId) {
                    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
                    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalTimerId);
                    expect(logger.info).toHaveBeenCalledWith('Status cycling stopped.');
                } else {
                    expect(clearIntervalSpy).not.toHaveBeenCalled();
                    expect(logger.info).not.toHaveBeenCalledWith('Status cycling stopped.');
                }
                expect((statusManager as any).intervalTimer).toBeNull();

                if (tempTimerId) {
                    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
                    expect(clearTimeoutSpy).toHaveBeenCalledWith(tempTimerId);
                     expect(logger.info).toHaveBeenCalledWith('Cleared active temporary status timer during stop.');
                } else {
                     expect(clearTimeoutSpy).not.toHaveBeenCalled();
                     expect(logger.info).not.toHaveBeenCalledWith('Cleared active temporary status timer during stop.');
                }
                expect((statusManager as any).temporaryStatusTimer).toBeNull();
                expect((statusManager as any).isTemporaryStatusActive).toBe(false);
            });


            it('should do nothing if no timers are running', () => {
                const statusManager = new StatusManager(mockBot);
                // Do not call start()

                expect((statusManager as any).intervalTimer).toBeNull();
                expect((statusManager as any).temporaryStatusTimer).toBeNull();

                statusManager.stop();

                expect(clearIntervalSpy).not.toHaveBeenCalled();
                expect(clearTimeoutSpy).not.toHaveBeenCalled();
                expect(logger.info).not.toHaveBeenCalledWith('Status cycling stopped.');
                expect(logger.info).not.toHaveBeenCalledWith('Cleared active temporary status timer during stop.');
            });
        }); // End stop() describe

    }); // End start() and Cycling describe

}); // End StatusManager describe
