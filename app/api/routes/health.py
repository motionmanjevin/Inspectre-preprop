"""Health check routes."""
from fastapi import APIRouter

from app.api.models.responses import HealthResponse
from app import __version__

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.
    
    Returns:
        Health status response
    """
    return HealthResponse(
        status="healthy",
        version=__version__
    )
