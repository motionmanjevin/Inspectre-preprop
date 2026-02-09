"""Qwen 3 VL API client service."""
import logging
import re
from typing import Dict, Any, List, Optional

import requests
from requests.exceptions import RequestException

from app.utils.exceptions import QwenAPIError
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_MAX_ERROR_BODY_CHARS = 2000


def _format_http_error_response(response: requests.Response) -> str:
    """
    Format an HTTP error response for logging/exception messages without
    dumping unbounded data into logs.
    """
    try:
        content_type = response.headers.get("content-type", "")
    except Exception:
        content_type = ""

    # Prefer JSON error payloads when available, but fall back to text.
    body: str
    try:
        if "application/json" in (content_type or "").lower():
            body = str(response.json())
        else:
            body = response.text
    except Exception:
        try:
            body = response.text
        except Exception:
            body = "(unavailable)"

    body = body or ""
    if len(body) > _MAX_ERROR_BODY_CHARS:
        body = body[:_MAX_ERROR_BODY_CHARS] + "...(truncated)"

    return f"status_code={response.status_code} content_type={content_type!r} body={body}"


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

    def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Get embeddings for a list of texts using Qwen embedding model (e.g. text-embedding-v3).
        Batches in groups of 10 (API limit). Returns list of embedding vectors in same order as input.
        """
        settings = get_settings()
        model = settings.QWEN_EMBEDDING_MODEL
        batch_size = 10
        all_embeddings: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            payload = {
                "model": model,
                "input": batch,
                "dimensions": 1024,
                "encoding_format": "float",
            }
            try:
                response = requests.post(
                    f"{self.base_url}/embeddings",
                    headers=self.headers,
                    json=payload,
                    timeout=60,
                )
                if not response.ok:
                    details = _format_http_error_response(response)
                    raise QwenAPIError(f"Qwen embedding API rejected. {details}")
                data = response.json()
                # OpenAI-compatible response: data[].embedding, data[].index
                items = data.get("data", [])
                for item in sorted(items, key=lambda x: x.get("index", 0)):
                    all_embeddings.append(item["embedding"])
            except RequestException as e:
                raise QwenAPIError(f"Qwen embedding request failed: {e}") from e
        return all_embeddings

    def rerank_documents(
        self,
        query: str,
        documents: List[str],
        top_n: int,
        instruction: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Rerank documents by relevance to query using Qwen reranker.
        Supports qwen3-rerank (Singapore, compatible API) and gte-rerank-v2 (Beijing, DashScope API).
        Returns list of { "index": int, "relevance_score": float } sorted by relevance (best first).
        """
        if not documents:
            return []
        settings = get_settings()
        model = settings.QWEN_RERANK_MODEL
        
        # qwen3-rerank uses compatible API format (Singapore)
        # gte-rerank-v2 uses DashScope API format (Beijing)
        if model == "qwen3-rerank":
            # Compatible API endpoint: /compatible-api/v1/reranks
            rerank_base = self.base_url.replace("compatible-mode/v1", "compatible-api/v1")
            url = f"{rerank_base}/reranks"
            payload = {
                "model": model,
                "query": query,
                "documents": documents,
                "top_n": min(top_n, len(documents)),
            }
            if instruction:
                payload["instruction"] = instruction
        else:
            # DashScope API endpoint (for gte-rerank-v2)
            rerank_base = self.base_url.replace("compatible-mode/v1", "api/v1")
            url = f"{rerank_base}/services/rerank/text-rerank/text-rerank"
            payload = {
                "model": model,
                "input": {
                    "query": query,
                    "documents": documents,
                },
                "parameters": {
                    "top_n": min(top_n, len(documents)),
                    "return_documents": False,
                },
            }
        
        try:
            response = requests.post(
                url,
                headers=self.headers,
                json=payload,
                timeout=120,
            )
            if not response.ok:
                details = _format_http_error_response(response)
                raise QwenAPIError(f"Qwen rerank API rejected. {details}")
            data = response.json()
            
            # Try different response formats:
            # 1. DashScope format: output.results
            # 2. Compatible API might return results directly or in data.results
            results = []
            if "output" in data and "results" in data["output"]:
                results = data["output"]["results"]
            elif "results" in data:
                results = data["results"]
            elif "data" in data and isinstance(data["data"], list):
                results = data["data"]
            
            # Debug: log response structure if empty
            if not results:
                logger.warning(f"Rerank API returned empty results. Response keys: {list(data.keys())}")
                logger.debug(f"Full response: {str(data)[:500]}")
            else:
                logger.debug(f"Rerank returned {len(results)} results. First result keys: {list(results[0].keys()) if results else 'none'}")
            
            return results
        except RequestException as e:
            raise QwenAPIError(f"Qwen rerank request failed: {e}") from e

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
            
            if not response.ok:
                details = _format_http_error_response(response)
                error_msg = f"Qwen 3 VL Plus API request rejected. {details}"
                logger.error(error_msg)
                raise QwenAPIError(error_msg)

            result = response.json()
            logger.info("Qwen 3 VL Plus processing complete")
            return result
            
        except RequestException as e:
            # Network/transport-level errors (no HTTP body available).
            error_msg = f"Qwen 3 VL Plus API request failed (transport error): {str(e)}"
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
            
            if not response.ok:
                details = _format_http_error_response(response)
                error_msg = f"Qwen 3 VL Flash API request rejected. {details}"
                logger.error(error_msg)
                raise QwenAPIError(error_msg)

            result = response.json()
            
            # Extract raw content from response
            content = result["choices"][0]["message"]["content"]
            logger.info("Qwen 3 VL Flash analysis complete")
            return content
            
        except RequestException as e:
            error_msg = f"Qwen 3 VL Flash API request failed (transport error): {str(e)}"
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
