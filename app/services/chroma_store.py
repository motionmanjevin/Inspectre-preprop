"""ChromaDB storage service."""
import logging
from typing import List, Dict, Any, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.qwen_client import QwenVLClient
import json
from datetime import datetime, date, timedelta

import chromadb
from chromadb.config import Settings

# Handle different chromadb versions
try:
    from chromadb.errors import ChromaError
except ImportError:
    # Newer versions may have different error handling
    ChromaError = Exception

from app.utils.exceptions import ChromaDBError
from app.core.config import get_settings

logger = logging.getLogger(__name__)


class ChromaStore:
    """Manages ChromaDB storage for video links and analysis results."""
    
    def __init__(
        self,
        collection_name: Optional[str] = None,
        persist_directory: Optional[str] = None
    ):
        """
        Initialize ChromaDB store.
        
        Args:
            collection_name: Name of the ChromaDB collection
            persist_directory: Directory to persist ChromaDB data
        """
        settings = get_settings()
        self.collection_name = collection_name or settings.CHROMA_COLLECTION_NAME
        self.persist_directory = persist_directory or settings.CHROMA_DB_DIR
        
        try:
            self.client = chromadb.PersistentClient(
                path=self.persist_directory,
                settings=Settings(anonymized_telemetry=False)
            )
            self.collection = self.client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"}
            )
            logger.info(f"ChromaDB initialized: collection={self.collection_name}")
        except ChromaError as e:
            raise ChromaDBError(f"Failed to initialize ChromaDB: {str(e)}") from e
        except Exception as e:
            raise ChromaDBError(f"Unexpected error initializing ChromaDB: {str(e)}") from e
    
    def add_video_analysis(
        self,
        video_url: str,
        analysis_json: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Add video analysis to ChromaDB.
        
        Args:
            video_url: Public URL of the video
            analysis_json: JSON response from Qwen 3 VL Plus
            metadata: Optional additional metadata
        
        Returns:
            Document ID
        
        Raises:
            ChromaDBError: If storage fails
        """
        try:
            # Extract text content from analysis for embedding
            if isinstance(analysis_json, dict):
                # Try to extract content from the response
                content = ""
                if "choices" in analysis_json:
                    content = analysis_json["choices"][0]["message"]["content"]
                elif "content" in analysis_json:
                    content = analysis_json["content"]
                else:
                    content = json.dumps(analysis_json)
            else:
                content = str(analysis_json)
            
            # Prepare metadata
            now = datetime.now()
            doc_metadata = {
                "video_url": video_url,
                "timestamp": now.isoformat(),
                "timestamp_unix": now.timestamp(),  # Numeric timestamp for filtering
                "analysis": json.dumps(analysis_json)
            }
            
            if metadata:
                doc_metadata.update(metadata)
            
            # Generate unique ID
            doc_id = f"video_{datetime.now().timestamp()}"
            
            # Add to collection
            self.collection.add(
                documents=[content],
                metadatas=[doc_metadata],
                ids=[doc_id]
            )
            
            logger.info(f"Added video analysis to ChromaDB: {doc_id}")
            return doc_id
            
        except ChromaError as e:
            error_msg = f"ChromaDB error adding video analysis: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error adding video analysis: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
    
    def _get_time_filter(self, target_date: Optional[date] = None) -> Dict[str, Any]:
        """
        Build time filter for ChromaDB query.
        
        Args:
            target_date: Specific date to filter. If None, uses last 24 hours.
        
        Returns:
            ChromaDB where clause for time filtering
        """
        if target_date is None:
            # Last 24 hours (rolling window)
            now = datetime.now()
            start_time = now - timedelta(hours=24)
            start_timestamp = start_time.timestamp()
            end_timestamp = now.timestamp()
        else:
            # Specific date (00:00:00 to 23:59:59)
            start_datetime = datetime.combine(target_date, datetime.min.time())
            end_datetime = datetime.combine(target_date, datetime.max.time())
            start_timestamp = start_datetime.timestamp()
            end_timestamp = end_datetime.timestamp()
        
        return {
            "$and": [
                {"timestamp_unix": {"$gte": start_timestamp}},
                {"timestamp_unix": {"$lte": end_timestamp}}
            ]
        }
    
    def search_clips(
        self,
        query: str,
        n_results: int = 5,
        target_date: Optional[date] = None,
        rerank_client: Optional["QwenVLClient"] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search for relevant video clips based on query using Qwen reranker.
        Fetches all clips in time window, then reranks by relevance (no ChromaDB similarity).

        Args:
            query: Search query text
            n_results: Number of results to return
            target_date: Specific date to filter. If None, uses last 24 hours.
            rerank_client: Qwen client with rerank_documents(); required for search.

        Returns:
            List of dicts with video_url, metadata, relevance_score (and distance for compat).
        """
        try:
            query = (query or "").strip()
            if not query:
                return []
            if rerank_client is None:
                logger.warning("search_clips called without rerank_client; returning no results")
                return []

            settings = get_settings()
            n_results = max(1, min(int(n_results or settings.DEFAULT_SEARCH_RESULTS), settings.MAX_SEARCH_RESULTS))
            time_filter = self._get_time_filter(target_date)

            # Get all clips in time window (candidate documents)
            results = self.collection.get(
                where=time_filter,
                include=["metadatas", "documents"],
            )
            ids = results.get("ids") or []
            if not ids:
                date_desc = target_date.isoformat() if target_date else "last 24 hours"
                logger.info(f"Found 0 clips for query '{query[:50]}...' in {date_desc}")
                return []

            metadatas = results.get("metadatas") or []
            documents_raw = results.get("documents") or []
            
            # Log what we found
            logger.info(f"Retrieved {len(ids)} clips from ChromaDB for reranking")
            
            max_chars = getattr(settings, "QWEN_RERANK_MAX_CHARS_PER_DOC", 16000)
            max_docs = getattr(settings, "QWEN_RERANK_MAX_DOCS", 500)
            documents = []
            for i, doc in enumerate(documents_raw):
                text = (doc or "").strip()
                if not text:
                    logger.warning(f"Clip {i} has empty document text")
                    continue
                if len(text) > max_chars:
                    text = text[:max_chars] + "..."
                documents.append(text)
            documents = documents[:max_docs]
            
            if not documents:
                logger.warning(f"No valid document texts found for reranking (had {len(documents_raw)} raw docs)")
                return []

            logger.info(f"Sending {len(documents)} documents to Qwen reranker (query: '{query[:50]}...')")
            # Rerank with Qwen (get more candidates than needed, then filter by score)
            rerank_results = rerank_client.rerank_documents(query, documents, top_n=min(n_results * 2, len(documents)))
            logger.info(f"Reranker returned {len(rerank_results)} results")
            
            # Filter by minimum relevance score
            min_score = getattr(settings, "CLIP_MIN_RELEVANCE_SCORE", 0.3)
            clips = []
            for r in rerank_results:
                idx = r.get("index", 0)
                score = r.get("relevance_score", 0.0)
                
                # Filter out low-relevance clips
                if score < min_score:
                    logger.debug(f"Skipping clip {idx}: score {score:.4f} < min {min_score}")
                    continue
                
                if idx >= len(metadatas):
                    logger.warning(f"Rerank result index {idx} out of range (have {len(metadatas)} metadatas)")
                    continue
                meta = metadatas[idx]
                clip = {
                    "video_url": meta.get("video_url", ""),
                    "metadata": meta,
                    "relevance_score": score,
                    "distance": 1.0 - score,
                }
                clips.append(clip)
                logger.info(f"Added clip {idx}: score={score:.4f}, url={meta.get('video_url', '')[:50]}...")
                
                # Stop once we have enough results
                if len(clips) >= n_results:
                    break

            date_desc = target_date.isoformat() if target_date else "last 24 hours"
            logger.info(f"Found {len(clips)} clips for query '{query[:50]}...' in {date_desc}")
            return clips

        except ChromaError as e:
            error_msg = f"ChromaDB error searching clips: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error searching clips: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
    
    def get_videos_for_analysis(
        self,
        query: str,
        n_results: int = 5,
        target_date: Optional[date] = None
    ) -> List[str]:
        """
        Get video URLs for analysis based on query.
        
        Args:
            query: Search query text
            n_results: Number of results to return
            target_date: Specific date to filter. If None, uses last 24 hours.
        
        Returns:
            List of video URLs
        """
        clips = self.search_clips(query, n_results, target_date)
        return [clip["video_url"] for clip in clips]
    
    def get_all_videos(self) -> List[Dict[str, Any]]:
        """
        Get all stored video entries.
        
        Returns:
            List of video entries
        """
        try:
            results = self.collection.get()
            
            videos = []
            if results["ids"]:
                for i in range(len(results["ids"])):
                    video = {
                        "id": results["ids"][i],
                        "metadata": results["metadatas"][i] if results["metadatas"] else {},
                        "document": results["documents"][i] if results["documents"] else ""
                    }
                    videos.append(video)
            
            return videos
        except Exception as e:
            logger.error(f"Error getting all videos: {str(e)}")
            raise ChromaDBError(f"Failed to get all videos: {str(e)}") from e
    
    def get_available_dates(self) -> List[str]:
        """
        Get list of dates that have stored video entries.
        
        Returns:
            List of dates in YYYY-MM-DD format, sorted descending (newest first)
        
        Raises:
            ChromaDBError: If retrieval fails
        """
        try:
            results = self.collection.get()
            
            dates_set = set()
            if results["ids"] and results["metadatas"]:
                for metadata in results["metadatas"]:
                    # Try to get timestamp from metadata
                    if "timestamp_unix" in metadata:
                        # Convert unix timestamp to date
                        dt = datetime.fromtimestamp(metadata["timestamp_unix"])
                        dates_set.add(dt.date().isoformat())
                    elif "timestamp" in metadata:
                        # Fallback: parse ISO timestamp
                        try:
                            dt = datetime.fromisoformat(metadata["timestamp"])
                            dates_set.add(dt.date().isoformat())
                        except (ValueError, TypeError):
                            pass
            
            # Sort dates descending (newest first)
            sorted_dates = sorted(dates_set, reverse=True)
            logger.info(f"Found {len(sorted_dates)} available dates")
            return sorted_dates
            
        except ChromaError as e:
            error_msg = f"ChromaDB error getting available dates: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error getting available dates: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
    
    def get_processing_stats(self) -> Dict[str, Any]:
        """
        Get processing statistics for the last 24 hours.
        
        Returns:
            Dictionary with:
                - chunks_processed: Number of video chunks processed in last 24 hours
                - total_minutes: Total minutes of video processed (chunks * 10)
                - max_minutes: Maximum minutes in 24 hours (1440)
                - progress_percent: Percentage of 24 hours covered
        
        Raises:
            ChromaDBError: If retrieval fails
        """
        try:
            # Get entries from the last 24 hours
            now = datetime.now()
            start_time = now - timedelta(hours=24)
            start_timestamp = start_time.timestamp()
            
            results = self.collection.get(
                where={"timestamp_unix": {"$gte": start_timestamp}}
            )
            
            chunks_processed = len(results["ids"]) if results["ids"] else 0
            
            # Each chunk is 10 minutes
            total_minutes = chunks_processed * 10
            max_minutes = 1440  # 24 hours * 60 minutes
            
            # Cap at 100%
            progress_percent = min((total_minutes / max_minutes) * 100, 100)
            
            stats = {
                "chunks_processed": chunks_processed,
                "total_minutes": total_minutes,
                "max_minutes": max_minutes,
                "progress_percent": round(progress_percent, 1)
            }
            
            logger.info(f"Processing stats: {chunks_processed} chunks, {total_minutes} minutes")
            return stats
            
        except ChromaError as e:
            error_msg = f"ChromaDB error getting processing stats: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error getting processing stats: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
    
    def clear_all(self) -> None:
        """
        Clear all entries from the ChromaDB collection.
        
        Raises:
            ChromaDBError: If clearing fails
        """
        try:
            # Get all IDs in the collection
            results = self.collection.get()
            if results["ids"] and len(results["ids"]) > 0:
                # Delete all entries
                self.collection.delete(ids=results["ids"])
                logger.info(f"Cleared {len(results['ids'])} entries from ChromaDB")
            else:
                logger.info("ChromaDB collection is already empty")
        except ChromaError as e:
            error_msg = f"ChromaDB error clearing collection: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error clearing collection: {str(e)}"
            logger.error(error_msg)
            raise ChromaDBError(error_msg) from e
