import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import Svg, { Circle, Ellipse, Defs, RadialGradient, Stop } from 'react-native-svg';

const AnimatedSvg = Animated.createAnimatedComponent(Svg);

export default function EyeIcon() {
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const startRotation = () => {
      rotateAnim.setValue(0);
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 8000, // 8 seconds for full rotation
        useNativeDriver: true,
      }).start(() => startRotation());
    };
    
    startRotation();
  }, [rotateAnim]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      <AnimatedSvg 
        width="200" 
        height="200" 
        viewBox="0 0 200 200"
        style={{
          transform: [{ rotate }],
        }}
      >
        <Defs>
          <RadialGradient id="outerGradient" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#333" stopOpacity="0.1" />
            <Stop offset="70%" stopColor="#666" stopOpacity="0.3" />
            <Stop offset="100%" stopColor="#999" stopOpacity="0.5" />
          </RadialGradient>
          <RadialGradient id="middleGradient" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#444" stopOpacity="0.2" />
            <Stop offset="100%" stopColor="#777" stopOpacity="0.6" />
          </RadialGradient>
          <RadialGradient id="innerGradient" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <Stop offset="30%" stopColor="#ddd" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#999" stopOpacity="0.7" />
          </RadialGradient>
          <RadialGradient id="pupilGradient" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#000" stopOpacity="1" />
            <Stop offset="80%" stopColor="#1a1a1a" stopOpacity="1" />
            <Stop offset="100%" stopColor="#333" stopOpacity="1" />
          </RadialGradient>
        </Defs>
        
        {/* Outer ring */}
        <Circle
          cx="100"
          cy="100"
          r="95"
          fill="none"
          stroke="url(#outerGradient)"
          strokeWidth="2"
          opacity="0.4"
        />
        
        {/* Second ring */}
        <Circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="url(#middleGradient)"
          strokeWidth="1.5"
          opacity="0.5"
        />
        
        {/* Third ring */}
        <Circle
          cx="100"
          cy="100"
          r="65"
          fill="none"
          stroke="#888"
          strokeWidth="1"
          opacity="0.6"
        />
        
        {/* Eye outer shape */}
        <Ellipse
          cx="100"
          cy="100"
          rx="55"
          ry="35"
          fill="none"
          stroke="#aaa"
          strokeWidth="2"
          opacity="0.7"
        />
        
        {/* Iris */}
        <Circle
          cx="100"
          cy="100"
          r="25"
          fill="url(#innerGradient)"
        />
        
        {/* Pupil */}
        <Circle
          cx="100"
          cy="100"
          r="12"
          fill="url(#pupilGradient)"
        />
        
        {/* Inner reflection */}
        <Circle
          cx="95"
          cy="95"
          r="4"
          fill="#fff"
          opacity="0.6"
        />
        
        {/* Subtle outer glow */}
        <Circle
          cx="100"
          cy="100"
          r="110"
          fill="none"
          stroke="#666"
          strokeWidth="0.5"
          opacity="0.2"
        />
      </AnimatedSvg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});