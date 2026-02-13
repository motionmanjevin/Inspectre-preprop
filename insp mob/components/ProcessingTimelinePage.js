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
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Processing Timeline</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00ff88" />
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
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Processing Timeline</Text>
        <TouchableOpacity onPress={fetchStats} style={styles.refreshButton}>
          <Ionicons name="refresh" size={24} color="#00ff88" />
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
                colors={['#00ff88', '#00cc6a', '#00994d']}
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
                          ? ['#00ff88', '#00cc6a']
                          : hourProgress > 0
                          ? ['rgba(0, 255, 136, 0.5)', 'rgba(0, 204, 106, 0.5)']
                          : ['#1a1a1a', '#1a1a1a']
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
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
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
    color: '#FFFFFF',
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
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  progressTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  progressPercentage: {
    color: '#00ff88',
    fontSize: 18,
    fontWeight: '600',
  },
  progressBarContainer: {
    marginBottom: 20,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#1a1a1a',
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
    color: '#00ff88',
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 4,
  },
  statLabel: {
    color: '#808080',
    fontSize: 13,
  },
  timelineCard: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  timelineTitle: {
    color: '#FFFFFF',
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
    backgroundColor: '#1a1a1a',
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
    color: '#606060',
    fontSize: 10,
    fontWeight: '500',
  },
});

export default ProcessingTimelinePage;
