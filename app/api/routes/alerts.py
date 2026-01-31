"""Alerts API routes."""
import logging

from fastapi import APIRouter, HTTPException, Depends

from app.api.models.requests import CreateAlertRequest, UpdateAlertRequest
from app.api.models.responses import (
    AlertResponse,
    AlertListResponse,
    AlertHistoryResponse,
    AlertHistoryListResponse
)
from app.api.dependencies import get_current_user
from app.services.alert_service import AlertService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])


def get_alert_service() -> AlertService:
    """Get AlertService instance."""
    return AlertService()


@router.post("", response_model=AlertResponse, status_code=201)
async def create_alert(
    request: CreateAlertRequest,
    current_user: dict = Depends(get_current_user)
) -> AlertResponse:
    """
    Create a new alert.
    
    Args:
        request: Alert creation request with query and enabled status
    
    Returns:
        Created alert response
    
    Raises:
        HTTPException: If creation fails
    """
    try:
        alert_service = get_alert_service()
        alert = alert_service.create_alert(
            query=request.query,
            enabled=request.enabled if request.enabled is not None else True
        )
        
        logger.info(f"Created alert: {alert['id']}")
        return AlertResponse(**alert)
        
    except Exception as e:
        logger.error(f"Error creating alert: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create alert: {str(e)}"
        ) from e


@router.get("/{alert_id}", response_model=AlertResponse)
async def get_alert(
    alert_id: str,
    current_user: dict = Depends(get_current_user)
) -> AlertResponse:
    """
    Get an alert by ID.
    
    Args:
        alert_id: Alert ID
    
    Returns:
        Alert response
    
    Raises:
        HTTPException: If alert not found or retrieval fails
    """
    try:
        alert_service = get_alert_service()
        alert = alert_service.get_alert(alert_id)
        
        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")
        
        return AlertResponse(**alert)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting alert: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get alert: {str(e)}"
        ) from e


@router.get("", response_model=AlertListResponse)
async def get_all_alerts(
    current_user: dict = Depends(get_current_user)
) -> AlertListResponse:
    """
    Get all alerts.
    
    Returns:
        List of all alerts
    
    Raises:
        HTTPException: If retrieval fails
    """
    try:
        alert_service = get_alert_service()
        alerts = alert_service.get_all_alerts()
        
        return AlertListResponse(
            alerts=[AlertResponse(**alert) for alert in alerts]
        )
        
    except Exception as e:
        logger.error(f"Error getting alerts: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get alerts: {str(e)}"
        ) from e


@router.put("/{alert_id}", response_model=AlertResponse)
async def update_alert(
    alert_id: str,
    request: UpdateAlertRequest,
    current_user: dict = Depends(get_current_user)
) -> AlertResponse:
    """
    Update an alert.
    
    Args:
        alert_id: Alert ID
        request: Update request with optional query and enabled status
    
    Returns:
        Updated alert response
    
    Raises:
        HTTPException: If alert not found or update fails
    """
    try:
        alert_service = get_alert_service()
        alert = alert_service.update_alert(
            alert_id=alert_id,
            query=request.query,
            enabled=request.enabled
        )
        
        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")
        
        logger.info(f"Updated alert: {alert_id}")
        return AlertResponse(**alert)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating alert: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update alert: {str(e)}"
        ) from e


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: str,
    current_user: dict = Depends(get_current_user)
) -> None:
    """
    Delete an alert.
    
    Args:
        alert_id: Alert ID
    
    Raises:
        HTTPException: If alert not found or deletion fails
    """
    try:
        alert_service = get_alert_service()
        deleted = alert_service.delete_alert(alert_id)
        
        if not deleted:
            raise HTTPException(status_code=404, detail="Alert not found")
        
        logger.info(f"Deleted alert: {alert_id}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting alert: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete alert: {str(e)}"
        ) from e


@router.get("/history", response_model=AlertHistoryListResponse)
async def get_alert_history(
    limit: int = 100,
    current_user: dict = Depends(get_current_user)
) -> AlertHistoryListResponse:
    """
    Get alert trigger history.
    
    Args:
        limit: Maximum number of entries to return (default: 100)
    
    Returns:
        List of alert history entries
    
    Raises:
        HTTPException: If retrieval fails
    """
    try:
        alert_service = get_alert_service()
        history = alert_service.get_alert_history(limit=limit)
        
        return AlertHistoryListResponse(
            history=[AlertHistoryResponse(**entry) for entry in history]
        )
        
    except Exception as e:
        logger.error(f"Error getting alert history: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get alert history: {str(e)}"
        ) from e
