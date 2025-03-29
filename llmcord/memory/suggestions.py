import logging
from typing import Optional, Dict, Any, Tuple

log = logging.getLogger(__name__)

class MemorySuggestionProcessor:
    """Process memory suggestions from LLM responses."""
    
    def __init__(self, memory_store, config):
        """Initialize with memory storage and configuration."""
        self.memory_store = memory_store
        self.config = config
        self.memory_config = config.get("memory", {})
        
        self.enabled = (
            self.memory_config.get("enabled", False) and 
            self.memory_config.get("llm_suggests_memory", False)
        )
        
        self.start_marker = self.memory_config.get("memory_suggestion_start_marker", "[MEM_UPDATE]")
        self.end_marker = self.memory_config.get("memory_suggestion_end_marker", "[/MEM_UPDATE]")
        self.suggestion_mode = self.memory_config.get("memory_suggestion_mode", "append")
        self.append_prefix = self.memory_config.get("memory_suggestion_append_prefix", "\n- ")
    
    def extract_suggestion(self, response_text: str) -> Optional[str]:
        """Extract memory suggestion from LLM response."""
        if not self.enabled or not response_text:
            return None
            
        try:
            start_idx = response_text.rfind(self.start_marker)
            if start_idx != -1:
                end_idx = response_text.find(self.end_marker, start_idx)
                if end_idx != -1:
                    suggestion = response_text[
                        start_idx + len(self.start_marker):end_idx
                    ].strip()
                    return suggestion if suggestion else None
            return None
        except Exception as e:
            log.error(f"Error extracting memory suggestion: {e}")
            return None
    
    def get_cleaned_response(self, response_text: str) -> str:
        """Remove suggestion markers from the response text."""
        if not self.enabled:
            return response_text
            
        try:
            start_idx = response_text.rfind(self.start_marker)
            if start_idx != -1:
                end_idx = response_text.find(self.end_marker, start_idx)
                if end_idx != -1:
                    content_before = response_text[:start_idx].rstrip()
                    content_after = response_text[end_idx + len(self.end_marker):].lstrip()
                    return (content_before + content_after).strip()
            return response_text
        except Exception as e:
            log.error(f"Error cleaning response text: {e}")
            return response_text
    
    async def process_and_save_suggestion(self, user_id: int, suggestion: str) -> bool:
        """Process and save a memory suggestion for a user."""
        if not self.enabled or not suggestion:
            return False
            
        try:
            current_memory = await self.memory_store.get_user_memory(user_id)
            new_memory_text = ""
            
            if self.suggestion_mode == "replace":
                new_memory_text = suggestion
            else:  # append mode
                prefix = self.append_prefix if current_memory and current_memory.strip() else ""
                new_memory_text = (current_memory or "") + prefix + suggestion
            
            # Save the memory
            success = await self.memory_store.save_user_memory(user_id, new_memory_text.strip())
            if success:
                log.info(
                    f"Saved suggestion for user {user_id}. "
                    f"Mode: '{self.suggestion_mode}'. Length: {len(new_memory_text)}"
                )
            return success
            
        except Exception as e:
            log.error(f"Error processing memory suggestion for user {user_id}: {e}")
            return False