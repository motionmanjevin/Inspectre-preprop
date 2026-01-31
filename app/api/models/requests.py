"""API request models."""
from datetime import date
from pydantic import BaseModel, Field
from typing import Optional


class StartRecordingRequest(BaseModel):
    """Request to start video recording."""
    rtsp_url: str = Field(..., description="RTSP stream URL to record")
    chunk_duration: Optional[int] = Field(
        None,
        ge=1,
        le=60,
        description="Duration of each video chunk in minutes (1-60). Defaults to server setting if not provided."
    )


class QueryRequest(BaseModel):
    """Request for clip search query."""
    query: str = Field(..., description="Search query text")
    n_results: Optional[int] = Field(5, ge=1, le=50, description="Number of results to return")
    target_date: Optional[date] = Field(
        None,
        description="Specific date to search (YYYY-MM-DD). If not provided, searches last 24 hours."
    )


class AnalysisRequest(BaseModel):
    """Request for video analysis."""
    query: str = Field(..., description="Analysis query text")
    n_results: Optional[int] = Field(5, ge=1, le=50, description="Number of videos to analyze")
    target_date: Optional[date] = Field(
        None,
        description="Specific date to search (YYYY-MM-DD). If not provided, searches last 24 hours."
    )


class CreateAlertRequest(BaseModel):
    """Request to create an alert."""
    query: str = Field(..., description="Alert query text (what to alert on)")
    enabled: Optional[bool] = Field(True, description="Whether alert is enabled")


class UpdateAlertRequest(BaseModel):
    """Request to update an alert."""
    query: Optional[str] = Field(None, description="Alert query text")
    enabled: Optional[bool] = Field(None, description="Whether alert is enabled")


class RegisterRequest(BaseModel):
    """Request to register a new user."""
    email: str = Field(..., description="User email address", min_length=3)
    password: str = Field(..., description="User password", min_length=6)


class LoginRequest(BaseModel):
    """Request to login."""
    email: str = Field(..., description="User email address")
    password: str = Field(..., description="User password")
