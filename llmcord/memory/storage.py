import logging
import aiosqlite
from typing import Optional

log = logging.getLogger(__name__)

class MemoryStorage:
    """Database storage for user memory."""
    
    def __init__(self, config):
        """Initialize memory storage with configuration."""
        self.config = config
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
    
    async def save_user_memory(self, user_id: int, memory_text: str) -> bool:
        """Save or update memory for a specific user."""
        if not self.enabled or not self.db_conn:
            return False
            
        try:
            # Truncate if necessary
            final_memory_text = memory_text[:self.max_length]
            if len(memory_text) > self.max_length:
                log.warning(f"Memory for user {user_id} truncated to {self.max_length} characters")
                
            await self.db_conn.execute(
                """
                INSERT INTO user_memory (user_id, memory_text, last_updated)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    memory_text = excluded.memory_text,
                    last_updated = CURRENT_TIMESTAMP
                """,
                (user_id, final_memory_text)
            )
            await self.db_conn.commit()
            log.debug(f"Saved memory for user {user_id}. Length: {len(final_memory_text)}")
            return True
        except Exception as e:
            log.error(f"Error saving memory for user {user_id}: {e}")
            return False