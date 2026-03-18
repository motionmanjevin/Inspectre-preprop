import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';

const QRScanner = ({ onScan, onCancel }) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const cameraRef = useRef(null);

  useEffect(() => {
    if (permission && !permission.granted && !permission.canAskAgain) {
      // Permission denied permanently
    }
  }, [permission]);

  const handleBarCodeScanned = ({ data }) => {
    if (scanned) return;
    setScanned(true);
    if (data && (data.startsWith('http://') || data.startsWith('https://'))) {
      onScan(data);
    } else {
      Alert.alert('Invalid QR Code', 'Please scan a valid tunnel URL QR code.', [
        { text: 'Try Again', onPress: () => setScanned(false) },
      ]);
    }
  };

  const handleManualSubmit = () => {
    const url = manualUrl.trim();
    if (!url) return;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      onScan(url);
    } else {
      Alert.alert('Invalid URL', 'Please enter a valid URL starting with http:// or https://');
    }
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <Text style={styles.errorText}>Camera permission is required to scan QR codes</Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, { marginTop: 12, backgroundColor: '#333' }]} onPress={onCancel}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ marginTop: 24 }} onPress={() => setShowManualInput(true)}>
            <Text style={{ color: '#888', fontSize: 14, textDecorationLine: 'underline' }}>Enter tunnel URL manually</Text>
          </TouchableOpacity>
        </View>
        {showManualInput && renderManualInput()}
      </View>
    );
  }

  function renderManualInput() {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.manualInputOverlay}>
        <View style={styles.manualInputCard}>
          <Text style={styles.manualTitle}>Enter Tunnel URL</Text>
          <Text style={styles.manualSubtitle}>Paste the tunnel link from the email or web dashboard</Text>
          <TextInput
            style={styles.manualInput}
            value={manualUrl}
            onChangeText={setManualUrl}
            placeholder="https://xxxx.trycloudflare.com"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={handleManualSubmit}
          />
          <View style={styles.manualBtnRow}>
            <TouchableOpacity style={styles.manualCancelBtn} onPress={() => setShowManualInput(false)}>
              <Text style={{ color: '#fff', fontWeight: '500' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.manualSubmitBtn, !manualUrl.trim() && { opacity: 0.4 }]} onPress={handleManualSubmit} disabled={!manualUrl.trim()}>
              <Text style={{ color: '#000', fontWeight: '600' }}>Connect</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Scan Device QR Code</Text>
        <Text style={styles.subtitle}>Point your camera at the QR code shown on your computer</Text>
      </View>

      <View style={styles.scannerContainer}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
        <View style={styles.overlay}>
          <View style={styles.scanArea} />
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.manualLinkBtn} onPress={() => setShowManualInput(true)}>
          <Ionicons name="link-outline" size={18} color="#00ff88" />
          <Text style={styles.manualLinkText}>Enter URL manually</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Ionicons name="close" size={24} color="#fff" />
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      {showManualInput && renderManualInput()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
  },
  scannerContainer: {
    flex: 1,
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanArea: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#00ff88',
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
  },
  cancelButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  manualLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  manualLinkText: {
    color: '#00ff88',
    fontSize: 14,
    fontWeight: '500',
  },
  manualInputOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  manualInputCard: {
    width: '100%',
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#222',
  },
  manualTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
  },
  manualSubtitle: {
    fontSize: 13,
    color: '#888',
    marginBottom: 16,
  },
  manualInput: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
  },
  manualBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  manualCancelBtn: {
    flex: 1,
    backgroundColor: '#222',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  manualSubmitBtn: {
    flex: 1,
    backgroundColor: '#00ff88',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  text: {
    color: '#ffffff',
    fontSize: 16,
  },
  errorText: {
    color: '#ff4444',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#1a1a1a',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default QRScanner;
