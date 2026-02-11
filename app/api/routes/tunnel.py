"""Tunnel management routes."""
import logging
from typing import Callable
from fastapi import APIRouter, HTTPException, Depends

from app.api.dependencies import get_current_user
from app.utils.exceptions import VideoRecordingError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tunnel", tags=["tunnel"])

# This will be set by main.py to avoid circular imports
_tunnel_manager_getter: Callable = None


def set_tunnel_manager_getter(getter: Callable):
    """Set the tunnel manager getter function."""
    global _tunnel_manager_getter
    _tunnel_manager_getter = getter


@router.get("/url")
async def get_tunnel_url(
    current_user: dict = Depends(get_current_user)
) -> dict:
    """
    Get the current Cloudflare tunnel URL for mobile pairing.
    
    Returns:
        Dictionary with tunnel_url (or null if not available)
    
    Raises:
        HTTPException: If tunnel is not available
    """
    if _tunnel_manager_getter is None:
        raise HTTPException(
            status_code=503,
            detail="Tunnel manager not initialized"
        )
    
    try:
        tunnel_manager = _tunnel_manager_getter()
        tunnel_url = tunnel_manager.get_tunnel_url()
        
        if not tunnel_url:
            # Try to start tunnel if not already running
            try:
                tunnel_url = tunnel_manager.start_tunnel()
            except VideoRecordingError as e:
                logger.error(f"Failed to start tunnel: {str(e)}")
                raise HTTPException(
                    status_code=503,
                    detail=f"Tunnel not available: {str(e)}"
                ) from e
        
        return {"tunnel_url": tunnel_url}
        
    except Exception as e:
        logger.error(f"Error getting tunnel URL: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get tunnel URL: {str(e)}"
        ) from e
