import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  StatusBar,
} from 'react-native';
import Svg, { Circle, Ellipse, Defs, RadialGradient, Stop } from 'react-native-svg';

const SplashScreen = ({ onFinish }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const startAnimation = () => {
      // Fast fade in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        // Hold for a moment
        setTimeout(() => {
          // Fast fade out
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }).start(() => {
            if (onFinish) onFinish();
          });
        }, 1200);
      });
    };

    startAnimation();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      <Animated.View
        style={[
          styles.eyeContainer,
          {
            opacity: fadeAnim,
          },
        ]}
      >
        <Svg width="100" height="100" viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="eyeGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
              <Stop offset="30%" stopColor="#dddddd" stopOpacity="0.8" />
              <Stop offset="100%" stopColor="#888888" stopOpacity="0.6" />
            </RadialGradient>
            <RadialGradient id="pupilGrad" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#000000" stopOpacity="1" />
              <Stop offset="80%" stopColor="#1a1a1a" stopOpacity="1" />
              <Stop offset="100%" stopColor="#333333" stopOpacity="1" />
            </RadialGradient>
          </Defs>
          
          {/* Outer ring - CCTV camera frame */}
          <Circle
            cx="100"
            cy="100"
            r="90"
            fill="none"
            stroke="#666"
            strokeWidth="2"
            opacity="0.4"
          />
          
          {/* Eye outer shape */}
          <Ellipse
            cx="100"
            cy="100"
            rx="65"
            ry="40"
            fill="url(#eyeGrad)"
            stroke="#999"
            strokeWidth="1"
          />
          
          {/* Iris */}
          <Circle
            cx="100"
            cy="100"
            r="25"
            fill="#333"
            stroke="#555"
            strokeWidth="1"
          />
          
          {/* Pupil - camera lens */}
          <Circle
            cx="100"
            cy="100"
            r="15"
            fill="url(#pupilGrad)"
          />
          
          {/* Inner lens reflection */}
          <Circle
            cx="95"
            cy="95"
            r="5"
            fill="#ffffff"
            opacity="0.7"
          />
          
          {/* Small camera indicator light */}
          <Circle
            cx="100"
            cy="100"
            r="2"
            fill="#ff4444"
            opacity="0.8"
          />
        </Svg>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SplashScreen;