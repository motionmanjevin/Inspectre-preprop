import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const DateFilterModal = ({ visible, onClose, onSelectDate, availableDates, loading }) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContainer}>
          <LinearGradient
            colors={['#0f0f0f', '#0a0a0a', '#050505']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.modalGradient}
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Select Time Range</Text>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeButton}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={24} color="#808080" />
              </TouchableOpacity>
            </View>

            {/* Content */}
            <ScrollView
              style={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#00ff88" />
                  <Text style={styles.loadingText}>Loading dates...</Text>
                </View>
              ) : (
                <>
                  {/* Last 24 hours option */}
                  <TouchableOpacity
                    onPress={() => {
                      onSelectDate('Last 24 hours', null);
                      onClose();
                    }}
                    style={styles.dateOption}
                    activeOpacity={0.7}
                  >
                    <LinearGradient
                      colors={['rgba(0, 255, 136, 0.15)', 'rgba(0, 255, 136, 0.05)', 'transparent']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.dateOptionGradient}
                    >
                      <View style={styles.dateOptionContent}>
                        <Ionicons name="time-outline" size={20} color="#00ff88" />
                        <Text style={styles.dateOptionText}>Last 24 hours</Text>
                        <Ionicons name="chevron-forward" size={20} color="#606060" />
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>

                  {/* Available dates */}
                  {availableDates.length > 0 ? (
                    <>
                      <View style={styles.sectionHeader}>
                        <View style={styles.sectionLine} />
                        <Text style={styles.sectionText}>Available Dates</Text>
                        <View style={styles.sectionLine} />
                      </View>
                      {availableDates.map((date, index) => (
                        <TouchableOpacity
                          key={index}
                          onPress={() => {
                            onSelectDate(date, date);
                            onClose();
                          }}
                          style={styles.dateOption}
                          activeOpacity={0.7}
                        >
                          <LinearGradient
                            colors={['rgba(150, 150, 200, 0.1)', 'rgba(100, 100, 150, 0.05)', 'transparent']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.dateOptionGradient}
                          >
                            <View style={styles.dateOptionContent}>
                              <Ionicons name="calendar-outline" size={20} color="#808080" />
                              <Text style={styles.dateOptionText}>{date}</Text>
                              <Ionicons name="chevron-forward" size={20} color="#606060" />
                            </View>
                          </LinearGradient>
                        </TouchableOpacity>
                      ))}
                    </>
                  ) : (
                    <View style={styles.emptyContainer}>
                      <Ionicons name="calendar-outline" size={32} color="#404040" />
                      <Text style={styles.emptyText}>No other dates available</Text>
                      <Text style={styles.emptySubtext}>
                        Only data from the last 24 hours is available
                      </Text>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  modalContainer: {
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalGradient: {
    borderRadius: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    maxHeight: 400,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    color: '#808080',
    fontSize: 14,
    marginTop: 12,
  },
  dateOption: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  dateOptionGradient: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  dateOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateOptionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    marginTop: 8,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  sectionText: {
    marginHorizontal: 12,
    fontSize: 12,
    fontWeight: '500',
    color: '#606060',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#808080',
    fontSize: 16,
    fontWeight: '500',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#606060',
    fontSize: 13,
    textAlign: 'center',
  },
});

export default DateFilterModal;
