import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { searchApiExtended } from '../utils/api';

const ProcessingTimelinePage = ({ onBack }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const response = await searchApiExtended.getProcessingStats();
      setStats(response);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateProgress = () => {
    if (!stats) return 0;
    // Each chunk is 10 minutes, so 24 hours = 144 chunks
    const totalChunks = 144;
    const processedChunks = stats.chunks_processed || 0;
    return Math.min((processedChunks / totalChunks) * 100, 100);
  };

  const formatTime = (minutes) => {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Processing Timeline</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6b7280" />
        </View>
      </View>
    );
  }

  const progress = calculateProgress();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Processing Timeline</Text>
        <TouchableOpacity onPress={fetchStats} style={styles.refreshButton}>
          <Ionicons name="refresh" size={24} color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Progress Card */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Last 24 Hours</Text>
            <Text style={styles.progressPercentage}>{progress.toFixed(1)}%</Text>
          </View>
          
          {/* Progress Bar */}
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBarBackground}>
              <LinearGradient
                colors={['rgba(107, 114, 128, 0.8)', 'rgba(75, 85, 99, 0.7)', 'rgba(55, 65, 81, 0.6)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.progressBarFill, { width: `${progress}%` }]}
              />
            </View>
          </View>

          {/* Stats */}
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {stats?.chunks_processed || 0}
              </Text>
              <Text style={styles.statLabel}>Chunks Processed</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {formatTime(stats?.minutes_processed || 0)}
              </Text>
              <Text style={styles.statLabel}>Minutes Processed</Text>
            </View>
          </View>
        </View>

        {/* Timeline Visualization */}
        <View style={styles.timelineCard}>
          <Text style={styles.timelineTitle}>Processing Status</Text>
          <View style={styles.timelineContainer}>
            {Array.from({ length: 24 }).map((_, hour) => {
              const hourProgress = hour < Math.floor((stats?.minutes_processed || 0) / 60) 
                ? 1 
                : hour === Math.floor((stats?.minutes_processed || 0) / 60)
                ? ((stats?.minutes_processed || 0) % 60) / 60
                : 0;
              
              return (
                <View key={hour} style={styles.timelineHour}>
                  <View style={styles.timelineHourBar}>
                    <LinearGradient
                      colors={
                        hourProgress === 1
                          ? ['rgba(107, 114, 128, 0.8)', 'rgba(75, 85, 99, 0.7)']
                          : hourProgress > 0
                          ? ['rgba(107, 114, 128, 0.4)', 'rgba(75, 85, 99, 0.3)']
                          : ['#e5e7eb', '#e5e7eb']
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={[
                        styles.timelineHourFill,
                        { height: `${hourProgress * 100}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.timelineHourLabel}>
                    {hour.toString().padStart(2, '0')}:00
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
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
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  progressTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '600',
  },
  progressPercentage: {
    color: '#4b5563',
    fontSize: 18,
    fontWeight: '600',
  },
  progressBarContainer: {
    marginBottom: 20,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    flex: 1,
  },
  statValue: {
    color: '#4b5563',
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 4,
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 13,
  },
  timelineCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  timelineTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  timelineContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 200,
  },
  timelineHour: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  timelineHourBar: {
    width: '100%',
    height: 160,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
    justifyContent: 'flex-end',
  },
  timelineHourFill: {
    width: '100%',
    borderRadius: 4,
  },
  timelineHourLabel: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '500',
  },
});

export default ProcessingTimelinePage;
