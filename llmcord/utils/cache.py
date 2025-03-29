import asyncio
import logging
from typing import Dict, Any, Optional, Generic, TypeVar
import time

log = logging.getLogger(__name__)

T = TypeVar('T')

class LRUCache(Generic[T]):
    """A thread-safe LRU cache implementation."""
    
    def __init__(self, max_size: int = 100):
        self.max_size = max_size
        self.cache: Dict[Any, T] = {}
        self.access_times: Dict[Any, float] = {}
        self.lock = asyncio.Lock()
    
    async def get(self, key: Any) -> Optional[T]:
        """Get an item from the cache."""
        async with self.lock:
            if key in self.cache:
                self.access_times[key] = time.time()
                return self.cache[key]
            return None
    
    async def set(self, key: Any, value: T) -> None:
        """Set an item in the cache."""
        async with self.lock:
            self.cache[key] = value
            self.access_times[key] = time.time()
            await self._cleanup_if_needed()
    
    async def delete(self, key: Any) -> None:
        """Delete an item from the cache."""
        async with self.lock:
            if key in self.cache:
                del self.cache[key]
                del self.access_times[key]
    
    async def _cleanup_if_needed(self) -> None:
        """Clean up the cache if it exceeds the maximum size."""
        if len(self.cache) <= self.max_size:
            return
        
        # Get the least recently used items
        items_to_remove = sorted(
            self.access_times.items(), 
            key=lambda x: x[1]
        )[:len(self.cache) - self.max_size]
        
        for key, _ in items_to_remove:
            del self.cache[key]
            del self.access_times[key]
        
        log.debug(f"Cleaned up {len(items_to_remove)} items from cache")