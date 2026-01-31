"""Authentication API routes."""
import logging

from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.api.models.requests import RegisterRequest, LoginRequest
from app.api.models.responses import TokenResponse, UserResponse
from app.services.auth_service import AuthService
from app.services.user_service import UserService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()


def get_auth_service() -> AuthService:
    """Get AuthService instance."""
    return AuthService()


def get_user_service() -> UserService:
    """Get UserService instance."""
    return UserService()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    request: RegisterRequest,
    auth_service: AuthService = Depends(get_auth_service)
) -> TokenResponse:
    """
    Register a new user.
    
    Args:
        request: Registration request with email and password
        auth_service: AuthService instance
        
    Returns:
        Token response with access token and user info
        
    Raises:
        HTTPException: If registration fails
    """
    try:
        # Create user
        user_service = UserService()
        user = user_service.create_user(
            email=request.email,
            password=request.password
        )
        
        # Generate token
        token = auth_service.create_access_token(
            user_id=user["id"],
            email=user["email"]
        )
        
        logger.info(f"User registered: {user['email']}")
        
        return TokenResponse(
            access_token=token,
            token_type="bearer",
            user=UserResponse(
                id=user["id"],
                email=user["email"],
                created_at=user["created_at"]
            )
        )
        
    except ValueError as e:
        logger.warning(f"Registration failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error during registration: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed"
        ) from e


@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    auth_service: AuthService = Depends(get_auth_service)
) -> TokenResponse:
    """
    Login user and get access token.
    
    Args:
        request: Login request with email and password
        auth_service: AuthService instance
        
    Returns:
        Token response with access token and user info
        
    Raises:
        HTTPException: If login fails
    """
    user = auth_service.authenticate_user(
        email=request.email,
        password=request.password
    )
    
    if not user:
        logger.warning(f"Login failed for email: {request.email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Generate token
    token = auth_service.create_access_token(
        user_id=user["id"],
        email=user["email"]
    )
    
    logger.info(f"User logged in: {user['email']}")
    
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=user["id"],
            email=user["email"],
            created_at=user["created_at"]
        )
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    auth_service: AuthService = Depends(get_auth_service)
) -> UserResponse:
    """
    Get current authenticated user information.
    
    Args:
        credentials: HTTP Bearer token credentials
        auth_service: AuthService instance
        
    Returns:
        Current user information
        
    Raises:
        HTTPException: If token is invalid
    """
    user = auth_service.get_current_user(credentials.credentials)
    
    return UserResponse(
        id=user["id"],
        email=user["email"],
        created_at=user["created_at"]
    )
