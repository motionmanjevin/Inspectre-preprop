import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Animated,
  Modal,
  Dimensions,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import EyeIcon from './components/EyeIcon';
import SplashScreen from './components/SplashScreen';
import LoginScreen from './components/LoginScreen';
import QRScanner from './components/QRScanner';
import { 
  searchApi, 
  analysisApi, 
  searchApiExtended,
  getAuthToken, 
  getTunnelUrl, 
  setTunnelUrl, 
  removeAuthToken,
  initializeApiBaseUrl,
  API_BASE_URL 
} from './utils/api';
import MenuDrawer from './components/MenuDrawer';
import AlertsPage from './components/AlertsPage';
import ChatHistoryPage from './components/ChatHistoryPage';
import ProcessingTimelinePage from './components/ProcessingTimelinePage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

// Animated Text Component for typing effect
const AnimatedText = ({ children, delay = 0 }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const text = typeof children === 'string' ? children : '';
    
    // Start typing effect after delay
    const timer = setTimeout(() => {
      setIsVisible(true);
      let currentIndex = 0;
      const interval = setInterval(() => {
        if (currentIndex <= text.length) {
          setDisplayedText(text.slice(0, currentIndex));
          currentIndex++;
        } else {
          clearInterval(interval);
        }
      }, 8); // Fast typing speed
      
      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timer);
  }, [children, delay]);

  if (!isVisible) return null;

  return (
    <View>
      <Text style={styles.aiText}>{displayedText}</Text>
    </View>
  );
};

// Utility function to parse timestamps from text
const parseTimestamps = (text) => {
  if (!text) return [];
  
  const timestamps = [];
  
  // Pattern 1: HH:MM:SS format (e.g., "00:05:30", "1:23:45")
  const hmsPattern = /(\d{1,2}):(\d{2}):(\d{2})/g;
  let match;
  while ((match = hmsPattern.exec(text)) !== null) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    timestamps.push({
      seconds: totalSeconds,
      display: match[0],
      original: match[0]
    });
  }
  
  // Pattern 2: MM:SS format (e.g., "5:30", "23:45")
  const msPattern = /(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$|[^\d:])/g;
  while ((match = msPattern.exec(text)) !== null) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    // Only add if it's a reasonable time (less than 60 minutes for MM:SS format)
    if (minutes < 60) {
      const totalSeconds = minutes * 60 + seconds;
      // Avoid duplicates
      if (!timestamps.some(t => t.seconds === totalSeconds)) {
        timestamps.push({
          seconds: totalSeconds,
          display: match[0].trim(),
          original: match[0].trim()
        });
      }
    }
  }
  
  // Pattern 3: "X minutes Y seconds" or "X min Y sec" format
  const minutesSecondsPattern = /(\d+)\s*(?:minutes?|mins?|m)\s*(?:and\s*)?(\d+)?\s*(?:seconds?|secs?|s)?/gi;
  while ((match = minutesSecondsPattern.exec(text)) !== null) {
    const minutes = parseInt(match[1], 10);
    const seconds = match[2] ? parseInt(match[2], 10) : 0;
    const totalSeconds = minutes * 60 + seconds;
    if (!timestamps.some(t => t.seconds === totalSeconds)) {
      timestamps.push({
        seconds: totalSeconds,
        display: `${minutes}:${seconds.toString().padStart(2, '0')}`,
        original: match[0]
      });
    }
  }
  
  // Pattern 4: "X seconds" or "X sec" format
  const secondsPattern = /(\d+)\s*(?:seconds?|secs?|s)(?:\s|$|[^\d])/gi;
  while ((match = secondsPattern.exec(text)) !== null) {
    const seconds = parseInt(match[1], 10);
    if (!timestamps.some(t => t.seconds === seconds)) {
      timestamps.push({
        seconds: seconds,
        display: `0:${seconds.toString().padStart(2, '0')}`,
        original: match[0]
      });
    }
  }
  
  // Sort by seconds and remove duplicates
  const uniqueTimestamps = [];
  const seen = new Set();
  timestamps
    .sort((a, b) => a.seconds - b.seconds)
    .forEach(t => {
      if (!seen.has(t.seconds)) {
        seen.add(t.seconds);
        uniqueTimestamps.push(t);
      }
    });
  
  return uniqueTimestamps;
};

// Video Overlay Modal Component
const VideoOverlay = ({ visible, onClose, videoData }) => {
  const videoRef = useRef(null);
  
  if (!visible) return null;

  const timestamps = videoData?.timestamps || [];

  const handleSeek = async (seconds) => {
    try {
      if (videoRef.current) {
        // Use playFromPositionAsync for more reliable seeking
        await videoRef.current.playFromPositionAsync(seconds * 1000, {
          toleranceMillisBefore: 100,
          toleranceMillisAfter: 100,
        });
      }
    } catch (error) {
      console.error('Error seeking video:', error);
      // Fallback to setPositionAsync if playFromPositionAsync fails
      try {
        if (videoRef.current) {
          await videoRef.current.setPositionAsync(seconds * 1000);
        }
      } catch (fallbackError) {
        console.error('Fallback seek also failed:', fallbackError);
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <View style={styles.overlayBackground}>
        <View style={styles.overlayContainer}>
          <TouchableOpacity 
            style={styles.closeButton} 
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color="#808080" />
          </TouchableOpacity>
          
          <View style={styles.videoPlayerContainer}>
            {videoData?.videoUrl ? (
              <Video
                ref={videoRef}
                source={{ uri: videoData.videoUrl }}
                style={styles.videoPlayer}
                useNativeControls
                shouldPlay
                resizeMode={ResizeMode.CONTAIN}
              />
            ) : (
              <View style={styles.videoPlayer}>
                <Ionicons name="play" size={60} color="#404040" />
              </View>
            )}
          </View>
          
          {videoData && (
            <View style={styles.videoOverlayInfo}>
              <Text style={styles.overlayTitle}>{videoData.title}</Text>
              <Text style={styles.overlayMeta}>{videoData.timestamp}</Text>
              <Text style={styles.overlayLocation}>{videoData.location}</Text>
              
              {/* Timestamp buttons */}
              {timestamps.length > 0 && (
                <View style={styles.timestampsContainer}>
                  <Text style={styles.timestampsLabel}>Jump to:</Text>
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.timestampsScroll}
                  >
                    {timestamps.map((ts, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.timestampButton}
                        onPress={() => handleSeek(ts.seconds)}
                        activeOpacity={0.7}
                      >
                        <LinearGradient
                          colors={['rgba(0, 255, 136, 0.3)', 'rgba(0, 255, 136, 0.2)', 'rgba(0, 255, 136, 0.15)']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.timestampButtonGradient}
                        >
                          <Ionicons name="time-outline" size={14} color="#00ff88" style={styles.timestampIcon} />
                          <Text style={styles.timestampText}>{ts.display}</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

// Video Card Component - simplified to avoid animation conflicts
const VideoCard = ({ children, onPress }) => {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <View style={styles.videoCardWrapper}>
        <LinearGradient
          colors={['rgba(150, 150, 200, 0.1)', 'rgba(100, 100, 150, 0.05)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.videoCardGradient}
        />
        <View style={styles.videoCard}>
          {children}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const CHAT_HISTORY_KEY = 'inspectre_chat_history';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showSplash, setShowSplash] = useState(true); // Always start with splash
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [isCheckingTunnel, setIsCheckingTunnel] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [showVideoOverlay, setShowVideoOverlay] = useState(false);
  const [showMenuDrawer, setShowMenuDrawer] = useState(false);
  const [currentPage, setCurrentPage] = useState('chat'); // 'chat', 'alerts', 'history', 'timeline'
  const [timeFilter, setTimeFilter] = useState('Last 24 hours');
  const [selectedDate, setSelectedDate] = useState(null);
  const [availableDates, setAvailableDates] = useState([]);

  // Initialize tunnel URL and check auth after splash finishes
  const handleSplashFinish = async () => {
    setShowSplash(false);
    
    // Initialize API base URL from storage
    await initializeApiBaseUrl();
    
    // Check if tunnel URL exists
    const tunnelUrl = await getTunnelUrl();
    if (!tunnelUrl) {
      // No tunnel URL saved, show QR scanner
      setShowQRScanner(true);
      return;
    }
    
    // Test connection to saved tunnel URL
    try {
      const testUrl = `${tunnelUrl}/health`;
      const response = await fetch(testUrl, {
        method: 'GET',
      });
      
      if (response.ok) {
        // Connection successful, check if logged in
        const token = await getAuthToken();
        if (token) {
          setIsLoggedIn(true);
        }
        // If not logged in, will show login screen
      } else {
        // Connection failed, ask to rescan
        setShowQRScanner(true);
      }
    } catch (error) {
      // Connection failed, ask to rescan
      console.log('Tunnel connection test failed:', error);
      setShowQRScanner(true);
    }
  };

  const handleLogin = async () => {
    setIsLoggedIn(true);
  };

  const handleQRScan = async (tunnelUrl) => {
    try {
      // Save tunnel URL
      await setTunnelUrl(tunnelUrl);
      
      // Test connection
      const testUrl = `${tunnelUrl}/health`;
      const response = await fetch(testUrl, {
        method: 'GET',
      });
      
      if (response.ok) {
        // Connection successful, close scanner
        setShowQRScanner(false);
        
        // Check if user is already logged in
        const token = await getAuthToken();
        if (token) {
          setIsLoggedIn(true);
        }
        // If not logged in, will show login screen
      } else {
        Alert.alert(
          'Connection Failed',
          'Could not connect to the tunnel. Please check the QR code and try again.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      Alert.alert(
        'Connection Failed',
        `Could not connect to the tunnel: ${error.message || 'Unknown error'}. Please check the QR code and try again.`,
        [{ text: 'OK' }]
      );
    }
  };

  const handleQRCancel = () => {
    // Can't cancel - tunnel URL is required
    Alert.alert(
      'Tunnel Required',
      'You must scan a QR code to connect to your device.',
      [{ text: 'OK', onPress: () => setShowQRScanner(true) }]
    );
  };

  const handleVideoPress = (videoData) => {
    console.log('Video pressed:', videoData);
    setSelectedVideo(videoData);
    setShowVideoOverlay(true);
  };

  const closeVideoOverlay = () => {
    console.log('Closing video overlay');
    setShowVideoOverlay(false);
    // Keep selectedVideo intact to avoid re-renders
  };

  // Save chat history
  const saveChatHistory = async () => {
    if (messages.length === 0) return;
    try {
      const stored = await AsyncStorage.getItem(CHAT_HISTORY_KEY);
      const conversations = stored ? JSON.parse(stored) : [];
      const newConversation = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        messages: messages,
      };
      conversations.push(newConversation);
      // Keep only last 50 conversations
      const trimmed = conversations.slice(-50);
      await AsyncStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
    } catch (error) {
      console.error('Error saving chat history:', error);
    }
  };

  // Restore conversation from history
  const restoreConversation = (restoredMessages) => {
    setMessages(restoredMessages);
  };

  // Fetch available dates
  const fetchAvailableDates = async () => {
    try {
      const response = await searchApiExtended.getAvailableDates();
      setAvailableDates(response.dates || []);
    } catch (error) {
      console.error('Error fetching available dates:', error);
    }
  };

  // Get target date for API calls
  const getTargetDate = () => {
    if (timeFilter === 'Last 24 hours' || !selectedDate) {
      return null;
    }
    return selectedDate;
  };

  const handleSearch = async () => {
    if (!message.trim()) return;
    
    const userMessage = { id: Date.now(), text: message, type: 'user' };
    setMessages(prev => [...prev, userMessage]);
    
    const queryText = message;
    setMessage('');
    setIsLoading(true);

    try {
      const token = await getAuthToken();
      const targetDate = getTargetDate();
      const response = await searchApi.searchClips(queryText, 5, targetDate);
      
      // Convert API response to message format
      if (response.clips && response.clips.length > 0) {
        response.clips.forEach((clip, index) => {
          const localPath = clip.metadata?.local_path;
          const playableUrl = localPath
            ? `${API_BASE_URL}/videos/${encodeURIComponent(String(localPath))}${token ? `?token=${encodeURIComponent(token)}` : ''}`
            : clip.video_url;

          const videoMessage = {
            id: Date.now() + index,
            type: 'video',
            title: clip.metadata?.description || 'Video clip',
            timestamp: clip.metadata?.timestamp || new Date().toISOString(),
            location: clip.metadata?.local_path || clip.video_url,
            videoUrl: playableUrl,
            localPath: clip.metadata?.local_path,
          };
          setMessages(prev => [...prev, videoMessage]);
        });
      } else {
        // No results found
        setMessages(prev => [...prev, {
          id: Date.now(),
          type: 'llm',
          analysis: 'No video clips found matching your query.',
        }]);
      }
    } catch (error) {
      // Handle token expiration
      if (error.code === 'TOKEN_EXPIRED' || error.message?.includes('Token expired')) {
        setIsLoggedIn(false);
        await removeAuthToken();
        Alert.alert(
          'Session Expired',
          'Your session has expired. Please login again.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      setMessages(prev => [...prev, {
        id: Date.now(),
        type: 'llm',
        analysis: `Error: ${error.message || 'Failed to search clips'}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!message.trim()) return;
    
    const userMessage = { id: Date.now(), text: message, type: 'user' };
    setMessages(prev => [...prev, userMessage]);
    
    const queryText = message;
    setMessage('');
    setIsLoading(true);

    try {
      const token = await getAuthToken();
      const targetDate = getTargetDate();
      const response = await analysisApi.analyze(queryText, 5, targetDate);
      
      // Process each analysis result - show video card + analysis text
      if (response.results && response.results.length > 0) {
        response.results.forEach((result, index) => {
          // Parse timestamps from analysis text
          const timestamps = result.analysis ? parseTimestamps(result.analysis) : [];
          
          // Add video card first
          const localPath = result.local_path;
          const playableUrl = localPath
            ? `${API_BASE_URL}/videos/${encodeURIComponent(String(localPath))}${token ? `?token=${encodeURIComponent(token)}` : ''}`
            : result.video_url;

          const videoMessage = {
            id: Date.now() + index * 2,
            type: 'video',
            title: `Analysis Result ${index + 1}`,
            timestamp: new Date().toISOString(),
            location: localPath || result.video_url,
            videoUrl: playableUrl,
            localPath: localPath,
            timestamps: timestamps, // Store parsed timestamps
          };
          setMessages(prev => [...prev, videoMessage]);

          // Then add analysis text
          if (result.error) {
            setMessages(prev => [...prev, {
              id: Date.now() + index * 2 + 1,
              type: 'llm',
              analysis: `Video ${index + 1}: Error - ${result.error}`,
            }]);
          } else if (result.analysis) {
            setMessages(prev => [...prev, {
              id: Date.now() + index * 2 + 1,
              type: 'llm',
              analysis: result.analysis,
            }]);
          }
        });
      } else {
        setMessages(prev => [...prev, {
          id: Date.now(),
          type: 'llm',
          analysis: 'No videos found to analyze.',
        }]);
      }
    } catch (error) {
      // Handle token expiration
      if (error.code === 'TOKEN_EXPIRED' || error.message?.includes('Token expired')) {
        setIsLoggedIn(false);
        await removeAuthToken();
        Alert.alert(
          'Session Expired',
          'Your session has expired. Please login again.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      setMessages(prev => [...prev, {
        id: Date.now(),
        type: 'llm',
        analysis: `Error: ${error.message || 'Failed to analyze videos'}`,
      }]);
    } finally {
      setIsLoading(false);
      // Save chat history after each query
      saveChatHistory();
    }
  };

  // Handle navigation
  const handleNavigate = (page) => {
    setCurrentPage(page);
    if (page === 'chat') {
      // Save current conversation before switching
      saveChatHistory();
    }
  };

  const renderMessage = (msg, index) => {
    switch (msg.type) {
      case 'user':
        return (
          <View key={msg.id} style={styles.userMessageWrapper}>
            <LinearGradient
              colors={['rgba(150, 150, 200, 0.2)', 'rgba(100, 100, 150, 0.15)', 'rgba(50, 50, 100, 0.1)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.userMessageGradient}
            />
            <View style={styles.userMessage}>
              <Text style={styles.userMessageText}>{msg.text}</Text>
            </View>
          </View>
        );
      
      case 'video':
        return (
          <View key={msg.id} style={styles.videoResponse}>
            <VideoCard onPress={() => handleVideoPress(msg)}>
              <Text style={styles.videoTitle}>{msg.title}</Text>
              <Text style={styles.videoMeta}>{msg.timestamp}</Text>
              <Text style={styles.videoLocation}>{msg.location}</Text>
            </VideoCard>
          </View>
        );
      
      case 'llm':
        return (
          <View key={msg.id} style={styles.llmResponseWrapper}>
            <LinearGradient
              colors={['rgba(150, 150, 200, 0.4)', 'rgba(100, 100, 150, 0.2)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.llmResponseGradient}
            />
            <View style={styles.llmResponse}>
              <AnimatedText delay={200}>{msg.analysis}</AnimatedText>
            </View>
          </View>
        );
      
      default:
        return null;
    }
  };

  // Always show splash screen first
  if (showSplash) {
    return <SplashScreen onFinish={handleSplashFinish} />;
  }

  // After splash, show QR scanner if tunnel URL is missing
  if (showQRScanner) {
    return <QRScanner onScan={handleQRScan} onCancel={handleQRCancel} />;
  }

  // If not logged in, show login screen
  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const isFirstTime = messages.length === 0;

  // Render non-chat pages fullscreen (outside KeyboardAvoidingView)
  if (currentPage === 'alerts') {
    return (
      <>
        <AlertsPage
          onBack={() => {
            setCurrentPage('chat');
            saveChatHistory();
          }}
        />
        {isLoggedIn && (
          <MenuDrawer
            visible={showMenuDrawer}
            onClose={() => setShowMenuDrawer(false)}
            onNavigate={handleNavigate}
            currentPage={currentPage}
          />
        )}
      </>
    );
  }

  if (currentPage === 'history') {
    return (
      <>
        <ChatHistoryPage
          onBack={() => {
            setCurrentPage('chat');
            saveChatHistory();
          }}
          onRestoreConversation={restoreConversation}
        />
        {isLoggedIn && (
          <MenuDrawer
            visible={showMenuDrawer}
            onClose={() => setShowMenuDrawer(false)}
            onNavigate={handleNavigate}
            currentPage={currentPage}
          />
        )}
      </>
    );
  }

  if (currentPage === 'timeline') {
    return (
      <>
        <ProcessingTimelinePage
          onBack={() => {
            setCurrentPage('chat');
            saveChatHistory();
          }}
        />
        {isLoggedIn && (
          <MenuDrawer
            visible={showMenuDrawer}
            onClose={() => setShowMenuDrawer(false)}
            onNavigate={handleNavigate}
            currentPage={currentPage}
          />
        )}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      
      {/* Gradient Background Spots */}
      <View style={styles.gradientSpot1} pointerEvents="none">
        <LinearGradient
          colors={['rgba(100, 100, 255, 0.08)', 'rgba(100, 100, 255, 0)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={styles.gradientSpot2} pointerEvents="none">
        <LinearGradient
          colors={['rgba(150, 100, 200, 0.06)', 'rgba(150, 100, 200, 0)', 'transparent']}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={styles.gradientSpot3} pointerEvents="none">
        <LinearGradient
          colors={['rgba(200, 150, 100, 0.05)', 'rgba(200, 150, 100, 0)', 'transparent']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      
      <KeyboardAvoidingView 
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => setShowMenuDrawer(true)}
            style={styles.menuButton}
          >
            <Ionicons name="menu" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Inspectre</Text>
            {currentPage === 'chat' && timeFilter && (
              <Text style={styles.timeFilterText}>{timeFilter}</Text>
            )}
          </View>
          {currentPage === 'chat' && (
            <TouchableOpacity
              onPress={async () => {
                // Ensure dates are loaded
                if (availableDates.length === 0) {
                  await fetchAvailableDates();
                }
                
                // Show time filter options
                const options = [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Last 24 hours',
                    onPress: () => {
                      setTimeFilter('Last 24 hours');
                      setSelectedDate(null);
                    },
                  },
                ];
                
                // Add available dates
                if (availableDates.length > 0) {
                  availableDates.slice(0, 10).forEach((date) => {
                    options.push({
                      text: date,
                      onPress: () => {
                        setTimeFilter(date);
                        setSelectedDate(date);
                      },
                    });
                  });
                }
                
                Alert.alert('Time Filter', 'Select time range', options);
              }}
              style={styles.filterButton}
            >
              <Ionicons name="calendar-outline" size={20} color="#00ff88" />
            </TouchableOpacity>
          )}
          {currentPage !== 'chat' && <View style={styles.menuButton} />}
        </View>

        {currentPage === 'chat' && (
          <>
            <View style={styles.content}>
              {isFirstTime ? (
                <View style={styles.welcomeContainer}>
                  <EyeIcon />
                  <Text style={styles.welcomeText}>What are we looking for?</Text>
                </View>
              ) : (
                <ScrollView 
                  style={styles.messagesContainer}
                  contentContainerStyle={styles.messagesContent}
                  showsVerticalScrollIndicator={false}
                >
                  {messages.map((msg, index) => renderMessage(msg, index))}
                  {isLoading && (
                    <View style={styles.loadingContainer}>
                      <View style={styles.loadingDots}>
                        <View style={[styles.dot, styles.dot1]} />
                        <View style={[styles.dot, styles.dot2]} />
                        <View style={[styles.dot, styles.dot3]} />
                      </View>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>

            <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <LinearGradient
              colors={['rgba(150, 150, 200, 0.15)', 'rgba(100, 100, 150, 0.08)', 'rgba(50, 50, 100, 0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.inputGradientBorder}
            />
            <TextInput
              style={styles.textInput}
              value={message}
              onChangeText={setMessage}
              placeholder="Message Inspectre"
              placeholderTextColor="#666"
              multiline
              maxLength={500}
            />
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, styles.searchButton]}
                onPress={handleSearch}
                disabled={!message.trim() || isLoading}
              >
                <Ionicons name="search" size={20} color={message.trim() && !isLoading ? "#606060" : "#333333"} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.sendButton]}
                onPress={handleSend}
                disabled={!message.trim() || isLoading}
              >
                <Ionicons name="send" size={20} color={message.trim() && !isLoading ? "#606060" : "#333333"} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
          </>
        )}
      </KeyboardAvoidingView>
      
      <VideoOverlay
        visible={showVideoOverlay}
        onClose={closeVideoOverlay}
        videoData={selectedVideo}
      />

      {/* Menu Drawer */}
      {isLoggedIn && (
        <MenuDrawer
          visible={showMenuDrawer}
          onClose={() => setShowMenuDrawer(false)}
          onNavigate={handleNavigate}
          currentPage={currentPage}
        />
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  gradientSpot1: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: width * 0.6,
    height: height * 0.4,
    borderRadius: width * 0.6,
    opacity: 0.4,
  },
  gradientSpot2: {
    position: 'absolute',
    top: height * 0.3,
    right: 0,
    width: width * 0.5,
    height: height * 0.5,
    borderRadius: width * 0.5,
    opacity: 0.3,
  },
  gradientSpot3: {
    position: 'absolute',
    bottom: height * 0.2,
    left: width * 0.2,
    width: width * 0.4,
    height: height * 0.3,
    borderRadius: width * 0.4,
    opacity: 0.25,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  menuButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  timeFilterText: {
    fontSize: 11,
    color: '#00ff88',
    marginTop: 2,
    fontWeight: '500',
  },
  filterButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 48,
  },
  welcomeText: {
    fontSize: 16,
    color: '#808080',
    textAlign: 'center',
    marginTop: 40,
    fontWeight: '300',
    letterSpacing: 0.3,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  userMessageWrapper: {
    alignSelf: 'flex-end',
    marginBottom: 32,
    maxWidth: '85%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  userMessageGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
  },
  userMessage: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 20,
  },
  userMessageText: {
    color: '#e8e8e8',
    fontSize: 15,
    lineHeight: 20,
  },
  videoResponse: {
    alignSelf: 'flex-start',
    marginBottom: 40,
    width: '100%',
  },
  llmResponseWrapper: {
    alignSelf: 'flex-start',
    marginBottom: 40,
    width: '100%',
    position: 'relative',
  },
  llmResponseGradient: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: 2,
  },
  llmResponse: {
    alignSelf: 'flex-start',
    width: '100%',
    paddingLeft: 16,
  },
  aiText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: 0.2,
  },
  videoCardWrapper: {
    borderRadius: 12,
    marginVertical: 4,
    overflow: 'hidden',
  },
  videoCardGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
  },
  videoCard: {
    backgroundColor: '#121212',
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  videoTitle: {
    color: '#e8e8e8',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  videoMeta: {
    color: '#808080',
    fontSize: 13,
    marginBottom: 4,
    fontWeight: '400',
  },
  videoLocation: {
    color: '#606060',
    fontSize: 13,
    fontWeight: '400',
  },
  inputContainer: {
    paddingHorizontal: 32,
    paddingVertical: 20,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 52,
    position: 'relative',
    overflow: 'hidden',
  },
  inputGradientBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 24,
  },
  textInput: {
    flex: 1,
    color: '#e8e8e8',
    fontSize: 15,
    maxHeight: 120,
    marginRight: 16,
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 20,
  },
  actionButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  searchButton: {},
  sendButton: {},
  loadingContainer: {
    alignSelf: 'flex-start',
    marginBottom: 40,
    paddingHorizontal: 4,
  },
  loadingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#404040',
  },
  dot1: {},
  dot2: {},
  dot3: {},
  
  // Video Overlay Styles
  overlayBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'flex-end',
  },
  overlayContainer: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 32,
    minHeight: height * 0.8,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 10,
    marginBottom: 20,
  },
  videoPlayerContainer: {
    marginBottom: 32,
  },
  videoPlayer: {
    backgroundColor: '#1a1a1a',
    height: 220,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoOverlayInfo: {
    paddingHorizontal: 8,
  },
  overlayTitle: {
    color: '#e8e8e8',
    fontSize: 20,
    fontWeight: '500',
    marginBottom: 12,
    lineHeight: 26,
  },
  overlayMeta: {
    color: '#808080',
    fontSize: 15,
    marginBottom: 8,
    fontWeight: '400',
  },
  overlayLocation: {
    color: '#606060',
    fontSize: 15,
    fontWeight: '400',
  },
  timestampsContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  timestampsLabel: {
    color: '#808080',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 12,
    letterSpacing: 0.3,
  },
  timestampsScroll: {
    paddingRight: 8,
  },
  timestampButton: {
    marginRight: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  timestampButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.3)',
    borderRadius: 8,
  },
  timestampIcon: {
    marginRight: 6,
  },
  timestampText: {
    color: '#00ff88',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});