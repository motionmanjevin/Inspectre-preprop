"""JWT authentication service."""
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict

from jose import JWTError, jwt
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.services.user_service import UserService

logger = logging.getLogger(__name__)


class AuthService:
    """Handles JWT token generation and verification."""
    
    def __init__(self):
        """Initialize auth service."""
        self.settings = get_settings()
        self.user_service = UserService()
    
    def create_access_token(self, user_id: int, email: str) -> str:
        """
        Create JWT access token.
        
        Args:
            user_id: User ID
            email: User email
            
        Returns:
            JWT token string
        """
        expire = datetime.utcnow() + timedelta(minutes=self.settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
        
        payload = {
            "sub": str(user_id),  # Subject (user ID)
            "email": email,
            "exp": expire,
            "iat": datetime.utcnow()
        }
        
        token = jwt.encode(
            payload,
            self.settings.JWT_SECRET_KEY,
            algorithm=self.settings.JWT_ALGORITHM
        )
        
        return token
    
    def verify_token(self, token: str) -> Dict:
        """
        Verify and decode JWT token.
        
        Args:
            token: JWT token string
            
        Returns:
            Decoded token payload
            
        Raises:
            HTTPException: If token is invalid or expired
        """
        try:
            payload = jwt.decode(
                token,
                self.settings.JWT_SECRET_KEY,
                algorithms=[self.settings.JWT_ALGORITHM]
            )
            return payload
        except JWTError as e:
            logger.warning(f"Token verification failed: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
    
    def authenticate_user(self, email: str, password: str) -> Optional[Dict]:
        """
        Authenticate user with email and password.
        
        Args:
            email: User email
            password: Plain text password
            
        Returns:
            User dictionary if authenticated, None otherwise
        """
        user = self.user_service.get_user_by_email(email)
        if not user:
            return None
        
        if not self.user_service.verify_password(password, user["hashed_password"]):
            return None
        
        # Update last login
        self.user_service.update_last_login(user["id"])
        
        return {
            "id": user["id"],
            "email": user["email"],
            "created_at": user["created_at"]
        }
    
    def get_current_user(self, token: str) -> Dict:
        """
        Get current user from token.
        
        Args:
            token: JWT token
            
        Returns:
            User dictionary
            
        Raises:
            HTTPException: If token is invalid or user not found
        """
        payload = self.verify_token(token)
        user_id = int(payload.get("sub"))
        
        user = self.user_service.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        return {
            "id": user["id"],
            "email": user["email"],
            "created_at": user["created_at"]
        }
