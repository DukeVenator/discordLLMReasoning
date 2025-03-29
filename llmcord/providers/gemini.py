import logging
from typing import List, Dict, Any, AsyncGenerator, Tuple, Optional
import asyncio
import json

from google import genai
from google.genai import types

from ..providers.base import LLMProvider

log = logging.getLogger(__name__)

class GeminiProvider(LLMProvider):
    """Provider for Google Gemini API."""
    
    def __init__(self):
        self.model_name = None
        self.client = None
        self.api_key = None
        
    async def setup(self, config: Dict[str, Any]) -> bool:
        """Setup the provider with Gemini configuration."""
        try:
            provider_name, model_name = config["model"].split("/", 1)
            if provider_name != "google-gemini":
                log.error(f"Expected google-gemini provider, got {provider_name}")
                return False
                
            provider_cfg = config["providers"].get(provider_name)
            if not provider_cfg:
                log.error(f"Configuration for provider '{provider_name}' not found")
                return False
                
            self.api_key = provider_cfg.get("api_key")
            self.model_name = model_name
            
            if not self.api_key:
                log.error(f"API key for {provider_name} provider is missing in config")
                return False
                
            # Configure Gemini client
            self.client = genai.Client(api_key=self.api_key)
            
            log.info(f"Google Gemini provider setup: {self.model_name}")
            return True
            
        except Exception as e:
            log.error(f"Failed to setup Google Gemini provider: {e}")
            return False
    
    async def generate_stream(
        self,
        messages: List[Dict[str, Any]],
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> AsyncGenerator[Tuple[str, Optional[str]], None]:
        """Generate streaming response from Gemini API."""
        if not self.client:
            raise RuntimeError("Provider not setup. Call setup() first.")
        
        # Detailed input logging
        log.debug(f"INPUT - Raw messages received: {len(messages)} messages")
        for i, msg in enumerate(messages):
            role = msg.get("role")
            content_preview = str(msg.get("content"))[:100] + "..." if len(str(msg.get("content", ""))) > 100 else msg.get("content")
            log.debug(f"INPUT - Message {i}: role={role}, content={content_preview}")
        
        log.debug(f"INPUT - Generation parameters: {kwargs}")
        log.debug(f"INPUT - System prompt: {system_prompt}")
            
        # Convert OpenAI format to Gemini format
        gemini_contents = self._translate_to_gemini_format(messages)
        
        # Ensure we have content - if all messages were filtered out, add a default message
        if not gemini_contents:
            log.warning("No valid content after translation, using fallback message")
            gemini_contents = [types.Content(
                role="user",
                parts=[types.Part.from_text(text="Hello")]
            )]
        
        log.debug(f"PROCESSING - Final Gemini format message count: {len(gemini_contents)}")
        
        # Configure generation settings
        generation_config = types.GenerateContentConfig()
        
        # Handle max tokens
        if "max_tokens" in kwargs:
            generation_config.max_output_tokens = kwargs.pop("max_tokens")
            log.debug(f"PROCESSING - Setting max_output_tokens: {generation_config.max_output_tokens}")
        
        # Handle other parameters
        for param in ["temperature", "top_p", "top_k"]:
            if param in kwargs:
                value = kwargs.pop(param)
                setattr(generation_config, param, value)
                log.debug(f"PROCESSING - Setting {param}: {value}")
        
        # Configure safety settings if needed
        safety_settings = []
        for category in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", 
                         "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]:
            safety_settings.append(
                types.SafetySetting(
                    category=category,
                    threshold="BLOCK_MEDIUM_AND_ABOVE"
                )
            )
        generation_config.safety_settings = safety_settings
        log.debug(f"PROCESSING - Configured safety settings: {len(safety_settings)} categories")
        
        # Add system instruction if provided
        if system_prompt:
            generation_config.system_instruction = system_prompt
            log.debug(f"PROCESSING - Using system instruction: {system_prompt}")
        
        try:
            log.debug(f"API REQUEST - Sending request to Gemini model: {self.model_name}")
            # Use asyncio to run the stream in a thread pool
            stream_response = await asyncio.to_thread(
                self.client.models.generate_content_stream,
                model=self.model_name,
                contents=gemini_contents,
                config=generation_config
            )
            
            # Process the stream chunks
            chunk_count = 0
            total_tokens = 0
            
            log.debug("API RESPONSE - Beginning to process response stream")
            for chunk in stream_response:
                chunk_count += 1
                finish_reason = None
                # Check for block reasons if available in response
                if hasattr(chunk, 'prompt_feedback') and chunk.prompt_feedback and chunk.prompt_feedback.block_reason:
                    finish_reason = f"Blocked: {chunk.prompt_feedback.block_reason}"
                    log.warning(f"OUTPUT - Content blocked: {finish_reason}")
                
                log.debug(f"OUTPUT - Chunk {chunk_count}: '{chunk.text}', finish_reason: {finish_reason}")
                if chunk.text: # Check if text exists before splitting
                    total_tokens += len(chunk.text.split())
                
                log.debug(f"YIELDING - Chunk {chunk_count}: '{chunk.text}'")
                yield chunk.text or "", finish_reason # Yield empty string if text is None
            
                log.debug(f"YIELDED - Chunk {chunk_count}")
            log.debug(f"OUTPUT - Stream complete: {chunk_count} chunks, ~{total_tokens} tokens")
                
        except Exception as e:
            log.error(f"Gemini API Error: {e}")
            log.exception("Full exception details:")
            yield f"Error: {e}", "error"
    
    def _translate_to_gemini_format(self, messages_openai):
        """Translate OpenAI message format to Gemini format."""
        log.debug(f"TRANSLATION - Beginning translation of {len(messages_openai)} OpenAI-format messages")
        gemini_contents = []
        
        for i, msg in enumerate(messages_openai):
            role = msg.get("role")
            content = msg.get("content")
            
            log.debug(f"TRANSLATION - Processing message {i}: role={role}, content_type={type(content)}")
            
            # Handle empty or None content
            if not content:
                log.debug(f"TRANSLATION - Skipping message {i} with empty content")
                continue
            
            if role == "system":
                # Skip system messages, they're handled separately with system_instruction
                log.debug(f"TRANSLATION - Skipping system message {i}, it will be passed as system_instruction")
                continue
                
            # Map OpenAI roles to Gemini roles
            gemini_role = "model" if role == "assistant" else "user"
            log.debug(f"TRANSLATION - Mapped role '{role}' to Gemini role '{gemini_role}'")
            
            # Handle different content types
            if isinstance(content, str):
                # Simple text message
                content_preview = content[:50] + "..." if len(content) > 50 else content
                log.debug(f"TRANSLATION - Adding text message {i}: {content_preview}")
                gemini_contents.append(
                    types.Content(
                        role=gemini_role,
                        parts=[types.Part.from_text(text=content)]
                    )
                )
                log.debug(f"TRANSLATION - Added text message with role {gemini_role}")
            elif isinstance(content, list):
                # Handle multimodal content (like images)
                parts = []
                log.debug(f"TRANSLATION - Processing multimodal message {i} with {len(content)} items")
                
                for j, item in enumerate(content):
                    item_type = item.get("type")
                    log.debug(f"TRANSLATION - Processing multimodal item {j}, type: {item_type}")
                    
                    if item_type == "text":
                        text_content = item.get("text", "")
                        text_preview = text_content[:50] + "..." if len(text_content) > 50 else text_content
                        log.debug(f"TRANSLATION - Adding text part: {text_preview}")
                        parts.append(types.Part.from_text(text=text_content))
                    elif item_type == "image_url":
                        image_url_data = item.get("image_url", {}).get("url", "")
                        url_preview = image_url_data[:30] + "..." if len(image_url_data) > 30 else image_url_data
                        log.debug(f"TRANSLATION - Processing image URL: {url_preview}")
                        if image_url_data.startswith("data:"):
                            try:
                                header, b64_data = image_url_data.split(",", 1)
                                mime_type = header.split(":")[1].split(";")[0]
                                log.debug(f"TRANSLATION - Parsed image data: mime_type={mime_type}, data_length={len(b64_data)}")
                                parts.append(types.Part.from_bytes(
                                    data=b64_data.encode(),
                                    mime_type=mime_type
                                ))
                                log.debug(f"TRANSLATION - Added image part with mime type: {mime_type}")
                            except Exception as e:
                                log.warning(f"TRANSLATION - Could not parse image data URI: {e}")
                        else:
                            log.warning(f"TRANSLATION - Unsupported image URL format: {url_preview}")
                    else:
                        log.warning(f"TRANSLATION - Unsupported multimodal item type: {item_type}")
                
                if parts:
                    log.debug(f"TRANSLATION - Adding multimodal content with {len(parts)} parts")
                    gemini_contents.append(
                        types.Content(
                            role=gemini_role,
                            parts=parts
                        )
                    )
                    log.debug(f"TRANSLATION - Added multimodal message with role {gemini_role}")
                else:
                    log.warning(f"TRANSLATION - No valid parts found in multimodal message {i}")
            else:
                log.warning(f"TRANSLATION - Unsupported content type for message {i}: {type(content)}")
        
        log.debug(f"TRANSLATION - Completed: translated to {len(gemini_contents)} Gemini contents")
        
        # Log detailed structure of the first few messages (if available)
        content_summary = []
        for i, content in enumerate(gemini_contents[:3]):  # Log up to first 3 messages
            parts_info = []
            for j, part in enumerate(content.parts):
                if hasattr(part, 'text') and part.text:
                    text_preview = part.text[:50] + "..." if len(part.text) > 50 else part.text
                    parts_info.append(f"text: '{text_preview}'")
                elif hasattr(part, 'mime_type'):
                    parts_info.append(f"mime_type: {part.mime_type}")
                else:
                    parts_info.append("unknown part type")
            
            content_summary.append(f"Message {i}: role={content.role}, parts=[{', '.join(parts_info)}]")
        
        if content_summary:
            log.debug(f"TRANSLATION - Content structure sample: {content_summary}")
            
        return gemini_contents
    
    @property
    def supports_vision(self) -> bool:
        """Check if the model supports vision."""
        return "gemini" in self.model_name.lower() and not "text" in self.model_name.lower()
    
    @property
    def supports_usernames(self) -> bool:
        """Gemini doesn't support usernames in the same way OpenAI does."""
        return False
