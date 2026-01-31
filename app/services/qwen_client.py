"""Qwen 3 VL API client service."""
import logging
import re
from typing import Dict, Any, List, Optional

import requests
from requests.exceptions import RequestException

from app.utils.exceptions import QwenAPIError
from app.core.config import get_settings

logger = logging.getLogger(__name__)


class QwenVLClient:
    """Client for Qwen 3 VL Plus and Qwen 3 VL Flash APIs."""
    
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    ):
        """
        Initialize Qwen API client.
        
        Args:
            api_key: Alibaba Cloud API key
            base_url: Base URL for the API
        """
        self.api_key = api_key
        self.base_url = base_url
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        logger.info("QwenVLClient initialized")
    
    def process_video_plus(
        self,
        video_url: str,
        preprompt: str,
        fps: int = 2,
        alerts: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """
        Process video using Qwen 3 VL Plus API.
        
        Args:
            video_url: Public URL of the video
            preprompt: Pre-prompt text for analysis
            fps: Frames per second for video processing
            alerts: List of alert dictionaries with 'id' and 'query' keys
        
        Returns:
            JSON response from the API
        
        Raises:
            QwenAPIError: If API call fails
        """
        # Inject alerts into preprompt if provided
        full_prompt = preprompt
        if alerts and len(alerts) > 0:
            alert_section = "\n\nAdditionally, evaluate the following alert conditions and respond with TRUE or FALSE on the last line for each (one per line, format: \"ALERT_ID: TRUE/FALSE\"):\n"
            for alert in alerts:
                alert_id = alert.get("id", "")
                alert_query = alert.get("query", "")
                alert_section += f"- {alert_id}: {alert_query}\n"
            full_prompt = preprompt + alert_section
        
        payload = {
            "model": "qwen3-vl-plus",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "video_url",
                            "video_url": {
                                "url": video_url
                            },
                            "fps": fps
                        },
                        {
                            "type": "text",
                            "text": full_prompt
                        }
                    ]
                }
            ]
        }
        
        try:
            logger.info(f"Processing video with Qwen 3 VL Plus: {video_url}")
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json=payload,
                timeout=300  # 5 minute timeout for video processing
            )
            
            response.raise_for_status()
            result = response.json()
            logger.info("Qwen 3 VL Plus processing complete")
            return result
            
        except RequestException as e:
            error_msg = f"Qwen 3 VL Plus API request failed: {str(e)}"
            logger.error(error_msg)
            raise QwenAPIError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error calling Qwen 3 VL Plus: {str(e)}"
            logger.error(error_msg)
            raise QwenAPIError(error_msg) from e
    
    def analyze_video_flash(
        self,
        video_url: str,
        user_query: str,
        fps: int = 2
    ) -> str:
        """
        Analyze video using Qwen 3 VL Flash API with user query.
        
        Args:
            video_url: Public URL of the video
            user_query: User's query for analysis
            fps: Frames per second for video processing
        
        Returns:
            Raw text response from the API
        
        Raises:
            QwenAPIError: If API call fails
        """
        payload = {
            "model": "qwen3-vl-flash",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "video_url",
                            "video_url": {
                                "url": video_url
                            },
                            "fps": fps
                        },
                        {
                            "type": "text",
                            "text": user_query
                        }
                    ]
                }
            ]
        }
        
        try:
            logger.info(f"Analyzing video with Qwen 3 VL Flash: {video_url}")
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json=payload,
                timeout=300  # 5 minute timeout
            )
            
            response.raise_for_status()
            result = response.json()
            
            # Extract raw content from response
            content = result["choices"][0]["message"]["content"]
            logger.info("Qwen 3 VL Flash analysis complete")
            return content
            
        except RequestException as e:
            error_msg = f"Qwen 3 VL Flash API request failed: {str(e)}"
            logger.error(error_msg)
            raise QwenAPIError(error_msg) from e
        except (KeyError, IndexError) as e:
            error_msg = f"Unexpected response format from Qwen 3 VL Flash: {str(e)}"
            logger.error(error_msg)
            raise QwenAPIError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error calling Qwen 3 VL Flash: {str(e)}"
            logger.error(error_msg)
            raise QwenAPIError(error_msg) from e
    
    @staticmethod
    def parse_alert_responses(response_text: str, alert_ids: List[str]) -> Dict[str, bool]:
        """
        Parse alert TRUE/FALSE responses from Qwen output.
        
        Args:
            response_text: Full response text from Qwen API
            alert_ids: List of alert IDs to look for
        
        Returns:
            Dictionary mapping alert_id to boolean (True if alert triggered)
        """
        results = {alert_id: False for alert_id in alert_ids}
        
        # Look for patterns like "ALERT_ID: TRUE" or "ALERT_ID: FALSE" at the end of response
        lines = response_text.strip().split('\n')
        
        # Check last few lines for alert responses
        for line in reversed(lines[-10:]):  # Check last 10 lines
            line = line.strip()
            if not line:
                continue
            
            # Try to match "ALERT_ID: TRUE/FALSE" pattern
            for alert_id in alert_ids:
                # Pattern: alert_id followed by colon and TRUE/FALSE
                pattern = rf"{re.escape(alert_id)}\s*:\s*(TRUE|FALSE)"
                match = re.search(pattern, line, re.IGNORECASE)
                if match:
                    value = match.group(1).upper()
                    results[alert_id] = (value == "TRUE")
                    logger.debug(f"Parsed alert {alert_id}: {value}")
        
        return results
