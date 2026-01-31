"""Cloudflare R2 upload service."""
import logging
from pathlib import Path
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.utils.exceptions import R2UploadError
from app.core.config import get_settings

logger = logging.getLogger(__name__)


class R2Uploader:
    """Uploads files to Cloudflare R2 and retrieves public URLs."""
    
    def __init__(
        self,
        account_id: Optional[str] = None,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        bucket_name: Optional[str] = None,
        public_url_base: Optional[str] = None
    ):
        """
        Initialize R2 uploader.
        
        Args:
            account_id: Cloudflare account ID
            access_key_id: R2 access key ID
            secret_access_key: R2 secret access key
            bucket_name: R2 bucket name
            public_url_base: Base URL for public access
        """
        settings = get_settings()
        
        self.account_id = account_id or settings.R2_ACCOUNT_ID
        self.bucket_name = bucket_name or settings.R2_BUCKET_NAME
        self.public_url_base = (public_url_base or settings.R2_PUBLIC_URL_BASE).rstrip('/')
        
        if not all([self.account_id, access_key_id or settings.R2_ACCESS_KEY_ID, 
                   secret_access_key or settings.R2_SECRET_ACCESS_KEY, self.bucket_name]):
            raise R2UploadError("R2 credentials not fully configured")
        
        # Configure boto3 for R2
        try:
            self.s3_client = boto3.client(
                's3',
                endpoint_url=f'https://{self.account_id}.r2.cloudflarestorage.com',
                aws_access_key_id=access_key_id or settings.R2_ACCESS_KEY_ID,
                aws_secret_access_key=secret_access_key or settings.R2_SECRET_ACCESS_KEY,
                config=Config(signature_version='s3v4')
            )
            logger.info("R2Uploader initialized successfully")
        except Exception as e:
            raise R2UploadError(f"Failed to initialize R2 client: {str(e)}") from e
    
    def upload_file(self, file_path: str, object_key: Optional[str] = None) -> str:
        """
        Upload a file to R2 and return public URL.
        
        Args:
            file_path: Path to file to upload
            object_key: Optional custom object key. If None, uses filename.
        
        Returns:
            Public URL of uploaded file
        
        Raises:
            R2UploadError: If upload fails
        """
        file_path_obj = Path(file_path)
        
        if not file_path_obj.exists():
            raise R2UploadError(f"File not found: {file_path}")
        
        if object_key is None:
            object_key = file_path_obj.name
        
        try:
            logger.info(f"Uploading {file_path} to R2 as {object_key}")
            self.s3_client.upload_file(
                file_path,
                self.bucket_name,
                object_key,
                ExtraArgs={'ContentType': self._get_content_type(file_path)}
            )
            
            public_url = f"{self.public_url_base}/{object_key}"
            logger.info(f"Upload successful: {public_url}")
            return public_url
            
        except ClientError as e:
            error_msg = f"Failed to upload {file_path} to R2: {str(e)}"
            logger.error(error_msg)
            raise R2UploadError(error_msg) from e
        except Exception as e:
            error_msg = f"Unexpected error uploading {file_path}: {str(e)}"
            logger.error(error_msg)
            raise R2UploadError(error_msg) from e
    
    def _get_content_type(self, file_path: str) -> str:
        """Get content type based on file extension."""
        ext = Path(file_path).suffix.lower()
        content_types = {
            '.avi': 'video/x-msvideo',
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime',
            '.mkv': 'video/x-matroska',
        }
        return content_types.get(ext, 'application/octet-stream')
    
    def delete_file(self, object_key: str) -> None:
        """
        Delete a file from R2.
        
        Args:
            object_key: Object key to delete
        """
        try:
            self.s3_client.delete_object(
                Bucket=self.bucket_name,
                Key=object_key
            )
            logger.info(f"Deleted {object_key} from R2")
        except ClientError as e:
            logger.error(f"Failed to delete {object_key}: {str(e)}")
            raise R2UploadError(f"Failed to delete file: {str(e)}") from e
