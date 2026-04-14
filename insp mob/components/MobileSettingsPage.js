import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { deviceConfigApi } from '../utils/api';

const defaultMulti = [
  { slot: 1, name: 'Cam 1', rtsp_url: '', enabled: false },
  { slot: 2, name: 'Cam 2', rtsp_url: '', enabled: false },
  { slot: 3, name: 'Cam 3', rtsp_url: '', enabled: false },
  { slot: 4, name: 'Cam 4', rtsp_url: '', enabled: false },
];

export default function MobileSettingsPage({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cameraMode, setCameraMode] = useState('single');
  const [rtspUrl, setRtspUrl] = useState('');
  const [cameraName, setCameraName] = useState('');
  const [multiCameras, setMultiCameras] = useState(defaultMulti);
  const [videoPreprompt, setVideoPreprompt] = useState('');
  const [r2AccountId, setR2AccountId] = useState('');
  const [r2AccessKeyId, setR2AccessKeyId] = useState('');
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState('');
  const [r2BucketName, setR2BucketName] = useState('');
  const [r2PublicUrlBase, setR2PublicUrlBase] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFromAddress, setSmtpFromAddress] = useState('');
  const [setupStatus, setSetupStatus] = useState({ is_complete: false, missing_fields: [] });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const cfg = await deviceConfigApi.get();
      setCameraMode(cfg.camera_mode || 'single');
      setRtspUrl(cfg.rtsp_url || '');
      setCameraName(cfg.camera_name || '');
      const incoming = Array.isArray(cfg.multi_cameras_json) ? cfg.multi_cameras_json : defaultMulti;
      const normalized = defaultMulti.map((d, i) => ({
        slot: i + 1,
        name: incoming[i]?.name || d.name,
        rtsp_url: incoming[i]?.rtsp_url || '',
        enabled: Boolean(incoming[i]?.enabled),
      }));
      setMultiCameras(normalized);
      setVideoPreprompt(cfg.video_preprompt || '');
      setR2AccountId(cfg.r2_account_id || '');
      setR2AccessKeyId(cfg.r2_access_key_id || '');
      setR2SecretAccessKey(cfg.r2_secret_access_key || '');
      setR2BucketName(cfg.r2_bucket_name || '');
      setR2PublicUrlBase(cfg.r2_public_url_base || '');
      setSmtpHost(cfg.smtp_host || '');
      setSmtpPort(String(cfg.smtp_port || 587));
      setSmtpUsername(cfg.smtp_username || '');
      setSmtpPassword(cfg.smtp_password || '');
      setSmtpFromAddress(cfg.smtp_from_address || '');
      setSetupStatus(cfg.setup_status || { is_complete: false, missing_fields: [] });
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    try {
      setSaving(true);
      const normalizedMulti = multiCameras.map((c, i) => ({
        slot: i + 1,
        name: (c.name || `Cam ${i + 1}`).trim() || `Cam ${i + 1}`,
        rtsp_url: (c.rtsp_url || '').trim(),
        enabled: Boolean(c.enabled && (c.rtsp_url || '').trim()),
      }));
      const primaryMulti = normalizedMulti.find((c) => c.enabled && c.rtsp_url);
      const saved = await deviceConfigApi.update({
        rtsp_url: cameraMode === 'single' ? rtspUrl : (primaryMulti?.rtsp_url || ''),
        camera_name: cameraMode === 'single' ? cameraName : (primaryMulti?.name || 'Multi Camera Grid'),
        camera_mode: cameraMode,
        multi_cameras_json: normalizedMulti,
        video_preprompt: videoPreprompt,
        r2_account_id: r2AccountId,
        r2_access_key_id: r2AccessKeyId,
        r2_secret_access_key: r2SecretAccessKey,
        r2_bucket_name: r2BucketName,
        r2_public_url_base: r2PublicUrlBase,
        smtp_host: smtpHost,
        smtp_port: Number(smtpPort || 587),
        smtp_username: smtpUsername,
        smtp_password: smtpPassword,
        smtp_from_address: smtpFromAddress,
      });
      setSetupStatus(saved.setup_status || { is_complete: false, missing_fields: [] });
      Alert.alert(
        saved?.setup_status?.is_complete ? 'Setup complete' : 'Saved',
        saved?.setup_status?.is_complete
          ? 'All required setup fields are complete.'
          : 'Settings saved. Some setup fields are still missing.'
      );
    } catch (e) {
      Alert.alert('Save failed', e?.message || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6b7280" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>
            Setup status: {setupStatus?.is_complete ? 'Complete' : 'Incomplete'}
          </Text>
          {!setupStatus?.is_complete && Array.isArray(setupStatus?.missing_fields) && setupStatus.missing_fields.length > 0 && (
            <Text style={styles.statusHint}>Missing: {setupStatus.missing_fields.join(', ')}</Text>
          )}
        </View>

        <Text style={styles.section}>Camera</Text>
        <View style={styles.row}>
          <TouchableOpacity onPress={() => setCameraMode('single')} style={[styles.modeBtn, cameraMode === 'single' && styles.modeBtnActive]}>
            <Text style={[styles.modeText, cameraMode === 'single' && styles.modeTextActive]}>Single</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCameraMode('multi')} style={[styles.modeBtn, cameraMode === 'multi' && styles.modeBtnActive]}>
            <Text style={[styles.modeText, cameraMode === 'multi' && styles.modeTextActive]}>Multi</Text>
          </TouchableOpacity>
        </View>
        {cameraMode === 'single' ? (
          <>
            <TextInput style={styles.input} value={rtspUrl} onChangeText={setRtspUrl} placeholder="RTSP URL" />
            <TextInput style={styles.input} value={cameraName} onChangeText={setCameraName} placeholder="Camera name" />
          </>
        ) : (
          multiCameras.map((cam, idx) => (
            <View key={cam.slot} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.slot}>Slot {cam.slot}</Text>
                <TouchableOpacity onPress={() => setMultiCameras((p) => p.map((x, i) => i === idx ? { ...x, enabled: !x.enabled } : x))}>
                  <Text style={styles.toggle}>{cam.enabled ? 'Enabled' : 'Disabled'}</Text>
                </TouchableOpacity>
              </View>
              <TextInput style={styles.input} value={cam.name} onChangeText={(v) => setMultiCameras((p) => p.map((x, i) => i === idx ? { ...x, name: v } : x))} placeholder={`Cam ${cam.slot}`} />
              <TextInput style={styles.input} value={cam.rtsp_url} onChangeText={(v) => setMultiCameras((p) => p.map((x, i) => i === idx ? { ...x, rtsp_url: v } : x))} placeholder="rtsp://..." />
            </View>
          ))
        )}
        <TextInput style={[styles.input, styles.textarea]} value={videoPreprompt} onChangeText={setVideoPreprompt} placeholder="Video preprompt" multiline />

        <Text style={styles.section}>Cloud (R2)</Text>
        <TextInput style={styles.input} value={r2AccountId} onChangeText={setR2AccountId} placeholder="Account ID" />
        <TextInput style={styles.input} value={r2AccessKeyId} onChangeText={setR2AccessKeyId} placeholder="Access Key ID" />
        <TextInput style={styles.input} value={r2SecretAccessKey} onChangeText={setR2SecretAccessKey} placeholder="Secret Access Key" secureTextEntry />
        <TextInput style={styles.input} value={r2BucketName} onChangeText={setR2BucketName} placeholder="Bucket Name" />
        <TextInput style={styles.input} value={r2PublicUrlBase} onChangeText={setR2PublicUrlBase} placeholder="Public URL base" />

        <Text style={styles.section}>Email (SMTP)</Text>
        <TextInput style={styles.input} value={smtpHost} onChangeText={setSmtpHost} placeholder="SMTP host" />
        <TextInput style={styles.input} value={smtpPort} onChangeText={setSmtpPort} placeholder="SMTP port" keyboardType="numeric" />
        <TextInput style={styles.input} value={smtpUsername} onChangeText={setSmtpUsername} placeholder="SMTP username" />
        <TextInput style={styles.input} value={smtpPassword} onChangeText={setSmtpPassword} placeholder="SMTP password/app password" secureTextEntry />
        <TextInput style={styles.input} value={smtpFromAddress} onChangeText={setSmtpFromAddress} placeholder="From address" />

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save settings'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.08)' },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#111827' },
  content: { padding: 16, paddingBottom: 40 },
  statusCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12 },
  statusTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  statusHint: { marginTop: 6, fontSize: 12, color: '#6b7280' },
  section: { marginTop: 12, marginBottom: 8, fontSize: 14, fontWeight: '700', color: '#374151' },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeBtn: { backgroundColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  modeBtnActive: { backgroundColor: '#111827' },
  modeText: { color: '#374151', fontSize: 12 },
  modeTextActive: { color: '#fff' },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  slot: { fontSize: 12, fontWeight: '600', color: '#374151' },
  toggle: { fontSize: 12, color: '#2563eb' },
  saveBtn: { marginTop: 12, backgroundColor: '#111827', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: '600' },
});
