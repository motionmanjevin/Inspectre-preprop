import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const MenuDrawer = ({ visible, onClose, onNavigate, currentPage }) => {
  const slideAnim = React.useRef(new Animated.Value(-width * 0.8)).current;
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -width * 0.8,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const handleNavigate = (page) => {
    onNavigate(page);
    onClose();
  };

  const menuItems = [
    {
      id: 'chat',
      label: 'Chat',
      icon: 'chatbubbles-outline',
      page: 'chat',
    },
    {
      id: 'alerts',
      label: 'Alerts',
      icon: 'notifications-outline',
      page: 'alerts',
    },
    {
      id: 'history',
      label: 'Chat History',
      icon: 'time-outline',
      page: 'history',
    },
    {
      id: 'timeline',
      label: 'Processing Timeline',
      icon: 'bar-chart-outline',
      page: 'timeline',
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Backdrop */}
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: backdropOpacity,
            },
          ]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={onClose}
          />
        </Animated.View>

        {/* Drawer */}
        <Animated.View
          style={[
            styles.drawer,
            {
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          <LinearGradient
            colors={['#0f0f0f', '#0a0a0a', '#050505']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.drawerGradient}
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Menu</Text>
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeButton}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={24} color="#808080" />
              </TouchableOpacity>
            </View>

            {/* Menu Items */}
            <View style={styles.menuItems}>
              {menuItems.map((item) => {
                const isActive = currentPage === item.page;
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => handleNavigate(item.page)}
                    style={[
                      styles.menuItem,
                      isActive && styles.menuItemActive,
                    ]}
                    activeOpacity={0.7}
                  >
                    <LinearGradient
                      colors={
                        isActive
                          ? [
                              'rgba(0, 255, 136, 0.2)',
                              'rgba(0, 255, 136, 0.1)',
                              'rgba(0, 255, 136, 0.05)',
                            ]
                          : ['transparent', 'transparent']
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.menuItemGradient}
                    >
                      <Ionicons
                        name={item.icon}
                        size={24}
                        color={isActive ? '#00ff88' : '#808080'}
                        style={styles.menuIcon}
                      />
                      <Text
                        style={[
                          styles.menuLabel,
                          isActive && styles.menuLabelActive,
                        ]}
                      >
                        {item.label}
                      </Text>
                      {isActive && (
                        <View style={styles.activeIndicator} />
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })}
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: width * 0.8,
    maxWidth: 320,
  },
  drawerGradient: {
    flex: 1,
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItems: {
    paddingTop: 20,
  },
  menuItem: {
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuItemActive: {
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.3)',
  },
  menuItemGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    position: 'relative',
  },
  menuIcon: {
    marginRight: 16,
  },
  menuLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#808080',
    letterSpacing: 0.3,
  },
  menuLabelActive: {
    color: '#00ff88',
  },
  activeIndicator: {
    position: 'absolute',
    right: 12,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#00ff88',
  },
});

export default MenuDrawer;
