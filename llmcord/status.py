import discord
import random
import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_STATUSES = [
    "Thinking about code...",
    "Processing user requests...",
    "Learning new things...",
    "Compiling thoughts...",
    "Debugging the universe...",
    "Optimizing responses...",
    "Generating insights...",
    "Listening intently...",
    "Helping users...",
    "Exploring possibilities...",
]

DEFAULT_UPDATE_INTERVAL = 300  # 5 minutes in seconds

class StatusManager:
    def __init__(self, client: discord.Client, config: dict):
        self.client = client
        self.config = config
        self.statuses = self.config.get("statuses", DEFAULT_STATUSES)
        self.update_interval = self.config.get("status_update_interval", DEFAULT_UPDATE_INTERVAL)
        self._task = None
        self._lock = asyncio.Lock()
        self._temporary_status_active = False
        self._temporary_status_clear_task: Optional[asyncio.Task] = None

    def _get_random_status(self) -> discord.CustomActivity:
        """Selects a random status message."""
        if not self.statuses:
            logger.warning("No statuses defined in config or defaults. Using fallback.")
            return discord.CustomActivity(name="Ready to help!")

        status_text = random.choice(self.statuses)
        # Ensure status is within Discord's 128 character limit
        return discord.CustomActivity(name=status_text[:128])

    async def _set_random_status_now(self):
        """Sets a random status immediately."""
        try:
            new_activity = self._get_random_status()
            await self.client.change_presence(activity=new_activity)
            logger.info(f"Updated status to random: {new_activity.name}")
        except Exception as e:
            logger.error(f"Error setting random status: {e}", exc_info=True)

    async def _update_status_periodically(self):
        """Background task to update the bot's status periodically, respecting temporary statuses."""
        await self.client.wait_until_ready()
        while not self.client.is_closed():
            try:
                # Wait for the interval first
                await asyncio.sleep(self.update_interval)

                # Check if a temporary status is active before setting a random one
                async with self._lock:
                    if not self._temporary_status_active:
                        await self._set_random_status_now() # Use helper

            except asyncio.CancelledError:
                logger.info("Status update task cancelled.")
                break # Exit loop if task is cancelled
            except Exception as e:
                # Log errors but continue the loop
                logger.error(f"Error in status update loop: {e}", exc_info=True)
                # Optional: Add a shorter sleep after an error to prevent rapid error loops
                await asyncio.sleep(60) # Wait 1 minute before retrying after an error

    async def _clear_temporary_status_after_delay(self, delay: float):
        """Coroutine to clear the temporary status after a delay."""
        await asyncio.sleep(delay)
        await self.clear_temporary_status()

    async def set_temporary_status(self, status_text: str, duration: Optional[float] = None):
        """Sets a temporary status, overriding random cycling.

        Args:
            status_text: The text to display.
            duration: If provided (in seconds), the status reverts automatically after this time.
                      If None, the status persists until clear_temporary_status() is called.
        """
        async with self._lock:
            # Cancel any existing timed clear task
            if self._temporary_status_clear_task and not self._temporary_status_clear_task.done():
                self._temporary_status_clear_task.cancel()
                self._temporary_status_clear_task = None

            self._temporary_status_active = True
            try:
                activity = discord.CustomActivity(name=status_text[:128])
                await self.client.change_presence(activity=activity)
                logger.info(f"Set temporary status: '{activity.name}' (Duration: {duration}s)")

                # Schedule automatic clearing if duration is provided
                if duration is not None and duration > 0:
                    self._temporary_status_clear_task = self.client.loop.create_task(
                        self._clear_temporary_status_after_delay(duration)
                    )
            except Exception as e:
                logger.error(f"Error setting temporary status: {e}", exc_info=True)
                # Attempt to clear the flag if setting failed
                self._temporary_status_active = False

    async def clear_temporary_status(self):
        """Clears any active temporary status and resumes random cycling immediately."""
        async with self._lock:
            if not self._temporary_status_active:
                return # Nothing to clear

            logger.info("Clearing temporary status and resuming random updates.")
            # Cancel any pending clear task
            if self._temporary_status_clear_task and not self._temporary_status_clear_task.done():
                self._temporary_status_clear_task.cancel()
                self._temporary_status_clear_task = None

            self._temporary_status_active = False
            # Immediately set a random status to avoid waiting for the next cycle
            await self._set_random_status_now()

    def start(self):
        """Starts the background task for updating status and sets an initial status."""
        if self._task is None or self._task.done():
            logger.info(f"Starting status update task. Interval: {self.update_interval}s")
            # Set initial status immediately
            # We run this concurrently so it doesn't block the start method if change_presence takes time
            self.client.loop.create_task(self._set_random_status_now())
            # Start the periodic update loop
            self._task = self.client.loop.create_task(self._update_status_periodically())
        else:
            logger.warning("Status update task is already running.")

    def stop(self):
        """Stops the background task."""
        if self._task and not self._task.done():
            self._task.cancel()
            logger.info("Status update task stopped.")
        self._task = None