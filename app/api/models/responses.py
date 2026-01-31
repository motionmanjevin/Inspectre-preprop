"""API response models."""
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime


class StatusResponse(BaseModel):
    """Recording status response."""
    recording: bool = Field(..., description="Whether recording is in progress")
    rtsp_url: Optional[str] = Field(None, description="Current RTSP URL being recorded")


class RecordingResponse(BaseModel):
    """Recording operation response."""
    status: str = Field(..., description="Operation status")
    rtsp_url: Optional[str] = Field(None, description="RTSP URL")


class ClipInfo(BaseModel):
    """Information about a video clip."""
    video_url: str = Field(..., description="Public URL of the video")
    metadata: Dict[str, Any] = Field(..., description="Clip metadata")
    distance: Optional[float] = Field(None, description="Search distance score")


class ClipSearchResponse(BaseModel):
    """Response for clip search."""
    clips: List[ClipInfo] = Field(..., description="List of matching clips")
    query: str = Field(..., description="The search query used")


class AnalysisResult(BaseModel):
    """Result of video analysis."""
    video_url: str = Field(..., description="Public URL of the analyzed video")
    local_path: Optional[str] = Field(None, description="Local filename for video serving")
    analysis: Optional[str] = Field(None, description="Analysis output")
    error: Optional[str] = Field(None, description="Error message if analysis failed")


class AnalysisResponse(BaseModel):
    """Response for video analysis."""
    results: List[AnalysisResult] = Field(..., description="List of analysis results")
    query: str = Field(..., description="The analysis query used")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = Field(..., description="Health status")
    version: Optional[str] = Field(None, description="Application version")


class AvailableDatesResponse(BaseModel):
    """Response for available dates query."""
    dates: List[str] = Field(..., description="List of dates with data (YYYY-MM-DD format, newest first)")


class ProcessingStatsResponse(BaseModel):
    """Response for processing statistics."""
    chunks_processed: int = Field(..., description="Number of video chunks processed in last 24 hours")
    total_minutes: int = Field(..., description="Total minutes of video processed")
    max_minutes: int = Field(..., description="Maximum minutes in 24 hours (1440)")
    progress_percent: float = Field(..., description="Percentage of 24 hours covered")


class AlertResponse(BaseModel):
    """Alert information."""
    id: str = Field(..., description="Alert ID")
    query: str = Field(..., description="Alert query text")
    enabled: bool = Field(..., description="Whether alert is enabled")
    created_at: datetime = Field(..., description="When alert was created")
    trigger_count: int = Field(0, description="Number of times alert has been triggered")


class AlertListResponse(BaseModel):
    """Response for alert list."""
    alerts: List[AlertResponse] = Field(..., description="List of alerts")


class AlertHistoryResponse(BaseModel):
    """Alert trigger history entry."""
    id: str = Field(..., description="History entry ID")
    alert_id: str = Field(..., description="Alert ID that triggered")
    alert_query: str = Field(..., description="Alert query text")
    video_url: str = Field(..., description="Video URL where alert was triggered")
    local_path: Optional[str] = Field(None, description="Local filename for video serving")
    timestamp: datetime = Field(..., description="When alert was triggered")
    analysis_snippet: Optional[str] = Field(None, description="Snippet of analysis that triggered alert")


class AlertHistoryListResponse(BaseModel):
    """Response for alert history list."""
    history: List[AlertHistoryResponse] = Field(..., description="List of alert triggers")


class UserResponse(BaseModel):
    """User information response."""
    id: int = Field(..., description="User ID")
    email: str = Field(..., description="User email")
    created_at: datetime = Field(..., description="When user was created")


class TokenResponse(BaseModel):
    """Authentication token response."""
    access_token: str = Field(..., description="JWT access token")
    token_type: str = Field(default="bearer", description="Token type")
    user: UserResponse = Field(..., description="User information")
