import logging
import aiosqlite
from typing import Optional

log = logging.getLogger(__name__)

class MemoryStorage:
    """Database storage for user memory, with auto-condensation."""

    def __init__(self, config, llm_provider): # Added llm_provider
        """Initialize memory storage with configuration and LLM provider."""
        self.config = config
        self.llm_provider = llm_provider # Store llm_provider
        self.memory_config = config.get("memory", {})
        self.enabled = self.memory_config.get("enabled", False)
        self.db_path = self.memory_config.get("database_path", "llmcord_memory.db")
        self.max_length = self.memory_config.get("max_memory_length", 1500)
        self.db_conn = None

    async def init_db(self):
        """Initialize the SQLite database connection."""
        if not self.enabled:
            return False
            
        try:
            self.db_conn = await aiosqlite.connect(self.db_path)
            await self.db_conn.execute("""
                CREATE TABLE IF NOT EXISTS user_memory (
                    user_id INTEGER PRIMARY KEY,
                    memory_text TEXT,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await self.db_conn.commit()
            log.info(f"Memory database initialized at {self.db_path}")
            return True
        except Exception as e:
            log.error(f"Failed to initialize memory database: {e}")
            self.db_conn = None
            return False
    
    async def close_db(self):
        """Close the database connection."""
        if self.db_conn:
            try:
                await self.db_conn.close()
                log.info("Memory database connection closed")
                self.db_conn = None
            except Exception as e:
                log.error(f"Error closing memory database: {e}")
    
    async def get_user_memory(self, user_id: int) -> Optional[str]:
        """Retrieve memory for a specific user."""
        if not self.enabled or not self.db_conn:
            return None
            
        try:
            async with self.db_conn.execute(
                "SELECT memory_text FROM user_memory WHERE user_id = ?", 
                (user_id,)
            ) as cursor:
                row = await cursor.fetchone()
                return row[0] if row and row[0] else None
        except Exception as e:
            log.error(f"Error getting memory for user {user_id}: {e}")
            return None

    async def _condense_memory(self, user_id: int, text_to_condense: str) -> Optional[str]:
        """Internal helper to call LLM for condensing memory text."""
        if not self.llm_provider or not hasattr(self.llm_provider, 'generate_stream'):
            log.error(f"LLM provider not available for memory condensation for user {user_id}.")
            return None # Cannot condense without provider

        try:
            log.info(f"Attempting memory condensation for user {user_id}. Original length: {len(text_to_condense)}")
            # Construct the prompt using config values
            target_buffer = self.memory_config.get("condensation_target_buffer", 100)
            target_len = max(0, self.max_length - target_buffer)
            
            default_condensation_prompt = (
                "Please summarize and condense the following notes, removing redundancy "
                "and keeping the most important points. Aim for a maximum length of "
                "around {target_len} characters, but do not exceed {max_len} characters.\\n\\n"
                "NOTES:\\n```\\n{current_memory}\\n```\\n\\nCONDENSED NOTES:"
            )
            prompt_template = self.memory_config.get("condensation_prompt", default_condensation_prompt)
            
            prompt = prompt_template.format(
                target_len=target_len,
                max_len=self.max_length,
                current_memory=text_to_condense
            )

            messages_for_llm = [{"role": "user", "content": prompt}]
            condensed_memory = ""
            stream_generator = self.llm_provider.generate_stream(messages_for_llm)
            async for chunk_text, _ in stream_generator:
                if chunk_text:
                    condensed_memory += chunk_text
            
            condensed_memory = condensed_memory.strip()
            new_len = len(condensed_memory)

            if not condensed_memory:
                log.warning(f"Condensation for user {user_id} resulted in empty text. Keeping original.")
                return None # Indicate failure or no change needed
            
            if new_len >= len(text_to_condense):
                log.warning(f"Condensation for user {user_id} did not shorten text ({new_len} >= {len(text_to_condense)}). Keeping original.")
                return None # Indicate no improvement

            # Ensure it doesn't exceed max_length (shouldn't happen if prompt is good, but safety check)
            if new_len > self.max_length:
                 log.warning(f"Condensed memory for user {user_id} exceeded max length ({new_len} > {self.max_length}). Truncating.")
                 condensed_memory = condensed_memory[:self.max_length]

            log.info(f"Successfully condensed memory for user {user_id}. New length: {len(condensed_memory)}")
            return condensed_memory

        except Exception as e:
            log.error(f"Error during LLM memory condensation call for user {user_id}: {e}", exc_info=True)
            return None # Indicate failure
    
    async def save_user_memory(self, user_id: int, memory_text: str) -> bool:
        """
        Save or update memory for a specific user.
        Automatically attempts condensation if memory_text exceeds max_length.
        """
        if not self.enabled or not self.db_conn:
            log.debug(f"Attempted to save memory for {user_id}, but memory is disabled or DB not connected.")
            return False
            
        try:
            final_text_to_save = memory_text.strip() # Start with the provided text, stripped
            original_length = len(final_text_to_save)

            # Check if condensation is needed
            if original_length > self.max_length:
                log.warning(f"Memory for user {user_id} exceeds max length ({original_length}/{self.max_length}). Attempting condensation.")
                condensed_text = await self._condense_memory(user_id, final_text_to_save)
                
                if condensed_text is not None:
                    # Condensation successful and potentially shortened the text
                    final_text_to_save = condensed_text 
                else:
                    # Condensation failed or didn't shorten, truncate as last resort
                    log.warning(f"Condensation failed or insufficient for user {user_id}. Truncating memory to {self.max_length} chars.")
                    final_text_to_save = final_text_to_save[:self.max_length]

            # Proceed with saving the final text (original, condensed, or truncated)
            final_length = len(final_text_to_save)
            await self.db_conn.execute(
                """
                INSERT INTO user_memory (user_id, memory_text, last_updated)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    memory_text = excluded.memory_text,
                    last_updated = CURRENT_TIMESTAMP
                """,
                (user_id, final_text_to_save)
            )
            await self.db_conn.commit()
            log.debug(f"Saved memory for user {user_id}. Final length: {final_length} (Original: {original_length})")
            return True # Return True on successful save
            
        except Exception as e:
            log.error(f"Error saving memory for user {user_id}: {e}", exc_info=True)
            return False # Return False on error

    async def append_memory(self, user_id: int, text_to_append: str) -> bool:
        """Appends text to a user's memory, handling auto-condensation."""
        if not self.enabled or not self.db_conn:
            return False
        if not text_to_append:
            return True # Nothing to append

        try:
            current_memory = await self.get_user_memory(user_id)
            
            # Use configured prefix if appending to existing, non-empty memory
            # Note: We might remove memory_suggestion_append_prefix from config later
            prefix = ""
            if current_memory and current_memory.strip():
                 prefix = self.memory_config.get("memory_suggestion_append_prefix", "\n") # Default to newline if prefix removed
            
            new_memory_text = (current_memory or "") + prefix + text_to_append.strip()
            
            # Call save_user_memory, which handles length check and condensation
            return await self.save_user_memory(user_id, new_memory_text)
            
        except Exception as e:
            log.error(f"Error appending memory for user {user_id}: {e}", exc_info=True)
            return False

    async def edit_memory(self, user_id: int, text_to_find: str, text_to_replace_with: str) -> bool:
        """Replaces the first occurrence of text in a user's memory, handling auto-condensation."""
        if not self.enabled or not self.db_conn:
            return False
        if not text_to_find:
             log.warning(f"Attempted memory edit for user {user_id} with empty search text.")
             return False # Cannot search for empty string

        try:
            current_memory = await self.get_user_memory(user_id)
            if not current_memory:
                log.info(f"Attempted memory edit for user {user_id}, but no memory exists.")
                return False # No memory to edit

            if text_to_find not in current_memory:
                 log.info(f"Attempted memory edit for user {user_id}, but text '{text_to_find}' not found.")
                 return False # Text not found

            # Perform replacement (replace first occurrence only for now)
            # Consider adding count parameter or different method for all occurrences if needed later
            modified_memory = current_memory.replace(text_to_find, text_to_replace_with, 1)

            # Call save_user_memory, which handles length check and condensation
            return await self.save_user_memory(user_id, modified_memory)

        except Exception as e:
            log.error(f"Error editing memory for user {user_id}: {e}", exc_info=True)
            return False