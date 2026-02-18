import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { alertsApi } from '../utils/api';

const AlertsPage = ({ onBack }) => {
  const [alerts, setAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateAlert, setShowCreateAlert] = useState(false);
  const [newAlertQuery, setNewAlertQuery] = useState('');
  const [activeTab, setActiveTab] = useState('alerts'); // 'alerts' or 'history'

  useEffect(() => {
    fetchAlerts();
    fetchAlertHistory();
  }, []);

  const fetchAlerts = async () => {
    try {
      const data = await alertsApi.list();
      setAlerts(data.alerts || []);
    } catch (error) {
      console.error('Error fetching alerts:', error);
      Alert.alert('Error', 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  const fetchAlertHistory = async () => {
    try {
      const data = await alertsApi.history(100);
      setAlertHistory(data.history || []);
    } catch (error) {
      console.error('Error fetching alert history:', error);
      // Don't show alert for empty history - just set empty array
      setAlertHistory([]);
    }
  };

  const createAlert = async () => {
    if (!newAlertQuery.trim()) {
      Alert.alert('Error', 'Please enter an alert query');
      return;
    }

    try {
      await alertsApi.create(newAlertQuery.trim());
      setNewAlertQuery('');
      setShowCreateAlert(false);
      fetchAlerts();
      Alert.alert('Success', 'Alert created successfully');
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to create alert');
    }
  };

  const toggleAlert = async (alertId, currentEnabled) => {
    try {
      await alertsApi.update(alertId, { enabled: !currentEnabled });
      fetchAlerts();
    } catch (error) {
      Alert.alert('Error', 'Failed to update alert');
    }
  };

  const deleteAlert = async (alertId) => {
    Alert.alert(
      'Delete Alert',
      'Are you sure you want to delete this alert?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await alertsApi.remove(alertId);
              fetchAlerts();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete alert');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Alerts</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6b7280" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Alerts</Text>
        <TouchableOpacity
          onPress={() => setShowCreateAlert(true)}
          style={styles.addButton}
        >
          <Ionicons name="add" size={24} color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'alerts' && styles.tabActive]}
          onPress={() => setActiveTab('alerts')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'alerts' && styles.tabTextActive,
            ]}
          >
            Active Alerts
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && styles.tabActive]}
          onPress={() => setActiveTab('history')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'history' && styles.tabTextActive,
            ]}
          >
            History
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === 'alerts' ? (
          <View style={styles.alertsList}>
            {alerts.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="notifications-off-outline" size={48} color="#404040" />
                <Text style={styles.emptyText}>No alerts configured</Text>
                <Text style={styles.emptySubtext}>
                  Create an alert to get notified when specific events occur
                </Text>
              </View>
            ) : (
              alerts.map((alert) => (
                <View key={alert.id} style={styles.alertCard}>
                  <View style={styles.alertContent}>
                    <Text style={styles.alertQuery}>{alert.query}</Text>
                    <View style={styles.alertMeta}>
                      <Text style={styles.alertMetaText}>
                        Triggered {alert.trigger_count} times
                      </Text>
                      <Text style={styles.alertMetaText}>•</Text>
                      <Text style={styles.alertMetaText}>
                        {new Date(alert.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.alertActions}>
                    <TouchableOpacity
                      onPress={() => toggleAlert(alert.id, alert.enabled)}
                      style={[
                        styles.toggleButton,
                        alert.enabled && styles.toggleButtonActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.toggleButtonText,
                          alert.enabled && styles.toggleButtonTextActive,
                        ]}
                      >
                        {alert.enabled ? 'Enabled' : 'Disabled'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => deleteAlert(alert.id)}
                      style={styles.deleteButton}
                    >
                      <Ionicons name="trash-outline" size={20} color="#ff4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : (
          <View style={styles.historyList}>
            {alertHistory.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="time-outline" size={48} color="#404040" />
                <Text style={styles.emptyText}>No alert history</Text>
                <Text style={styles.emptySubtext}>
                  Alert triggers will appear here
                </Text>
              </View>
            ) : (
              alertHistory.map((entry) => (
                <View key={entry.id} style={styles.historyCard}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyQuery}>{entry.alert_query}</Text>
                    <Text style={styles.historyTime}>
                      {new Date(entry.timestamp).toLocaleString()}
                    </Text>
                  </View>
                  {entry.analysis_snippet && (
                    <Text style={styles.historySnippet} numberOfLines={2}>
                      {entry.analysis_snippet}
                    </Text>
                  )}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Create Alert Modal */}
      {showCreateAlert && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Alert</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateAlert(false);
                  setNewAlertQuery('');
                }}
              >
                <Ionicons name="close" size={24} color="#808080" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter alert query (e.g., 'person enters room')"
              placeholderTextColor="#606060"
              value={newAlertQuery}
              onChangeText={setNewAlertQuery}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowCreateAlert(false);
                  setNewAlertQuery('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreateButton}
                onPress={createAlert}
              >
                <LinearGradient
                  colors={['rgba(107, 114, 128, 0.2)', 'rgba(75, 85, 99, 0.15)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.modalCreateGradient}
                >
                  <Text style={styles.modalCreateText}>Create</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15, 23, 42, 0.06)',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    letterSpacing: 0.5,
  },
  addButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  tabActive: {
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(107, 114, 128, 0.2)',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#4b5563',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertsList: {
    gap: 12,
  },
  alertCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  alertContent: {
    marginBottom: 12,
  },
  alertQuery: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  alertMeta: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  alertMetaText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  alertActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  toggleButtonActive: {
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(107, 114, 128, 0.2)',
  },
  toggleButtonText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '500',
  },
  toggleButtonTextActive: {
    color: '#4b5563',
  },
  deleteButton: {
    padding: 8,
  },
  historyList: {
    gap: 12,
  },
  historyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  historyHeader: {
    marginBottom: 8,
  },
  historyQuery: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  historyTime: {
    color: '#9ca3af',
    fontSize: 12,
  },
  historySnippet: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '600',
  },
  modalInput: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    color: '#111827',
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  modalCancelText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '500',
  },
  modalCreateButton: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  modalCreateGradient: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCreateText: {
    color: '#4b5563',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default AlertsPage;
