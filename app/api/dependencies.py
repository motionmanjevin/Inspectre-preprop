"""API dependencies for route protection."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.services.auth_service import AuthService

security = HTTPBearer()


def get_auth_service() -> AuthService:
    """Get AuthService instance."""
    return AuthService()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    auth_service: AuthService = Depends(get_auth_service)
) -> dict:
    """
    Dependency to get current authenticated user.
    
    Args:
        credentials: HTTP Bearer token credentials
        auth_service: AuthService instance
        
    Returns:
        Current user dictionary
        
    Raises:
        HTTPException: If token is invalid or missing
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = auth_service.get_current_user(credentials.credentials)
    return user
