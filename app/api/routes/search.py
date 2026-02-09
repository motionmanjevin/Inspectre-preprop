"""Search API routes."""
import logging

from fastapi import APIRouter, HTTPException, Depends

from app.api.models.requests import QueryRequest
from app.api.models.responses import ClipSearchResponse, ClipInfo, AvailableDatesResponse, ProcessingStatsResponse
from app.api.dependencies import get_current_user
from app.services.chroma_store import ChromaStore
from app.services.qwen_client import QwenVLClient
from app.core.config import get_settings
from app.utils.exceptions import ChromaDBError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])


def get_chroma_store() -> ChromaStore:
    """Get ChromaDB store instance."""
    settings = get_settings()
    return ChromaStore(
        collection_name=settings.CHROMA_COLLECTION_NAME,
        persist_directory=settings.CHROMA_DB_DIR
    )


def get_qwen_client() -> QwenVLClient:
    """Get Qwen API client (for embedding/rerank and VL)."""
    settings = get_settings()
    return QwenVLClient(api_key=settings.QWEN_API_KEY, base_url=settings.QWEN_BASE_URL)


@router.get("/stats", response_model=ProcessingStatsResponse)
async def get_processing_stats(
    current_user: dict = Depends(get_current_user)
) -> ProcessingStatsResponse:
    """
    Get processing statistics for the last 24 hours.
    
    Returns:
        Response with processing stats including chunks processed and progress percentage
    
    Raises:
        HTTPException: If retrieval fails
    """
    try:
        chroma_store = get_chroma_store()
        stats = chroma_store.get_processing_stats()
        
        logger.info(f"Processing stats: {stats['chunks_processed']} chunks processed")
        return ProcessingStatsResponse(**stats)
        
    except ChromaDBError as e:
        logger.error(f"ChromaDB error getting processing stats: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get processing stats: {str(e)}"
        ) from e
    except Exception as e:
        logger.error(f"Unexpected error getting processing stats: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        ) from e


@router.get("/available-dates", response_model=AvailableDatesResponse)
async def get_available_dates(
    current_user: dict = Depends(get_current_user)
) -> AvailableDatesResponse:
    """
    Get list of dates that have stored video entries.
    
    Returns:
        Response with list of available dates (YYYY-MM-DD format, newest first)
    
    Raises:
        HTTPException: If retrieval fails
    """
    try:
        chroma_store = get_chroma_store()
        dates = chroma_store.get_available_dates()
        
        logger.info(f"Retrieved {len(dates)} available dates")
        return AvailableDatesResponse(dates=dates)
        
    except ChromaDBError as e:
        logger.error(f"ChromaDB error getting available dates: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get available dates: {str(e)}"
        ) from e
    except Exception as e:
        logger.error(f"Unexpected error getting available dates: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        ) from e


@router.post("/clips", response_model=ClipSearchResponse)
async def search_clips(
    request: QueryRequest,
    current_user: dict = Depends(get_current_user)
) -> ClipSearchResponse:
    """
    Search for relevant video clips based on query.
    
    By default, searches only within the last 24 hours.
    Optionally specify target_date to search a specific date.
    
    Args:
        request: Search query request
    
    Returns:
        Response with matching clips
    
    Raises:
        HTTPException: If search fails
    """
    try:
        chroma_store = get_chroma_store()
        qwen_client = get_qwen_client()
        clips_data = chroma_store.search_clips(
            query=request.query,
            n_results=request.n_results or get_settings().DEFAULT_SEARCH_RESULTS,
            target_date=request.target_date,
            rerank_client=qwen_client,
        )
        clips = [
            ClipInfo(
                video_url=clip["video_url"],
                metadata=clip["metadata"],
                distance=clip.get("distance"),
            )
            for clip in clips_data
        ]
        
        date_desc = request.target_date.isoformat() if request.target_date else "last 24 hours"
        logger.info(f"Found {len(clips)} clips for query '{request.query[:50]}...' in {date_desc}")
        return ClipSearchResponse(clips=clips, query=request.query)
        
    except ChromaDBError as e:
        logger.error(f"ChromaDB error during search: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Search failed: {str(e)}"
        ) from e
    except Exception as e:
        logger.error(f"Unexpected error during search: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        ) from e
