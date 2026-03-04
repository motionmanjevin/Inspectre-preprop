import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { rawFootageApi, API_BASE_URL, getAuthToken } from '../utils/api';

// Simple timestamp parser (mirrors logic from main App for consistency)
const parseTimestamps = (text) => {
  if (!text) return [];

  const timestamps = [];
  let match;

  // Pattern 1: HH:MM:SS
  const hmsPattern = /(\d{1,2}):(\d{2}):(\d{2})/g;
  while ((match = hmsPattern.exec(text)) !== null) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    timestamps.push({
      seconds: totalSeconds,
      display: match[0],
      original: match[0],
    });
  }

  // Pattern 2: MM:SS
  const msPattern = /(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$|[^\d:])/g;
  while ((match = msPattern.exec(text)) !== null) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    if (minutes < 60) {
      const totalSeconds = minutes * 60 + seconds;
      if (!timestamps.some(t => t.seconds === totalSeconds)) {
        timestamps.push({
          seconds: totalSeconds,
          display: match[0].trim(),
          original: match[0].trim(),
        });
      }
    }
  }

  // Pattern 3: "X minutes Y seconds"
  const minutesSecondsPattern = /(\d+)\s*(?:minutes?|mins?|m)\s*(?:and\s*)?(\d+)?\s*(?:seconds?|secs?|s)?/gi;
  while ((match = minutesSecondsPattern.exec(text)) !== null) {
    const minutes = parseInt(match[1], 10);
    const seconds = match[2] ? parseInt(match[2], 10) : 0;
    const totalSeconds = minutes * 60 + seconds;
    if (!timestamps.some(t => t.seconds === totalSeconds)) {
      timestamps.push({
        seconds: totalSeconds,
        display: `${minutes}:${seconds.toString().padStart(2, '0')}`,
        original: match[0],
      });
    }
  }

  // Pattern 4: "X seconds"
  const secondsPattern = /(\d+)\s*(?:seconds?|secs?|s)(?:\s|$|[^\d])/gi;
  while ((match = secondsPattern.exec(text)) !== null) {
    const seconds = parseInt(match[1], 10);
    if (!timestamps.some(t => t.seconds === seconds)) {
      timestamps.push({
        seconds,
        display: `0:${seconds.toString().padStart(2, '0')}`,
        original: match[0],
      });
    }
  }

  // Sort and dedupe
  const unique = [];
  const seen = new Set();
  timestamps
    .sort((a, b) => a.seconds - b.seconds)
    .forEach(t => {
      if (!seen.has(t.seconds)) {
        seen.add(t.seconds);
        unique.push(t);
      }
    });

  return unique;
};

const RawFootagePage = ({ onBack, onOpenVideo }) => {
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [jobProgress, setJobProgress] = useState(null);

  useEffect(() => {
    fetchChunks();
  }, []);

  const fetchChunks = async () => {
    try {
      setLoading(true);
      // Cleanup any stale temporary raw query concats when refreshing
      try {
        await rawFootageApi.cleanupTemp();
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp raw queries:', cleanupError?.message || cleanupError);
      }
      const data = await rawFootageApi.list();
      setChunks(data.chunks || []);
    } catch (error) {
      console.error('Error fetching raw footage:', error);
      Alert.alert('Error', 'Failed to load raw footage');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const handleQuery = async () => {
    if (!query.trim() || selectedIds.length === 0) return;
    try {
      setSubmitting(true);
      setResults([]);
      setJobProgress(null);

      const start = await rawFootageApi.startJob(query.trim(), selectedIds);
      setJobProgress({ total: start.total_chunks, completed: 0 });

      let done = false;
      while (!done) {
        const status = await rawFootageApi.getJob(start.job_id);
        setResults(status.results || []);
        setActiveResultIndex(0);
        setJobProgress({
          total: status.total_chunks,
          completed: status.completed_chunks,
        });

        if (status.status === 'completed' || status.status === 'failed') {
          done = true;
        } else {
          // Wait briefly before polling again
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    } catch (error) {
      console.error('Error querying raw footage:', error);
      Alert.alert('Error', error.message || 'Failed to analyze raw footage');
      setJobProgress(null);
    } finally {
      setSubmitting(false);
    }
  };

  const renderChunkCard = (chunk) => {
    const isSelected = selectedIds.includes(chunk.id);
    const isLive = !!chunk.is_live;
    const segmentsDone = chunk.segments_done || 0;
    const segmentsTotal = chunk.segments_total || 60;
    const progress =
      isLive && segmentsTotal > 0
        ? Math.min(100, Math.round((segmentsDone / segmentsTotal) * 100))
        : 0;

    return (
      <TouchableOpacity
        key={chunk.id}
        onPress={() => toggleSelect(chunk.id)}
        activeOpacity={0.8}
        style={[
          styles.chunkCard,
          isSelected && styles.chunkCardSelected,
        ]}
      >
        <View style={styles.chunkHeader}>
          <View style={styles.chunkMeta}>
            <Text style={styles.chunkDate}>{chunk.date}</Text>
            <Text style={styles.chunkTime}>{chunk.time}</Text>
          </View>
          {isLive && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>
        {!isLive && chunk.size_bytes > 0 && (
          <Text style={styles.chunkSize}>
            {(chunk.size_bytes / 1024 / 1024).toFixed(1)} MB
          </Text>
        )}
        {isLive && (
          <View style={styles.chunkProgressContainer}>
            <View style={styles.chunkProgressBackground}>
              <LinearGradient
                colors={['#22c55e', '#4ade80']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.chunkProgressFill, { width: `${progress}%` }]}
              />
            </View>
            <Text style={styles.chunkProgressLabel}>
              {segmentsDone} / {segmentsTotal} min
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderResult = (result, index) => {
    const timestamps = parseTimestamps(result.analysis || '');

    const handleTimestampPress = (ts) => {
      if (!onOpenVideo) return;

      const videoUrl = result.video_url || '';
      const videoData = {
        title: `Raw footage ${index + 1}`,
        timestamp: '',
        location: result.local_path || videoUrl,
        videoUrl,
        localPath: result.local_path,
        timestamps,
        initialSeekSeconds: ts.seconds,
      };

      onOpenVideo(videoData, ts.seconds);
    };

    return (
      <View key={index} style={styles.resultCard}>
        <Text style={styles.resultHeader}>
          Footage {index + 1}
          {result.local_path ? ` • ${result.local_path}` : ''}
        </Text>
        {result.error && (
          <Text style={styles.resultError}>{result.error}</Text>
        )}
        {result.analysis && (
          <>
            <Text style={styles.resultText}>{result.analysis}</Text>
            {timestamps.length > 0 && (
              <View style={styles.resultTimestampsContainer}>
                <Text style={styles.resultTimestampsLabel}>Jump to:</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.resultTimestampsScroll}
                >
                  {timestamps.map((ts, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.resultTimestampButton}
                      onPress={() => handleTimestampPress(ts)}
                      activeOpacity={0.7}
                    >
                      <LinearGradient
                        colors={['rgba(107, 114, 128, 0.25)', 'rgba(107, 114, 128, 0.15)', 'rgba(75, 85, 99, 0.1)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.resultTimestampGradient}
                      >
                        <Ionicons name="time-outline" size={14} color="#6b7280" style={styles.resultTimestampIcon} />
                        <Text style={styles.resultTimestampText}>{ts.display}</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Raw Footage</Text>
        <TouchableOpacity onPress={fetchChunks} style={styles.refreshButton}>
          <Ionicons name="refresh" size={22} color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6b7280" />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentInner}
          showsVerticalScrollIndicator={false}
        >
          {/* Chunk list */}
          <Text style={styles.sectionLabel}>Available chunks</Text>
          {chunks.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="film-outline" size={48} color="#9ca3af" />
              <Text style={styles.emptyText}>No raw footage yet</Text>
              <Text style={styles.emptySubtext}>
                Start a raw recording from the web settings page to see footage here.
              </Text>
            </View>
          ) : (
            <View style={styles.chunksList}>
              {chunks.map(renderChunkCard)}
            </View>
          )}

          {/* Simple processing indicator */}
          {submitting && jobProgress && (
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color="#6b7280" />
              <Text style={styles.processingText}>
                Processing chunk {Math.min(jobProgress.completed + 1, jobProgress.total)} of{' '}
                {jobProgress.total}…
              </Text>
            </View>
          )}

          {/* Results - swipeable between outputs */}
          {results.length > 0 && (
            <View style={styles.resultsSection}>
              <View style={styles.resultsHeaderRow}>
                <Text style={styles.sectionLabel}>Analysis</Text>
                <Text style={styles.resultsCounter}>
                  {activeResultIndex + 1} / {results.length}
                </Text>
              </View>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={(e) => {
                  const { contentOffset, layoutMeasurement } = e.nativeEvent;
                  const index = Math.round(
                    contentOffset.x / Math.max(1, layoutMeasurement.width)
                  );
                  if (index >= 0 && index < results.length) {
                    setActiveResultIndex(index);
                  }
                }}
                scrollEventThrottle={16}
              >
                {results.map(renderResult)}
              </ScrollView>
              <View style={styles.dotsRow}>
                {results.map((_, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.dot,
                      idx === activeResultIndex && styles.dotActive,
                    ]}
                  />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Query input */}
      <View style={styles.queryBar}>
        <TextInput
          style={styles.queryInput}
          placeholder="Ask about selected chunk(s)..."
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={setQuery}
          multiline
        />
        <TouchableOpacity
          onPress={handleQuery}
          disabled={!query.trim() || selectedIds.length === 0 || submitting}
          style={[
            styles.queryButton,
            (!query.trim() || selectedIds.length === 0 || submitting) &&
              styles.queryButtonDisabled,
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#0f172a" />
          ) : (
            <Ionicons name="search" size={20} color="#0f172a" />
          )}
        </TouchableOpacity>
      </View>
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
  refreshButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  chunksList: {
    gap: 12,
    marginBottom: 24,
  },
  chunkCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  chunkCardSelected: {
    borderColor: 'rgba(59, 130, 246, 0.7)',
    borderWidth: 1.2,
  },
  chunkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chunkMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chunkDate: {
    color: '#6b7280',
    fontSize: 13,
  },
  chunkTime: {
    color: '#4b5563',
    fontSize: 14,
    fontWeight: '500',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
    marginRight: 4,
  },
  liveText: {
    color: '#16a34a',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  chunkSize: {
    marginTop: 6,
    color: '#9ca3af',
    fontSize: 12,
  },
  chunkProgressContainer: {
    marginTop: 10,
  },
  chunkProgressBackground: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  chunkProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  chunkProgressLabel: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 11,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  processingText: {
    fontSize: 13,
    color: '#6b7280',
  },
  resultsSection: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  resultsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  resultsCounter: {
    fontSize: 12,
    color: '#6b7280',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e5e7eb',
    marginHorizontal: 2,
  },
  dotActive: {
    backgroundColor: '#60a5fa',
  },
  resultCard: {
    width: 320,
    marginHorizontal: 20,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  resultHeader: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  resultError: {
    color: '#b91c1c',
    fontSize: 13,
  },
  resultText: {
    color: '#111827',
    fontSize: 13,
    lineHeight: 19,
  },
  resultTimestampsContainer: {
    marginTop: 10,
  },
  resultTimestampsLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
    fontWeight: '500',
  },
  resultTimestampsScroll: {
    paddingVertical: 2,
    paddingRight: 4,
  },
  resultTimestampButton: {
    marginRight: 8,
  },
  resultTimestampGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(243, 244, 246, 1)',
  },
  resultTimestampIcon: {
    marginRight: 4,
  },
  resultTimestampText: {
    fontSize: 12,
    color: '#374151',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
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
  queryBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15, 23, 42, 0.06)',
    backgroundColor: '#ffffff',
  },
  queryInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    color: '#111827',
    fontSize: 14,
    marginRight: 10,
  },
  queryButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e7eb',
  },
  queryButtonDisabled: {
    opacity: 0.6,
  },
});

export default RawFootagePage;

