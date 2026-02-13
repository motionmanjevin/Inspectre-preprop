import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHAT_HISTORY_KEY = 'inspectre_chat_history';

const ChatHistoryPage = ({ onBack, onRestoreConversation }) => {
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const stored = await AsyncStorage.getItem(CHAT_HISTORY_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Sort by date, newest first
        const sorted = parsed.sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        );
        setConversations(sorted);
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  };

  const deleteConversation = async (id) => {
    Alert.alert(
      'Delete Conversation',
      'Are you sure you want to delete this conversation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const updated = conversations.filter((c) => c.id !== id);
              await AsyncStorage.setItem(
                CHAT_HISTORY_KEY,
                JSON.stringify(updated)
              );
              setConversations(updated);
            } catch (error) {
              Alert.alert('Error', 'Failed to delete conversation');
            }
          },
        },
      ]
    );
  };

  const restoreConversation = (conversation) => {
    onRestoreConversation(conversation.messages);
    onBack();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Chat History</Text>
        <View style={styles.backButton} />
      </View>

      {/* Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {conversations.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={48} color="#404040" />
            <Text style={styles.emptyText}>No chat history</Text>
            <Text style={styles.emptySubtext}>
              Your previous conversations will appear here
            </Text>
          </View>
        ) : (
          <View style={styles.conversationsList}>
            {conversations.map((conversation) => (
              <View key={conversation.id} style={styles.conversationCard}>
                <TouchableOpacity
                  onPress={() => restoreConversation(conversation)}
                  style={styles.conversationContent}
                  activeOpacity={0.7}
                >
                  <View style={styles.conversationHeader}>
                    <Text style={styles.conversationDate}>
                      {new Date(conversation.date).toLocaleString()}
                    </Text>
                    <Text style={styles.messageCount}>
                      {conversation.messages.length} messages
                    </Text>
                  </View>
                  <Text style={styles.conversationPreview} numberOfLines={2}>
                    {conversation.messages[0]?.text ||
                      conversation.messages[0]?.analysis ||
                      'Conversation'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => deleteConversation(conversation.id)}
                  style={styles.deleteButton}
                >
                  <Ionicons name="trash-outline" size={20} color="#ff4444" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
    fontSize: 14,
    textAlign: 'center',
  },
  conversationsList: {
    gap: 12,
  },
  conversationCard: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'center',
  },
  conversationContent: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  conversationDate: {
    color: '#606060',
    fontSize: 12,
  },
  messageCount: {
    color: '#606060',
    fontSize: 12,
  },
  conversationPreview: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 12,
  },
});

export default ChatHistoryPage;
