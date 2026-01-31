"""Alert management service."""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional
import uuid

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class AlertService:
    """Manages alert rules and history."""
    
    def __init__(self, alerts_file: Optional[str] = None, history_file: Optional[str] = None):
        """
        Initialize alert service.
        
        Args:
            alerts_file: Path to alerts JSON file
            history_file: Path to alert history JSON file
        """
        settings = get_settings()
        self.alerts_file = Path(alerts_file or "alerts.json")
        self.history_file = Path(history_file or "alert_history.json")
        
        # Create files if they don't exist
        if not self.alerts_file.exists():
            self._save_alerts({})
        if not self.history_file.exists():
            self._save_history([])
        
        logger.info("AlertService initialized")
    
    def _load_alerts(self) -> Dict[str, Dict]:
        """Load alerts from file."""
        try:
            if self.alerts_file.exists():
                with open(self.alerts_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return {}
        except Exception as e:
            logger.error(f"Error loading alerts: {e}")
            return {}
    
    def _save_alerts(self, alerts: Dict[str, Dict]) -> None:
        """Save alerts to file."""
        try:
            with open(self.alerts_file, 'w', encoding='utf-8') as f:
                json.dump(alerts, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"Error saving alerts: {e}")
            raise
    
    def _load_history(self) -> List[Dict]:
        """Load alert history from file."""
        try:
            if self.history_file.exists():
                with open(self.history_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return []
        except Exception as e:
            logger.error(f"Error loading alert history: {e}")
            return []
    
    def _save_history(self, history: List[Dict]) -> None:
        """Save alert history to file."""
        try:
            with open(self.history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"Error saving alert history: {e}")
            raise
    
    def create_alert(self, query: str, enabled: bool = True) -> Dict:
        """
        Create a new alert.
        
        Args:
            query: Alert query text
            enabled: Whether alert is enabled
            
        Returns:
            Created alert dictionary
        """
        alerts = self._load_alerts()
        alert_id = str(uuid.uuid4())
        
        alert = {
            "id": alert_id,
            "query": query,
            "enabled": enabled,
            "created_at": datetime.now().isoformat(),
            "trigger_count": 0
        }
        
        alerts[alert_id] = alert
        self._save_alerts(alerts)
        logger.info(f"Created alert: {alert_id} - {query}")
        return alert
    
    def get_alert(self, alert_id: str) -> Optional[Dict]:
        """Get alert by ID."""
        alerts = self._load_alerts()
        return alerts.get(alert_id)
    
    def get_all_alerts(self) -> List[Dict]:
        """Get all alerts."""
        alerts = self._load_alerts()
        return list(alerts.values())
    
    def get_enabled_alerts(self) -> List[Dict]:
        """Get all enabled alerts."""
        alerts = self._load_alerts()
        return [alert for alert in alerts.values() if alert.get("enabled", True)]
    
    def update_alert(self, alert_id: str, query: Optional[str] = None, enabled: Optional[bool] = None) -> Optional[Dict]:
        """
        Update an alert.
        
        Args:
            alert_id: Alert ID
            query: New query text (optional)
            enabled: New enabled state (optional)
            
        Returns:
            Updated alert dictionary or None if not found
        """
        alerts = self._load_alerts()
        if alert_id not in alerts:
            return None
        
        if query is not None:
            alerts[alert_id]["query"] = query
        if enabled is not None:
            alerts[alert_id]["enabled"] = enabled
        
        self._save_alerts(alerts)
        logger.info(f"Updated alert: {alert_id}")
        return alerts[alert_id]
    
    def delete_alert(self, alert_id: str) -> bool:
        """
        Delete an alert.
        
        Args:
            alert_id: Alert ID
            
        Returns:
            True if deleted, False if not found
        """
        alerts = self._load_alerts()
        if alert_id not in alerts:
            return False
        
        del alerts[alert_id]
        self._save_alerts(alerts)
        logger.info(f"Deleted alert: {alert_id}")
        return True
    
    def add_alert_history(
        self,
        alert_id: str,
        alert_query: str,
        video_url: str,
        local_path: Optional[str] = None,
        analysis_snippet: Optional[str] = None
    ) -> None:
        """
        Add an alert trigger to history.
        
        Args:
            alert_id: Alert ID that triggered
            alert_query: Alert query text
            video_url: Video URL where alert was triggered
            local_path: Local filename for video serving
            analysis_snippet: Snippet of analysis that triggered alert
        """
        history = self._load_history()
        
        entry = {
            "id": str(uuid.uuid4()),
            "alert_id": alert_id,
            "alert_query": alert_query,
            "video_url": video_url,
            "local_path": local_path,
            "timestamp": datetime.now().isoformat(),
            "analysis_snippet": analysis_snippet
        }
        
        history.insert(0, entry)  # Add to beginning
        
        # Keep only last 1000 entries
        if len(history) > 1000:
            history = history[:1000]
        
        self._save_history(history)
        
        # Update trigger count
        alerts = self._load_alerts()
        if alert_id in alerts:
            alerts[alert_id]["trigger_count"] = alerts[alert_id].get("trigger_count", 0) + 1
            self._save_alerts(alerts)
        
        logger.info(f"Alert triggered: {alert_id} - {alert_query}")
    
    def get_alert_history(self, limit: int = 100) -> List[Dict]:
        """
        Get alert history.
        
        Args:
            limit: Maximum number of entries to return
            
        Returns:
            List of alert history entries
        """
        history = self._load_history()
        return history[:limit]
