import { useState } from 'preact/hooks';
import { EyeIcon, EyeOffIcon } from '../icons';

interface LoginScreenProps {
  onLogin: () => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!password || submitting) return;

    setSubmitting(true);
    setError('');

    try {
      // Step 1: Attempt login
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? 'Invalid password');
        setSubmitting(false);
        return;
      }

      // Step 2: Verify the session by calling /api/me
      const meResponse = await fetch('/api/me', {
        credentials: 'same-origin',
      });

      if (meResponse.ok) {
        // Session verified successfully
        onLogin();
      } else {
        // Login succeeded but session verification failed
        setError('Session verification failed. Please try again.');
      }
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div style={{ maxWidth: '400px', margin: '0 auto', paddingTop: '10vh' }}>
          <h1 class="text-2xl font-semibold mb-2" style={{ textAlign: 'center' }}>
            Home Inventory
          </h1>
          <p class="text-sm text-ink-light mb-4" style={{ textAlign: 'center' }}>
            Enter the shared password to continue.
          </p>

          <form onSubmit={handleSubmit}>
            <div class="form-group">
              <label class="form-label" for="password">Password</label>
              <div class="password-input-wrapper">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  class="form-input"
                  value={password}
                  onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                  placeholder="Enter password"
                  autocomplete="current-password"
                  autoFocus
                />
                <button
                  type="button"
                  class="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {error && (
              <div class="error-message" role="alert" style={{ marginBottom: '12px' }}>
                {error}
              </div>
            )}

            <button
              class="btn btn-primary btn-lg"
              type="submit"
              disabled={submitting || !password}
              style={{ width: '100%' }}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
