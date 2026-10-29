'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { allowsOidcRegistration, usesOidcLogin } from '@/lib/auth-mode';
import { registerWithOidc } from '@/lib/oidc';

function Login() {
  const t = useT();
  const { user, idToken, loading, signIn, authError } = useOpenAgentsAuth();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const target = params.get('returnTo') || '/';
  // Only same-origin application paths may be used as the return destination.
  const returnTo = target.startsWith('/') && !target.startsWith('//') && !target.includes('\\') && !target.startsWith('/login') ? target : '/';
  useEffect(() => { if (!loading && user && idToken) window.location.replace(returnTo); }, [loading, user, idToken, returnTo]);
  return <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-8">
    <h1 className="text-xl font-semibold">{t('workspaceGate.signInTitle')}</h1>
    <p className="max-w-md text-center text-sm text-muted-foreground">{t('workspaceGate.signInBody')}</p>
    <Button disabled={loading || busy} onClick={async () => {
      setBusy(true); setError('');
      try { await signIn(); } catch (e) { setError(e instanceof Error ? e.message : t('workspaceGate.loadFailedTitle')); }
      finally { setBusy(false); }
    }}>{t('workspaceGate.logIn')}</Button>
    {usesOidcLogin() && <>
      <Button variant="outline" disabled={loading || busy || !allowsOidcRegistration()} onClick={async () => {
        setBusy(true); setError('');
        try { await registerWithOidc(); }
        catch (e) { setError(e instanceof Error ? e.message : t('auth.signInFailed')); }
        finally { setBusy(false); }
      }}>{t('auth.register')}</Button>
      <p className="max-w-md text-center text-sm text-muted-foreground">{t(allowsOidcRegistration() ? 'auth.registrationHint' : 'auth.registrationClosed')}</p>
    </>}
    {(error || authError) && <p role="alert" className="text-sm text-destructive">{error || authError}</p>}
  </main>;
}
export default function LoginPage() { return <Suspense><Login /></Suspense>; }
