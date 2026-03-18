import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  RefreshControl,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { autopilotApi } from '../utils/api';

const MAX_RANGE_HOURS = 24;

function formatAutopilotChunkRange(startIso, endIso) {
  if (!startIso || !endIso) return '–';
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let datePrefix = '';
    if (startDay.getTime() === today.getTime()) datePrefix = 'Today, ';
    else if (startDay.getTime() === yesterday.getTime()) datePrefix = 'Yesterday, ';
    else if (start.getFullYear() === now.getFullYear())
      datePrefix = start.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ';
    else
      datePrefix = start.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ', ';
    const fmt = { hour: 'numeric', minute: '2-digit' };
    return `${datePrefix}${start.toLocaleTimeString([], fmt)} – ${end.toLocaleTimeString([], fmt)}`;
  } catch {
    return startIso || '–';
  }
}

function toISO(date) {
  return date.toISOString();
}

function defaultRange() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

function formatDateTimeForDisplay(d) {
  if (!d || !(d instanceof Date)) return 'Tap to select';
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

const AutopilotPage = ({ onBack }) => {
  const [config, setConfig] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [startPickerStage, setStartPickerStage] = useState('date'); // 'date' | 'time'
  const [endPickerStage, setEndPickerStage] = useState('date'); // 'date' | 'time'
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');
  const [selectedChunkId, setSelectedChunkId] = useState(null);
  const [detailResult, setDetailResult] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const data = await autopilotApi.getConfig();
      if (data && data.prompt) {
        setConfig(data);
        setPrompt(data.prompt);
        const start = new Date(data.range_start_iso);
        const end = new Date(data.range_end_iso);
        setRangeStart(start);
        setRangeEnd(end);
      } else {
        const { start, end } = defaultRange();
        setRangeStart(start);
        setRangeEnd(end);
      }
    } catch (e) {
      console.error('Autopilot config load:', e);
      const { start, end } = defaultRange();
      setRangeStart(start);
      setRangeEnd(end);
    }
  }, []);

  const loadResults = useCallback(async () => {
    try {
      const list = await autopilotApi.listResponses();
      setResults(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error('Autopilot results load:', e);
      setResults([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadConfig(), loadResults()]);
    setLoading(false);
  }, [loadConfig, loadResults]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConfig();
    await loadResults();
    setRefreshing(false);
  }, [loadConfig, loadResults]);

  const saveConfig = async () => {
    if (!prompt.trim()) {
      Alert.alert('Error', 'Please enter an autopilot prompt');
      return;
    }
    const start = rangeStart || defaultRange().start;
    const end = rangeEnd || defaultRange().end;
    if (end <= start) {
      Alert.alert('Error', 'End time must be after start time');
      return;
    }
    const hours = (end - start) / (60 * 60 * 1000);
    if (hours > MAX_RANGE_HOURS) {
      Alert.alert('Error', `Time range must be at most ${MAX_RANGE_HOURS} hours`);
      return;
    }
    setSaving(true);
    try {
      await autopilotApi.setConfig({
        prompt: prompt.trim(),
        range_start_iso: toISO(start),
        range_end_iso: toISO(end),
      });
      setConfig({ prompt: prompt.trim(), range_start_iso: toISO(start), range_end_iso: toISO(end) });
      Alert.alert('Saved', 'Autopilot is active. Chunks in this time range will be analyzed as they are recorded.');
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to save autopilot');
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (chunkId) => {
    setSelectedChunkId(chunkId);
    setDetailResult(null);
    try {
      const r = await autopilotApi.getResponse(chunkId);
      setDetailResult(r);
    } catch (e) {
      setDetailResult({ error: e.message || 'Failed to load' });
    }
  };

  const closeDetail = () => {
    setSelectedChunkId(null);
    setDetailResult(null);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Autopilot</Text>
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
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Autopilot</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'settings' && styles.tabActive]}
          onPress={() => setActiveTab('settings')}
        >
          <Text style={[styles.tabText, activeTab === 'settings' && styles.tabTextActive]}>
            Settings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'responses' && styles.tabActive]}
          onPress={() => setActiveTab('responses')}
        >
          <Text style={[styles.tabText, activeTab === 'responses' && styles.tabTextActive]}>
            Responses
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6b7280']} />
        }
      >
        {activeTab === 'settings' ? (
          <View style={styles.settingsSection}>
            <Text style={styles.label}>Autopilot prompt</Text>
            <TextInput
              style={styles.promptInput}
              value={prompt}
              onChangeText={setPrompt}
              placeholder="e.g. Summarize any motion or notable events"
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
            />
            <Text style={styles.label}>Time range (max 24 hours)</Text>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>Start</Text>
              <TouchableOpacity
                style={styles.timeInput}
                onPress={() => {
                  setStartPickerStage('date');
                  setShowStartPicker(true);
                }}
              >
                <Text style={[styles.timeInputText, !rangeStart && styles.timeInputPlaceholder]}>
                  {formatDateTimeForDisplay(rangeStart)}
                </Text>
                <Ionicons name="calendar-outline" size={18} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>End</Text>
              <TouchableOpacity
                style={styles.timeInput}
                onPress={() => {
                  setEndPickerStage('date');
                  setShowEndPicker(true);
                }}
              >
                <Text style={[styles.timeInputText, !rangeEnd && styles.timeInputPlaceholder]}>
                  {formatDateTimeForDisplay(rangeEnd)}
                </Text>
                <Ionicons name="calendar-outline" size={18} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              Tap to select date and time. Max 24 hours. Chunks in this range are analyzed as they finish.
            </Text>

            {showStartPicker && (
              Platform.OS === 'android' ? (
                <DateTimePicker
                  value={rangeStart || new Date()}
                  mode={startPickerStage === 'date' ? 'date' : 'time'}
                  onChange={(e, date) => {
                    if (e.type === 'dismissed') {
                      // If user cancels at any stage, close the picker flow
                      setShowStartPicker(false);
                      setStartPickerStage('date');
                      return;
                    }
                    if (!date) {
                      return;
                    }

                    if (startPickerStage === 'date') {
                      const base = rangeStart || new Date();
                      const picked = new Date(date);
                      // Keep the existing time (or current time) but apply picked date
                      const newStart = new Date(
                        picked.getFullYear(),
                        picked.getMonth(),
                        picked.getDate(),
                        base.getHours(),
                        base.getMinutes(),
                        0,
                        0,
                      );
                      setRangeStart(newStart);
                      // Move to time selection without closing the flow
                      setStartPickerStage('time');
                    } else {
                      const base = rangeStart || new Date();
                      const picked = new Date(date);
                      const newStart = new Date(
                        base.getFullYear(),
                        base.getMonth(),
                        base.getDate(),
                        picked.getHours(),
                        picked.getMinutes(),
                        0,
                        0,
                      );
                      setRangeStart(newStart);
                      setShowStartPicker(false);
                      setStartPickerStage('date');
                    }
                  }}
                />
              ) : (
                <Modal visible transparent animationType="fade">
                  <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowStartPicker(false)}>
                    <View style={styles.pickerContainer} onStartShouldSetResponder={() => true}>
                      <DateTimePicker
                        value={rangeStart || new Date()}
                        mode="datetime"
                        display="spinner"
                        onChange={(e, date) => date && setRangeStart(date)}
                      />
                      <TouchableOpacity style={styles.pickerDone} onPress={() => setShowStartPicker(false)}>
                        <Text style={styles.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                </Modal>
              )
            )}
            {showEndPicker && (
              Platform.OS === 'android' ? (
                <DateTimePicker
                  value={rangeEnd || rangeStart || new Date()}
                  mode={endPickerStage === 'date' ? 'date' : 'time'}
                  onChange={(e, date) => {
                    if (e.type === 'dismissed') {
                      setShowEndPicker(false);
                      setEndPickerStage('date');
                      return;
                    }
                    if (!date) {
                      return;
                    }

                    if (endPickerStage === 'date') {
                      const base = rangeEnd || rangeStart || new Date();
                      const picked = new Date(date);
                      const newEnd = new Date(
                        picked.getFullYear(),
                        picked.getMonth(),
                        picked.getDate(),
                        base.getHours(),
                        base.getMinutes(),
                        0,
                        0,
                      );
                      setRangeEnd(newEnd);
                      setEndPickerStage('time');
                    } else {
                      const base = rangeEnd || rangeStart || new Date();
                      const picked = new Date(date);
                      const newEnd = new Date(
                        base.getFullYear(),
                        base.getMonth(),
                        base.getDate(),
                        picked.getHours(),
                        picked.getMinutes(),
                        0,
                        0,
                      );
                      setRangeEnd(newEnd);
                      setShowEndPicker(false);
                      setEndPickerStage('date');
                    }
                  }}
                />
              ) : (
                <Modal visible transparent animationType="fade">
                  <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowEndPicker(false)}>
                    <View style={styles.pickerContainer} onStartShouldSetResponder={() => true}>
                      <DateTimePicker
                        value={rangeEnd || rangeStart || new Date()}
                        mode="datetime"
                        display="spinner"
                        onChange={(e, date) => date && setRangeEnd(date)}
                      />
                      <TouchableOpacity style={styles.pickerDone} onPress={() => setShowEndPicker(false)}>
                        <Text style={styles.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                </Modal>
              )
            )}
            <TouchableOpacity
              style={styles.saveButton}
              onPress={saveConfig}
              disabled={saving}
            >
              <LinearGradient
                colors={['rgba(107, 114, 128, 0.25)', 'rgba(75, 85, 99, 0.2)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.saveGradient}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#4b5563" />
                ) : (
                  <Text style={styles.saveButtonText}>Save autopilot</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.resultsList}>
            {results.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={48} color="#404040" />
                <Text style={styles.emptyText}>No autopilot responses yet</Text>
                <Text style={styles.emptySubtext}>
                  Set a prompt and time range in Settings. Responses appear here as chunks are processed.
                </Text>
              </View>
            ) : (
              results.map((r) => (
                <TouchableOpacity
                  key={r.chunk_id}
                  style={styles.card}
                  onPress={() => openDetail(r.chunk_id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cardTime}>
                    {formatAutopilotChunkRange(r.chunk_start_iso, r.chunk_end_iso)}
                  </Text>
                  <Text style={styles.cardSnippet} numberOfLines={2}>
                    {r.error ? `Error: ${r.error}` : (r.analysis || '–')}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!selectedChunkId} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {detailResult ? formatAutopilotChunkRange(detailResult.chunk_start_iso, detailResult.chunk_end_iso) : '…'}
              </Text>
              <TouchableOpacity onPress={closeDetail} style={styles.closeButton}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={true}>
              {!detailResult ? (
                <ActivityIndicator size="small" color="#6b7280" />
              ) : detailResult.error ? (
                <Text style={styles.detailError}>{detailResult.error}</Text>
              ) : (
                <Text style={styles.detailText}>{detailResult.analysis || '–'}</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15, 23, 42, 0.06)',
  },
  backButton: { padding: 8, minWidth: 40 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#111827' },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    gap: 8,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(107, 114, 128, 0.2)',
  },
  tabText: { fontSize: 14, fontWeight: '500', color: '#6b7280' },
  tabTextActive: { color: '#4b5563' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  settingsSection: { gap: 12 },
  label: { fontSize: 14, fontWeight: '500', color: '#374151' },
  promptInput: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 12,
    color: '#111827',
    fontSize: 15,
    minHeight: 88,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeLabel: { fontSize: 14, color: '#6b7280', width: 40 },
  timeInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  timeInputText: { fontSize: 14, color: '#111827' },
  timeInputPlaceholder: { color: '#9ca3af' },
  hint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'flex-end',
  },
  pickerContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  pickerDone: {
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(15, 23, 42, 0.06)',
  },
  pickerDoneText: { fontSize: 16, fontWeight: '600', color: '#4b5563' },
  saveButton: { marginTop: 16, borderRadius: 10, overflow: 'hidden' },
  saveGradient: { paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { fontSize: 15, fontWeight: '600', color: '#4b5563' },
  resultsList: { gap: 12 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  cardTime: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 8 },
  cardSnippet: { fontSize: 13, color: '#6b7280', lineHeight: 20 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { color: '#6b7280', fontSize: 16, fontWeight: '500', marginTop: 16, marginBottom: 8 },
  emptySubtext: { color: '#9ca3af', fontSize: 14, textAlign: 'center' },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#111827' },
  closeButton: { padding: 8 },
  modalBody: { maxHeight: 400 },
  detailText: { fontSize: 15, color: '#374151', lineHeight: 22 },
  detailError: { fontSize: 14, color: '#dc2626' },
});

export default AutopilotPage;
