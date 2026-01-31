"""Custom exception classes."""
from typing import Optional


class InspectreException(Exception):
    """Base exception for Inspectre application."""
    pass


class VideoRecordingError(InspectreException):
    """Error during video recording."""
    pass


class R2UploadError(InspectreException):
    """Error during R2 upload."""
    pass


class QwenAPIError(InspectreException):
    """Error calling Qwen API."""
    pass


class ChromaDBError(InspectreException):
    """Error with ChromaDB operations."""
    pass


class ConfigurationError(InspectreException):
    """Configuration error."""
    pass
