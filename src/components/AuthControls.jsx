import { useEffect, useState } from 'react';
import { SignInButton, SignUpButton, UserButton, useAuth, useUser } from '@clerk/react';

export default function AuthControls({ enabled, onCompanyChange }) {
  return enabled ? <ClerkAuthControls onCompanyChange={onCompanyChange} /> :
    <span className="auth-config-note" title="Set VITE_CLERK_PUBLISHABLE_KEY and server Clerk variables to enable sign-in">Auth not configured</span>;
}

function ClerkAuthControls({ onCompanyChange }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [workspaceState, setWorkspaceState] = useState({ loading: false, error: '', data: null });
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('');

  useEffect(() => {
    let live = true;
    async function loadSession() {
      if (!isLoaded || !isSignedIn) {
        onCompanyChange?.(null);
        setWorkspaceState({ loading: false, error: '', data: null });
        return;
      }
      setWorkspaceState({ loading: true, error: '', data: null });
      try {
        const token = await getToken();
        const response = await fetch('/api/session', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error('Workspace could not be loaded. Check backend configuration.');
        if (!live) return;
        setWorkspaceState({ loading: false, error: '', data });
        onCompanyChange?.(data.company || null);
      } catch {
        if (live) setWorkspaceState({ loading: false, error: 'Workspace service is unavailable.', data: null });
      }
    }
    loadSession();
    return () => { live = false; };
  }, [isLoaded, isSignedIn, getToken, onCompanyChange]);

  async function createCompany(event) {
    event.preventDefault();
    setCreating(true);
    setWorkspaceState((current) => ({ ...current, error: '' }));
    try {
      const token = await getToken();
      const response = await fetch('/api/onboarding/company', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: companyName, industry }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === 'verified_email_required' ? 'Verify your primary email in Clerk before creating a workspace.' : 'Workspace could not be created. Check the details and try again.');
      setWorkspaceState({ loading: false, error: '', data: { company: data.company, memberships: [{ id: data.company.id, role: 'owner' }] } });
      onCompanyChange?.(data.company);
      setOnboardingOpen(false);
    } catch (error) {
      setWorkspaceState((current) => ({ ...current, error: error.message || 'Workspace could not be created.' }));
    } finally { setCreating(false); }
  }

  if (!isLoaded) return <span className="auth-config-note">Loading account…</span>;
  if (!isSignedIn) return <div className="auth-actions"><SignInButton mode="modal"><button className="auth-button secondary">Sign in</button></SignInButton><SignUpButton mode="modal"><button className="auth-button primary">Create account</button></SignUpButton></div>;

  return <div className="auth-user-area">
    <div className="auth-user-copy"><strong>{user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Signed in'}</strong>
      <small>{workspaceState.loading ? 'Loading workspace…' : workspaceState.data?.company?.name || workspaceState.error || (workspaceState.data?.onboardingRequired ? 'Create your first workspace' : 'Authenticated account')}</small>
    </div>
    {workspaceState.data?.onboardingRequired && <button className="auth-button secondary" onClick={() => setOnboardingOpen((current) => !current)}>{onboardingOpen ? 'Cancel' : 'Create workspace'}</button>}
    <UserButton />
    {onboardingOpen && <form className="onboarding-popover" onSubmit={createCompany}>
      <strong>Create your workspace</strong>
      <label>Company name<input required maxLength={160} value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
      <label>Industry<input required maxLength={120} value={industry} onChange={(event) => setIndustry(event.target.value)} /></label>
      {workspaceState.error && <span role="alert">{workspaceState.error}</span>}
      <button className="auth-button primary" disabled={!companyName.trim() || !industry.trim() || creating} type="submit">{creating ? 'Creating…' : 'Create company'}</button>
    </form>}
  </div>;
}
