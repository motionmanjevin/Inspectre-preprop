"""User management service."""
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict
import hashlib

import bcrypt

from app.core.config import get_settings

logger = logging.getLogger(__name__)

PASSWORD_HASH_PREFIX = "bcrypt_sha256$"


class UserService:
    """Manages user accounts and authentication."""
    
    def __init__(self, db_path: Optional[str] = None):
        """
        Initialize user service.
        
        Args:
            db_path: Path to SQLite database file
        """
        settings = get_settings()
        self.db_path = Path(db_path or "users.db")
        self._init_database()
        logger.info("UserService initialized")
    
    def _init_database(self) -> None:
        """Initialize database tables."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                hashed_password TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_login TEXT
            )
        """)
        
        conn.commit()
        conn.close()
    
    def _get_connection(self) -> sqlite3.Connection:
        """Get database connection."""
        return sqlite3.connect(self.db_path)

    def _hash_password(self, password: str) -> str:
        """
        Hash password using bcrypt(sha256(password)).

        Rationale:
        - bcrypt truncates inputs at 72 bytes; pre-hashing removes that limit safely.
        - We store a prefix so we can distinguish this from legacy raw bcrypt hashes.
        """
        digest = hashlib.sha256(password.encode("utf-8")).digest()
        salt = bcrypt.gensalt(rounds=12)
        hashed = bcrypt.hashpw(digest, salt).decode("utf-8")
        return f"{PASSWORD_HASH_PREFIX}{hashed}"

    def _verify_password(self, plain_password: str, stored_hash: str) -> bool:
        """
        Verify password against stored hash.

        Supports:
        - Our new format: "bcrypt_sha256$<bcrypt-hash>"
        - Legacy raw bcrypt hashes: "$2b$..." / "$2a$..." / "$2y$..."
        """
        try:
            if stored_hash.startswith(PASSWORD_HASH_PREFIX):
                bcrypt_hash = stored_hash[len(PASSWORD_HASH_PREFIX):].encode("utf-8")
                digest = hashlib.sha256(plain_password.encode("utf-8")).digest()
                return bcrypt.checkpw(digest, bcrypt_hash)

            # Legacy raw bcrypt hash (note: bcrypt will still truncate >72 bytes inputs)
            return bcrypt.checkpw(plain_password.encode("utf-8"), stored_hash.encode("utf-8"))
        except Exception:
            return False
    
    def create_user(self, email: str, password: str) -> Dict:
        """
        Create a new user.
        
        Args:
            email: User email
            password: Plain text password
            
        Returns:
            Created user dictionary
            
        Raises:
            ValueError: If user already exists
        """
        # Check if user exists
        if self.get_user_by_email(email):
            raise ValueError("User with this email already exists")
        
        # Hash password
        hashed_password = self._hash_password(password)
        
        # Create user
        conn = self._get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT INTO users (email, hashed_password, created_at)
                VALUES (?, ?, ?)
            """, (email.lower(), hashed_password, datetime.now().isoformat()))
            
            conn.commit()
            user_id = cursor.lastrowid
            
            logger.info(f"Created user: {email}")
            
            return {
                "id": user_id,
                "email": email,
                "created_at": datetime.now().isoformat()
            }
        except sqlite3.IntegrityError:
            raise ValueError("User with this email already exists")
        finally:
            conn.close()
    
    def get_user_by_email(self, email: str) -> Optional[Dict]:
        """
        Get user by email.
        
        Args:
            email: User email
            
        Returns:
            User dictionary or None if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, email, hashed_password, created_at, last_login
            FROM users
            WHERE email = ?
        """, (email.lower(),))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                "id": row[0],
                "email": row[1],
                "hashed_password": row[2],
                "created_at": row[3],
                "last_login": row[4]
            }
        return None
    
    def get_user_by_id(self, user_id: int) -> Optional[Dict]:
        """
        Get user by ID.
        
        Args:
            user_id: User ID
            
        Returns:
            User dictionary or None if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, email, hashed_password, created_at, last_login
            FROM users
            WHERE id = ?
        """, (user_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                "id": row[0],
                "email": row[1],
                "hashed_password": row[2],
                "created_at": row[3],
                "last_login": row[4]
            }
        return None
    
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """
        Verify password against hash.
        
        Args:
            plain_password: Plain text password
            hashed_password: Hashed password
            
        Returns:
            True if password matches
        """
        return self._verify_password(plain_password, hashed_password)
    
    def update_last_login(self, user_id: int) -> None:
        """
        Update user's last login timestamp.
        
        Args:
            user_id: User ID
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE users
            SET last_login = ?
            WHERE id = ?
        """, (datetime.now().isoformat(), user_id))
        
        conn.commit()
        conn.close()
