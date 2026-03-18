import React, { useEffect, useState } from 'react';

type BillingState = {
  email?: string;
  subscription_status: string;
  premium_valid_until?: string | null;
  query_credits: number;
  free_autopilot_remaining: number;
};

type Transaction = {
  id: number;
  user_id: number;
  type: string;
  amount_ghc?: number | null;
  query_delta: number;
  free_autopilot_delta: number;
  paystack_reference?: string | null;
  paystack_status?: string | null;
  created_at: string;
};

const PAYMENTS_API_BASE_URL = import.meta.env.VITE_PAYMENTS_API_BASE_URL || 'http://localhost:8100';

const App: React.FC = () => {
  const [users, setUsers] = useState<BillingState[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, txRes] = await Promise.all([
        fetch(`${PAYMENTS_API_BASE_URL}/admin/users`),
        fetch(`${PAYMENTS_API_BASE_URL}/admin/transactions?limit=50`),
      ]);
      if (!usersRes.ok || !txRes.ok) {
        throw new Error('Failed to load admin data');
      }
      const usersJson = await usersRes.json();
      const txJson = await txRes.json();
      setUsers(usersJson);
      setTransactions(txJson);
    } catch (e: any) {
      setError(e?.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Inspectre Payments Admin</h1>
          <p>Monitor users, subscriptions, and query credits.</p>
        </div>
        <button className="refreshButton" onClick={loadData}>
          Refresh
        </button>
      </header>

      {error && (
        <div className="error">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <main className="main">
          <section className="panel">
            <h2>Users</h2>
            <div className="tableWrapper">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Tier</th>
                    <th>Query Credits</th>
                    <th>Free Autopilots</th>
                    <th>Premium Until</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.email}>
                      <td>{u.email}</td>
                      <td>{u.subscription_status}</td>
                      <td>{u.query_credits}</td>
                      <td>{u.free_autopilot_remaining}</td>
                      <td>{u.premium_valid_until ? new Date(u.premium_valid_until).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>Recent Transactions</h2>
            <div className="tableWrapper">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>User ID</th>
                    <th>Type</th>
                    <th>Amount (GHC)</th>
                    <th>Query Δ</th>
                    <th>Autopilot Δ</th>
                    <th>Paystack Ref</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{t.id}</td>
                      <td>{t.user_id}</td>
                      <td>{t.type}</td>
                      <td>{t.amount_ghc ?? '—'}</td>
                      <td>{t.query_delta}</td>
                      <td>{t.free_autopilot_delta}</td>
                      <td>{t.paystack_reference ?? '—'}</td>
                      <td>{t.paystack_status ?? '—'}</td>
                      <td>{new Date(t.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}
    </div>
  );
};

export default App;

