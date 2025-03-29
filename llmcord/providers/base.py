from abc import ABC, abstractmethod
from typing import List, Dict, Any, AsyncGenerator, Tuple, Optional

class LLMProvider(ABC):
    """Base class for LLM providers."""
    
    @abstractmethod
    async def setup(self, config: Dict[str, Any]) -> bool:
        """Setup the provider with given configuration."""
        pass
    
    @abstractmethod
    async def generate_stream(
        self, 
        messages: List[Dict[str, Any]], 
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> AsyncGenerator[Tuple[str, Optional[str]], None]:
        """
        Generate a streaming response from the LLM.
        
        Returns an async generator yielding tuples of:
        - chunk_text: The text chunk from the LLM
        - finish_reason: The finish reason, if applicable for this chunk
        """
        pass
    
    @property
    @abstractmethod
    def supports_vision(self) -> bool:
        """Whether this provider supports vision models."""
        pass
    
    @property
    @abstractmethod
    def supports_usernames(self) -> bool:
        """Whether this provider supports usernames in messages."""
        pass