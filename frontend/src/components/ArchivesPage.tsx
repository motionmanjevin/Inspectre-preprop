import { useState, useEffect } from "react";
import { Trash2, MessageSquare, Eye, Bell, Plus, X } from "lucide-react";
import { alertsApi, getAuthToken } from "../services/api";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
  videoResult?: {
    camera: string;
    timestamp: string;
    description: string;
    videoUrl: string;
  };
}

export interface ArchivedConversation {
  id: string;
  messages: Message[];
  archivedAt: Date;
  preview: string;
}

interface Alert {
  id: string;
  query: string;
  enabled: boolean;
  created_at: string;
  trigger_count: number;
}

interface AlertHistory {
  id: string;
  alert_id: string;
  alert_query: string;
  video_url: string;
  local_path?: string;
  timestamp: string;
  analysis_snippet?: string;
}

export function ArchivesPage({ 
  archives, 
  onDeleteArchive,
  onRestoreArchive 
}: { 
  archives: ArchivedConversation[];
  onDeleteArchive: (id: string) => void;
  onRestoreArchive: (conversation: ArchivedConversation) => void;
}) {
  const [selectedArchive, setSelectedArchive] = useState<ArchivedConversation | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"archives" | "alerts">("archives");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertHistory, setAlertHistory] = useState<AlertHistory[]>([]);
  const [showCreateAlert, setShowCreateAlert] = useState(false);
  const [newAlertQuery, setNewAlertQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDelete = (id: string) => {
    onDeleteArchive(id);
    setShowDeleteConfirm(null);
    if (selectedArchive?.id === id) {
      setSelectedArchive(null);
    }
  };

  const handleRestore = (conversation: ArchivedConversation) => {
    onRestoreArchive(conversation);
  };

  // Fetch alerts and history
  useEffect(() => {
    if (activeTab === "alerts") {
      fetchAlerts();
      fetchAlertHistory();
    }
  }, [activeTab]);

  const fetchAlerts = async () => {
    try {
      const data = await alertsApi.list();
      setAlerts(data.alerts || []);
    } catch (error) {
      console.error("Error fetching alerts:", error);
    }
  };

  const fetchAlertHistory = async () => {
    try {
      const data = await alertsApi.history(100);
      setAlertHistory(data.history || []);
    } catch (error) {
      console.error("Error fetching alert history:", error);
    }
  };

  const createAlert = async () => {
    if (!newAlertQuery.trim()) return;
    
    setLoading(true);
    try {
      await alertsApi.create(newAlertQuery.trim());
      setNewAlertQuery("");
      setShowCreateAlert(false);
      fetchAlerts();
    } catch (error) {
      console.error("Error creating alert:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAlert = async (alertId: string, currentEnabled: boolean) => {
    try {
      await alertsApi.update(alertId, { enabled: !currentEnabled });
      fetchAlerts();
    } catch (error) {
      console.error("Error toggling alert:", error);
    }
  };

  const deleteAlert = async (alertId: string) => {
    try {
      await alertsApi.remove(alertId);
      fetchAlerts();
      fetchAlertHistory();
    } catch (error) {
      console.error("Error deleting alert:", error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl text-white mb-2">Archives</h1>
        <p className="text-gray-400">View archived conversations and manage alerts</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-[#1a1a1a]">
        <button
          onClick={() => setActiveTab("archives")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "archives"
              ? "text-white border-b-2 border-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Conversations
        </button>
        <button
          onClick={() => setActiveTab("alerts")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "alerts"
              ? "text-white border-b-2 border-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Alerts
        </button>
      </div>

      {activeTab === "alerts" ? (
        <div className="space-y-6">
          {/* Alerts List */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl text-white">Active Alerts</h2>
              <button
                onClick={() => setShowCreateAlert(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-200 text-[#0a0a0a] rounded-lg text-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Alert
              </button>
            </div>

            {alerts.length === 0 ? (
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-8 text-center">
                <Bell className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No alerts configured</p>
                <p className="text-gray-600 text-sm mt-2">Create an alert to be notified when specific events occur</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-white text-sm mb-2">{alert.query}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Triggered {alert.trigger_count} times</span>
                          <span>•</span>
                          <span>Created {new Date(alert.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleAlert(alert.id, alert.enabled)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            alert.enabled
                              ? "bg-green-600 hover:bg-green-700 text-white"
                              : "bg-[#1a1a1a] hover:bg-[#2a2a2a] text-gray-400"
                          }`}
                        >
                          {alert.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          onClick={() => deleteAlert(alert.id)}
                          className="p-1.5 hover:bg-[#1a1a1a] rounded-lg transition-colors"
                          title="Delete alert"
                        >
                          <X className="w-4 h-4 text-gray-500 hover:text-red-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Alert History */}
          <div>
            <h2 className="text-xl text-white mb-4">Alert History</h2>
            {alertHistory.length === 0 ? (
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-8 text-center">
                <p className="text-gray-400">No alerts triggered yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alertHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-white text-sm font-medium mb-1">{entry.alert_query}</p>
                        {entry.analysis_snippet && (
                          <p className="text-gray-400 text-xs mb-2 line-clamp-2">{entry.analysis_snippet}</p>
                        )}
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{new Date(entry.timestamp).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      {entry.local_path && (() => {
                        const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
                        const token = getAuthToken();
                        const href = `${API_BASE_URL}/videos/${encodeURIComponent(String(entry.local_path))}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
                        return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white rounded-lg text-xs transition-colors"
                        >
                          View Video
                        </a>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {archives.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="mb-6">
            <MessageSquare className="w-16 h-16 text-gray-600" />
          </div>
          <p className="text-gray-400 text-lg">No archived conversations yet</p>
          <p className="text-gray-600 text-sm mt-2">Your cleared chats will appear here</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Archives List */}
          <div className="space-y-3">
            {archives.map((archive) => (
              <div
                key={archive.id}
                className={`bg-[#0f0f0f] border rounded-xl p-4 transition-colors cursor-pointer ${
                  selectedArchive?.id === archive.id
                    ? 'border-white'
                    : 'border-[#1a1a1a] hover:border-[#2a2a2a]'
                }`}
                onClick={() => setSelectedArchive(archive)}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm mb-1 line-clamp-2">{archive.preview}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{new Date(archive.archivedAt).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>{new Date(archive.archivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>•</span>
                      <span>{archive.messages.length} messages</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(archive.id);
                    }}
                    className="p-2 hover:bg-[#1a1a1a] rounded-lg transition-colors flex-shrink-0"
                    title="Delete archive"
                  >
                    <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Archive Viewer */}
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-6 sticky top-4 h-fit max-h-[calc(100vh-8rem)] overflow-y-auto">
            {selectedArchive ? (
              <>
                <div className="flex items-start justify-between gap-3 mb-6 pb-4 border-b border-[#1a1a1a]">
                  <div>
                    <p className="text-white text-sm mb-2">
                      {new Date(selectedArchive.archivedAt).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {selectedArchive.messages.length} messages
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(selectedArchive)}
                    className="px-4 py-2 bg-white hover:bg-gray-200 text-[#0a0a0a] rounded-lg text-sm transition-colors"
                  >
                    Restore
                  </button>
                </div>

                {/* Messages */}
                <div className="space-y-4">
                  {selectedArchive.messages.map((message) => (
                    <div key={message.id} className="w-full">
                      {message.sender === "user" ? (
                        <div className="flex justify-end">
                          <div className="max-w-[85%]">
                            <div className="bg-[#00ff88] text-[#0a0a0a] rounded-2xl px-4 py-2">
                              <p className="text-sm leading-relaxed">{message.text}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="max-w-[85%]">
                          <div className="text-white">
                            <p className="text-sm leading-relaxed mb-1">{message.text}</p>
                          </div>
                          
                          {message.videoResult && (
                            <div className="mt-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                                <span className="text-white text-xs">{message.videoResult.camera}</span>
                              </div>
                              <p className="text-gray-400 text-xs mb-1">{message.videoResult.description}</p>
                              <span className="text-gray-600 text-xs">{message.videoResult.timestamp}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Eye className="w-12 h-12 text-gray-600 mb-3" />
                <p className="text-gray-400">Select a conversation to view</p>
              </div>
            )}
          </div>
        </div>
          )}
        </>
      )}

      {/* Create Alert Dialog */}
      {showCreateAlert && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateAlert(false)}>
          <div className="bg-[#0f0f0f] rounded-2xl border border-[#1a1a1a] p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-lg mb-2">Create Alert</h3>
            <p className="text-gray-400 text-sm mb-4">
              Enter a natural language description of what you want to be alerted about (e.g., "alert me anytime a customer enters the saloon")
            </p>
            <textarea
              value={newAlertQuery}
              onChange={(e) => setNewAlertQuery(e.target.value)}
              placeholder="e.g., alert me anytime a customer enters the saloon"
              className="w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-3 text-white text-sm mb-4 resize-none focus:outline-none focus:border-white"
              rows={3}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateAlert(false);
                  setNewAlertQuery("");
                }}
                className="flex-1 px-4 py-2 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createAlert}
                disabled={loading || !newAlertQuery.trim()}
                className="flex-1 px-4 py-2 bg-white hover:bg-gray-200 text-[#0a0a0a] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-[#0f0f0f] rounded-2xl border border-[#1a1a1a] p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-lg mb-2">Delete Archive?</h3>
            <p className="text-gray-400 text-sm mb-6">
              This conversation will be permanently deleted and cannot be recovered.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 px-4 py-2 bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
