import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { billingApi } from '../utils/api';

const PRODUCTS = [
  { id: 'P15', label: '15 queries', price: '5 GHC' },
  { id: 'P30', label: '30 queries', price: '10 GHC' },
  { id: 'P50', label: '50 queries', price: '15 GHC' },
  { id: 'PREMIUM_MONTHLY', label: 'Premium (1 month)', price: '200 GHC', subtitle: 'Unlimited queries + 10 autopilots' },
];

export default function PaymentsPage() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startingCheckout, setStartingCheckout] = useState(null); // product id

  const loadState = async () => {
    setLoading(true);
    setError('');
    try {
      const s = await billingApi.getState();
      setState(s);
    } catch (e) {
      console.log('Failed to load billing state', e?.message);
      setError('Could not load billing status. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  const handleCheckout = async (productId) => {
    setStartingCheckout(productId);
    setError('');
    try {
      const res = await billingApi.startCheckout(productId);
      if (res?.pay_url) {
        await Linking.openURL(res.pay_url);
      } else {
        setError('Failed to start payment. Please try again.');
      }
    } catch (e) {
      console.log('Checkout error', e?.message);
      setError('Could not start payment. Please try again.');
    } finally {
      setStartingCheckout(null);
    }
  };

  const tierLabel = state?.subscription_status === 'premium' ? 'Premium' : 'Base';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Payments & Subscription</Text>
        <Text style={styles.subtitle}>Manage your query credits and premium plan.</Text>

        {loading && (
          <View style={styles.centeredRow}>
            <ActivityIndicator color="#22c55e" />
            <Text style={styles.loadingText}>Loading billing status...</Text>
          </View>
        )}

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color="#f97373" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={loadState} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {state && (
          <>
            <View style={styles.statusCard}>
              <View style={styles.statusHeader}>
                <Text style={styles.statusTier}>{tierLabel}</Text>
                {state.subscription_status === 'premium' && (
                  <View style={styles.premiumBadge}>
                    <Ionicons name="sparkles-outline" size={14} color="#0f172a" />
                    <Text style={styles.premiumBadgeText}>Premium</Text>
                  </View>
                )}
              </View>
              <Text style={styles.statusLine}>
                <Text style={styles.statusLabel}>Query credits: </Text>
                <Text style={styles.statusValue}>{state.query_credits}</Text>
              </Text>
              <Text style={styles.statusLine}>
                <Text style={styles.statusLabel}>Free autopilots remaining: </Text>
                <Text style={styles.statusValue}>{state.free_autopilot_remaining}</Text>
              </Text>
              {state.premium_valid_until && (
                <Text style={styles.statusMeta}>
                  Renews / expires:{' '}
                  {new Date(state.premium_valid_until).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Buy query packs</Text>
              <Text style={styles.sectionHint}>Use these when you run out of free/base credits.</Text>
              {PRODUCTS.filter((p) => p.id !== 'PREMIUM_MONTHLY').map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.productCard}
                  activeOpacity={0.85}
                  onPress={() => handleCheckout(p.id)}
                  disabled={startingCheckout === p.id}
                >
                  <View>
                    <Text style={styles.productLabel}>{p.label}</Text>
                    <Text style={styles.productPrice}>{p.price}</Text>
                  </View>
                  <View style={styles.productRight}>
                    {startingCheckout === p.id ? (
                      <ActivityIndicator color="#22c55e" />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Premium subscription</Text>
              <View style={styles.premiumCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.premiumTitle}>Unlimited queries</Text>
                  <Text style={styles.premiumSubtitle}>10 free autopilots per month. Extra autopilots use query credits.</Text>
                  <Text style={styles.premiumPrice}>200 GHC / month</Text>
                </View>
                <TouchableOpacity
                  style={styles.premiumButton}
                  onPress={() => handleCheckout('PREMIUM_MONTHLY')}
                  activeOpacity={0.85}
                  disabled={startingCheckout === 'PREMIUM_MONTHLY'}
                >
                  {startingCheckout === 'PREMIUM_MONTHLY' ? (
                    <ActivityIndicator color="#0f172a" />
                  ) : (
                    <Text style={styles.premiumButtonText}>
                      {state.subscription_status === 'premium' ? 'Manage' : 'Upgrade'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#f9fafb',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 20,
  },
  centeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  loadingText: {
    color: '#9ca3af',
    marginLeft: 8,
  },
  errorBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.3)',
    backgroundColor: 'rgba(127, 29, 29, 0.2)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorText: {
    color: '#fecaca',
    fontSize: 13,
    flex: 1,
    marginLeft: 8,
  },
  retryButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  retryText: {
    color: '#fecaca',
    fontSize: 12,
  },
  statusCard: {
    backgroundColor: '#020617',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.5)',
    padding: 16,
    marginBottom: 20,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusTier: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fde68a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
  },
  premiumBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0f172a',
  },
  statusLine: {
    fontSize: 14,
    color: '#d1d5db',
    marginTop: 4,
  },
  statusLabel: {
    color: '#9ca3af',
  },
  statusValue: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  statusMeta: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 8,
  },
  section: {
    marginTop: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e5e7eb',
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 8,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.9)',
    marginBottom: 8,
  },
  productLabel: {
    fontSize: 15,
    color: '#e5e7eb',
    fontWeight: '500',
  },
  productPrice: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  productRight: {
    marginLeft: 12,
  },
  premiumCard: {
    marginTop: 6,
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.6)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  premiumTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#facc15',
  },
  premiumSubtitle: {
    fontSize: 12,
    color: '#e5e7eb',
    marginTop: 4,
  },
  premiumPrice: {
    fontSize: 13,
    color: '#facc15',
    marginTop: 6,
  },
  premiumButton: {
    backgroundColor: '#facc15',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  premiumButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
});

