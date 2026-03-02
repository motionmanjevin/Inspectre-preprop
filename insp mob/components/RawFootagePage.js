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
import { rawFootageApi } from '../utils/api';

const RawFootagePage = ({ onBack }) => {
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState([]);

  useEffect(() => {
    fetchChunks();
  }, []);

  const fetchChunks = async () => {
    try {
      setLoading(true);
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
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      } else {
        // If already have 2, replace with this one
        next.clear();
        next.add(id);
      }
      return Array.from(next);
    });
  };

  const handleQuery = async () => {
    if (!query.trim() || selectedIds.length === 0) return;
    try {
      setSubmitting(true);
      setResults([]);
      const response = await rawFootageApi.queryChunks(query.trim(), selectedIds);
      setResults(response.results || []);
    } catch (error) {
      console.error('Error querying raw footage:', error);
      Alert.alert('Error', error.message || 'Failed to analyze raw footage');
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
          <Text style={styles.resultText}>{result.analysis}</Text>
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

          {/* Results */}
          {results.length > 0 && (
            <View style={styles.resultsSection}>
              <Text style={styles.sectionLabel}>Analysis</Text>
              {results.map(renderResult)}
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
  resultsSection: {
    marginTop: 8,
  },
  resultCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    marginTop: 8,
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

