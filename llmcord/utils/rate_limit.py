from dataclasses import dataclass, field
from typing import Dict, Tuple # Add Tuple
import time
import asyncio
import logging

from llmcord.config import Config  # Import Config

log = logging.getLogger(__name__)

@dataclass
class RateLimitData:
    """Store rate limit data for a user."""
    last_request_time: float = 0.0
    request_count: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

class RateLimiter:
    """Handle global and per-user rate limiting based on config."""
    
    def __init__(self):
        """Initialize rate limiter using config."""
        config = Config()
        self.enabled = config.get("rate_limits.enabled", True)
        
        # User limits
        self.user_limit = config.get("rate_limits.user_limit", 5)
        self.user_period = config.get("rate_limits.user_period", 60)
        self.user_cooldown_seconds = 0
        if self.enabled and self.user_limit > 0 and self.user_period > 0:
            self.user_cooldown_seconds = self.user_period / self.user_limit
            
        # Global limits
        self.global_limit = config.get("rate_limits.global_limit", 100)
        self.global_period = config.get("rate_limits.global_period", 60)
        self.global_cooldown_seconds = 0
        if self.enabled and self.global_limit > 0 and self.global_period > 0:
             self.global_cooldown_seconds = self.global_period / self.global_limit

        # --- Reasoning Model Limits (Separate) ---
        self.reasoning_user_limit = config.get("rate_limits.reasoning_user_limit", 2)
        self.reasoning_user_period = config.get("rate_limits.reasoning_user_period", 300)
        self.reasoning_user_cooldown_seconds = 0
        if self.enabled and self.reasoning_user_limit > 0 and self.reasoning_user_period > 0:
            self.reasoning_user_cooldown_seconds = self.reasoning_user_period / self.reasoning_user_limit

        self.reasoning_global_limit = config.get("rate_limits.reasoning_global_limit") # Optional
        self.reasoning_global_period = config.get("rate_limits.reasoning_global_period") # Optional
        self.reasoning_global_cooldown_seconds = 0
        if self.enabled and self.reasoning_global_limit and self.reasoning_global_period and self.reasoning_global_limit > 0 and self.reasoning_global_period > 0:
             self.reasoning_global_cooldown_seconds = self.reasoning_global_period / self.reasoning_global_limit
        elif self.enabled and (self.reasoning_global_limit or self.reasoning_global_period):
            log.warning("Reasoning global limit requires both reasoning_global_limit (>0) and reasoning_global_period (>0) to be set.")
            self.reasoning_global_limit = None # Disable if partially configured

        if not self.enabled:
            log.info("Rate limiting is disabled in config.")
        else:
            log.info(f"User rate limit: {self.user_limit}/{self.user_period}s (cooldown: {self.user_cooldown_seconds:.2f}s)")
            log.info(f"Global rate limit: {self.global_limit}/{self.global_period}s (cooldown: {self.global_cooldown_seconds:.2f}s)")
            log.info(f"Reasoning User rate limit: {self.reasoning_user_limit}/{self.reasoning_user_period}s (cooldown: {self.reasoning_user_cooldown_seconds:.2f}s)")
            if self.reasoning_global_limit:
                 log.info(f"Reasoning Global rate limit: {self.reasoning_global_limit}/{self.reasoning_global_period}s (cooldown: {self.reasoning_global_cooldown_seconds:.2f}s)")
            # Validate limits after reading them
            if self.user_limit <= 0 or self.user_period <= 0 or self.global_limit <= 0 or self.global_period <= 0:
                 log.warning("Invalid rate limit config (limits/periods must be > 0). Disabling rate limiting.")
                 self.enabled = False
            
        self.user_data: Dict[int, RateLimitData] = {}
        # Global state
        self.global_request_count: int = 0
        self.global_last_request_time: float = 0.0
        self.global_lock = asyncio.Lock()
        # Reasoning state
        self.reasoning_user_data: Dict[int, RateLimitData] = {}
        self.reasoning_global_request_count: int = 0
        self.reasoning_global_last_request_time: float = 0.0
        self.reasoning_global_lock = asyncio.Lock()
    
    async def check_rate_limit(self, user_id: int) -> Tuple[bool, str]:
        """
        Checks global and user rate limits.
        Returns (allow_request: bool, reason: str) where reason is 'ok', 'global', or 'user'.
        """
        if not self.enabled:
            return True, "ok" # Rate limiting disabled globally

        current_time = time.time()

        # Acquire global lock first
        await self.global_lock.acquire()
        try:
            # --- Global Check ---
            global_time_elapsed = current_time - self.global_last_request_time
            if global_time_elapsed > self.global_period:
                self.global_request_count = 0 # Reset count if period passed since last request

            if self.global_request_count >= self.global_limit:
                # Global limit reached. Check if cooldown allows a new request.
                if global_time_elapsed < self.global_cooldown_seconds:
                    remaining_cooldown = self.global_cooldown_seconds - global_time_elapsed
                    log.warning(f"Global rate limit hit ({self.global_request_count}/{self.global_limit}). Cooldown: {remaining_cooldown:.2f}s")
                    return False, "global" # Release lock via finally
                # else: Cooldown passed, allow potential reset below, proceed to user check

            # --- User Check (while holding global lock) ---
            if user_id not in self.user_data:
                # Initialize user data if first time seen
                self.user_data[user_id] = RateLimitData()
            user_data = self.user_data[user_id]

            # Acquire user lock (must be acquired *after* global lock)
            await user_data.lock.acquire()
            try:
                user_time_elapsed = current_time - user_data.last_request_time
                if user_time_elapsed > self.user_period:
                    user_data.request_count = 0 # Reset count if period passed

                if user_data.request_count >= self.user_limit:
                    # User limit reached. Check if cooldown allows a new request.
                    if user_time_elapsed < self.user_cooldown_seconds:
                        remaining_cooldown = self.user_cooldown_seconds - user_time_elapsed
                        log.info(f"User {user_id} rate limit hit ({user_data.request_count}/{self.user_limit}). Cooldown: {remaining_cooldown:.2f}s")
                        return False, "user" # Release locks via finally
                    else:
                        # Cooldown passed, reset user count and proceed
                        user_data.request_count = 1 # Reset to 1 for the current request
                        user_data.last_request_time = current_time
                else:
                    # User limit OK, increment user count
                    user_data.request_count += 1
                    user_data.last_request_time = current_time

                # --- If we reach here, both global and user checks passed (or cooldowns allowed reset) ---
                # Finalize global increment/reset based on the earlier check
                if global_time_elapsed > self.global_period or (self.global_request_count >= self.global_limit and global_time_elapsed >= self.global_cooldown_seconds):
                     # Reset global count if period passed OR if limit was hit but cooldown expired
                     self.global_request_count = 1 # Reset to 1 for the current request
                else:
                     # Otherwise, just increment global count
                     self.global_request_count += 1
                # Update global timestamp regardless
                self.global_last_request_time = current_time

                return True, "ok" # Release locks via finally

            finally:
                # Ensure user lock is always released
                user_data.lock.release()

        finally:
            # Ensure global lock is always released
            self.global_lock.release()

    def get_cooldown_remaining(self, user_id: int) -> float:
        """Get max remaining cooldown (global or user) in seconds."""
        if not self.enabled:
            return 0.0

        current_time = time.time()
        global_remaining = 0.0
        user_remaining = 0.0

        # --- Check global cooldown ---
        # Reading without lock is slightly risky for count but ok for informational cooldown

    async def check_reasoning_rate_limit(self, user_id: int) -> Tuple[bool, str]:
        """
        Checks global and user rate limits specifically for the reasoning model.
        Returns (allow_request: bool, reason: str) where reason is 'ok', 'global', or 'user'.
        """
        if not self.enabled:
            return True, "ok" # Rate limiting disabled globally

        # Check if reasoning limits are meaningfully configured
        if self.reasoning_user_limit <= 0 or self.reasoning_user_period <= 0:
             log.warning("Reasoning rate limit check skipped: reasoning_user_limit/period not configured correctly.")
             return True, "ok" # Allow if not configured

        current_time = time.time()

        # Acquire reasoning global lock first (if global limit is enabled)
        global_limit_enabled = self.reasoning_global_limit is not None and self.reasoning_global_limit > 0
        if global_limit_enabled:
            await self.reasoning_global_lock.acquire()
        
        try:
            # --- Reasoning Global Check ---
            if global_limit_enabled:
                global_time_elapsed = current_time - self.reasoning_global_last_request_time
                if global_time_elapsed > self.reasoning_global_period:
                    self.reasoning_global_request_count = 0 # Reset count

                if self.reasoning_global_request_count >= self.reasoning_global_limit:
                    if global_time_elapsed < self.reasoning_global_cooldown_seconds:
                        remaining_cooldown = self.reasoning_global_cooldown_seconds - global_time_elapsed
                        log.warning(f"Reasoning Global rate limit hit ({self.reasoning_global_request_count}/{self.reasoning_global_limit}). Cooldown: {remaining_cooldown:.2f}s")
                        return False, "global"
                    # else: Cooldown passed, allow potential reset below

            # --- Reasoning User Check (while holding global lock if applicable) ---
            if user_id not in self.reasoning_user_data:
                self.reasoning_user_data[user_id] = RateLimitData()
            user_data = self.reasoning_user_data[user_id]

            await user_data.lock.acquire()
            try:
                user_time_elapsed = current_time - user_data.last_request_time
                if user_time_elapsed > self.reasoning_user_period:
                    user_data.request_count = 0 # Reset count

                if user_data.request_count >= self.reasoning_user_limit:
                    if user_time_elapsed < self.reasoning_user_cooldown_seconds:
                        remaining_cooldown = self.reasoning_user_cooldown_seconds - user_time_elapsed
                        log.info(f"Reasoning User {user_id} rate limit hit ({user_data.request_count}/{self.reasoning_user_limit}). Cooldown: {remaining_cooldown:.2f}s")
                        return False, "user"
                    else:
                        user_data.request_count = 1
                        user_data.last_request_time = current_time
                else:
                    user_data.request_count += 1
                    user_data.last_request_time = current_time

                # --- If we reach here, both checks passed --- 
                # Finalize reasoning global increment/reset if enabled
                if global_limit_enabled:
                    if global_time_elapsed > self.reasoning_global_period or (self.reasoning_global_request_count >= self.reasoning_global_limit and global_time_elapsed >= self.reasoning_global_cooldown_seconds):
                         self.reasoning_global_request_count = 1
                    else:
                         self.reasoning_global_request_count += 1
                    self.reasoning_global_last_request_time = current_time

                return True, "ok"

            finally:
                user_data.lock.release()

        finally:
            if global_limit_enabled:
                self.reasoning_global_lock.release()

    def get_reasoning_cooldown_remaining(self, user_id: int) -> float:
        """Get max remaining cooldown (global or user) in seconds for the reasoning model."""
        if not self.enabled:
            return 0.0
        
        # Check if reasoning limits are meaningfully configured
        if self.reasoning_user_limit <= 0 or self.reasoning_user_period <= 0:
             return 0.0 # No cooldown if not configured

        current_time = time.time()
        global_remaining = 0.0
        user_remaining = 0.0
        global_limit_enabled = self.reasoning_global_limit is not None and self.reasoning_global_limit > 0

        # --- Check reasoning global cooldown ---
        if global_limit_enabled:
            global_count = self.reasoning_global_request_count
            global_last_time = self.reasoning_global_last_request_time
            global_time_since_last = current_time - global_last_time
            if global_count >= self.reasoning_global_limit:
                 remaining = self.reasoning_global_cooldown_seconds - global_time_since_last
                 global_remaining = max(0.0, remaining)

        # --- Check reasoning user cooldown ---
        if user_id in self.reasoning_user_data:
            user_data = self.reasoning_user_data[user_id]
            user_count = user_data.request_count
            user_last_time = user_data.last_request_time
            user_time_since_last = current_time - user_last_time
            if user_count >= self.reasoning_user_limit:
                 remaining = self.reasoning_user_cooldown_seconds - user_time_since_last
                 user_remaining = max(0.0, remaining)

        return max(global_remaining, user_remaining)
        global_count = self.global_request_count
        global_last_time = self.global_last_request_time
        global_time_since_last = current_time - global_last_time
        
        # Only consider global cooldown if the limit is actually reached
        if global_count >= self.global_limit:
             remaining = self.global_cooldown_seconds - global_time_since_last
             global_remaining = max(0.0, remaining)

        # --- Check user cooldown ---
        if user_id in self.user_data:
            user_data = self.user_data[user_id]
            # Reading without lock is slightly risky but ok for informational cooldown
            user_count = user_data.request_count
            user_last_time = user_data.last_request_time
            user_time_since_last = current_time - user_last_time
            
            # Only consider user cooldown if the limit is actually reached
            if user_count >= self.user_limit:
                 remaining = self.user_cooldown_seconds - user_time_since_last
                 user_remaining = max(0.0, remaining)

        # Return the longer of the two cooldowns
        return max(global_remaining, user_remaining)