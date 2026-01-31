import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Animated,
  Dimensions,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { authApi } from '../utils/api';

const { width, height } = Dimensions.get('window');

const LoginScreen = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fadeAnim] = useState(new Animated.Value(0));

  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await authApi.login(email.trim(), password);
      onLogin();
    } catch (err) {
      const errorMessage = err.message || 'Login failed. Please check your credentials.';
      setError(errorMessage);
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      {/* Gradient Background Spots */}
      <View style={styles.gradientSpot1} pointerEvents="none">
        <LinearGradient
          colors={['rgba(100, 100, 255, 0.1)', 'rgba(100, 100, 255, 0)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={styles.gradientSpot2} pointerEvents="none">
        <LinearGradient
          colors={['rgba(150, 100, 200, 0.08)', 'rgba(150, 100, 200, 0)', 'transparent']}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <Animated.View
          style={[
            styles.content,
            {
              opacity: fadeAnim,
              transform: [
                {
                  translateY: fadeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Logo/Title */}
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>INSPECTRE</Text>
            <Text style={styles.tagline}>AI Surveillance Intelligence</Text>
          </View>

          {/* Error Message */}
          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Login Form */}
          <View style={styles.formContainer}>
            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <LinearGradient
                  colors={['rgba(150, 150, 200, 0.15)', 'rgba(100, 100, 150, 0.08)', 'rgba(50, 50, 100, 0.05)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.inputGradientBorder}
                />
                <Ionicons name="mail-outline" size={20} color="#606060" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor="#606060"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <LinearGradient
                  colors={['rgba(150, 150, 200, 0.15)', 'rgba(100, 100, 150, 0.08)', 'rgba(50, 50, 100, 0.05)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.inputGradientBorder}
                />
                <Ionicons name="lock-closed-outline" size={20} color="#606060" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#606060"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="password"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeIcon}
                >
                  <Ionicons
                    name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color="#606060"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Login Button */}
            <TouchableOpacity
              style={styles.loginButton}
              onPress={handleLogin}
              activeOpacity={0.8}
              disabled={!email.trim() || !password.trim() || loading}
            >
              <LinearGradient
                colors={
                  email.trim() && password.trim()
                    ? ['rgba(150, 150, 200, 0.3)', 'rgba(100, 100, 150, 0.2)', 'rgba(50, 50, 100, 0.15)']
                    : ['rgba(50, 50, 50, 0.2)', 'rgba(30, 30, 30, 0.15)', 'rgba(20, 20, 20, 0.1)']
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.loginButtonGradient}
              >
                <Text
                  style={[
                    styles.loginButtonText,
                    (!email.trim() || !password.trim() || loading) && styles.loginButtonTextDisabled,
                  ]}
                >
                  {loading ? 'Signing In...' : 'Sign In'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Forgot Password */}
            <TouchableOpacity style={styles.forgotPassword}>
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
};

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
    bottom: height * 0.2,
    right: 0,
    width: width * 0.5,
    height: height * 0.5,
    borderRadius: width * 0.5,
    opacity: 0.3,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  logoText: {
    fontSize: 32,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 3,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 14,
    color: '#808080',
    letterSpacing: 1,
    fontWeight: '300',
  },
  formContainer: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 24,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  inputGradientBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: '#e8e8e8',
    fontSize: 16,
    paddingVertical: 0,
  },
  eyeIcon: {
    padding: 4,
  },
  loginButton: {
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  loginButtonGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  loginButtonTextDisabled: {
    color: '#606060',
  },
  forgotPassword: {
    marginTop: 24,
    alignItems: 'center',
  },
  forgotPasswordText: {
    color: '#808080',
    fontSize: 14,
    fontWeight: '400',
  },
  errorContainer: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    textAlign: 'center',
  },
});

export default LoginScreen;