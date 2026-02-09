"""Analysis API routes."""
import logging

from fastapi import APIRouter, HTTPException, Depends

from app.api.models.requests import AnalysisRequest
from app.api.models.responses import AnalysisResponse, AnalysisResult
from app.api.dependencies import get_current_user
from app.services.chroma_store import ChromaStore
from app.services.qwen_client import QwenVLClient
from app.core.config import get_settings
from app.utils.exceptions import ChromaDBError, QwenAPIError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["analysis"])


def get_chroma_store() -> ChromaStore:
    """Get ChromaDB store instance."""
    settings = get_settings()
    return ChromaStore(
        collection_name=settings.CHROMA_COLLECTION_NAME,
        persist_directory=settings.CHROMA_DB_DIR
    )


def get_qwen_client() -> QwenVLClient:
    """Get Qwen API client instance."""
    settings = get_settings()
    return QwenVLClient(
        api_key=settings.QWEN_API_KEY,
        base_url=settings.QWEN_BASE_URL
    )


@router.post("", response_model=AnalysisResponse)
async def analyze_videos(
    request: AnalysisRequest,
    current_user: dict = Depends(get_current_user)
) -> AnalysisResponse:
    """
    Analyze videos based on query using Qwen 3 VL Flash.
    
    By default, searches only within the last 24 hours.
    Optionally specify target_date to analyze videos from a specific date.
    
    Args:
        request: Analysis request with query
    
    Returns:
        Response with analysis results
    
    Raises:
        HTTPException: If analysis fails
    """
    try:
        chroma_store = get_chroma_store()
        settings = get_settings()
        
        # Get relevant video clips (Qwen rerank)
        qwen_client = get_qwen_client()
        clips = chroma_store.search_clips(
            query=request.query,
            n_results=request.n_results or settings.DEFAULT_SEARCH_RESULTS,
            target_date=request.target_date,
            rerank_client=qwen_client,
        )
        # Filter by min relevance score before sending to VL Flash
        min_score = getattr(settings, "ANALYSIS_MIN_RELEVANCE_SCORE", 0.0)
        strong_clips = [c for c in clips if (c.get("relevance_score") or 0) >= min_score]

        if not strong_clips:
            date_desc = request.target_date.isoformat() if request.target_date else "last 24 hours"
            logger.info(
                f"No relevant videos found for query '{request.query[:50]}...' in {date_desc} "
                f"(candidates={len(clips)}, analysis_min_relevance_score={min_score})"
            )
            return AnalysisResponse(results=[], query=request.query)

        # Process each video sequentially with Qwen 3 VL Flash
        results = []
        
        for clip in strong_clips:
            video_url = clip["video_url"]
            local_path = clip.get("metadata", {}).get("local_path")
            try:
                logger.info(f"Analyzing video: {video_url}")
                analysis_output = qwen_client.analyze_video_flash(
                    video_url=video_url,
                    user_query=request.query,
                    fps=settings.VIDEO_FPS
                )
                
                results.append(
                    AnalysisResult(
                        video_url=video_url,
                        local_path=local_path,
                        analysis=analysis_output,
                        error=None
                    )
                )
                logger.info(f"Analysis complete for: {video_url}")
                
            except QwenAPIError as e:
                logger.error(f"Qwen API error for {video_url}: {str(e)}")
                results.append(
                    AnalysisResult(
                        video_url=video_url,
                        local_path=local_path,
                        analysis=None,
                        error=str(e)
                    )
                )
            except Exception as e:
                logger.error(f"Unexpected error analyzing {video_url}: {str(e)}", exc_info=True)
                results.append(
                    AnalysisResult(
                        video_url=video_url,
                        local_path=local_path,
                        analysis=None,
                        error=f"Unexpected error: {str(e)}"
                    )
                )
        
        logger.info(f"Completed analysis for {len(results)} videos")
        return AnalysisResponse(results=results, query=request.query)
        
    except ChromaDBError as e:
        logger.error(f"ChromaDB error during analysis: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        ) from e
    except Exception as e:
        logger.error(f"Unexpected error during analysis: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        ) from e
