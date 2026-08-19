import React, { useEffect } from 'react';
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
} from 'react-router-dom';
import { AppView, AdminView, UserRole } from './types';
import { useAuth } from './contexts/AuthContext';
import {
  PATHS,
  appPath,
  adminPath,
  adminLoginPath,
  RESERVED_ROOT_SEGMENTS,
} from './routes/paths';
import { ProtectedRoute, GuestOnlyRoute } from './routes/ProtectedRoute';
import MerchantApp from './components/MerchantApp';
import AdminApp from './components/AdminApp';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import ForgotPasswordPage from './components/ForgotPasswordPage';
import ResetPasswordPage from './components/ResetPasswordPage';
import CompleteProfilePage from './components/CompleteProfilePage';
import PageView from './components/PageView';
import StorifyPartnerPage from './components/StorifyPartnerPage';

function postLoginPath(role: UserRole | string | undefined): string {
  if (role === 'owner' || role === 'admin') {
    return adminPath(AdminView.OVERVIEW);
  }
  return appPath(AppView.DASHBOARD);
}

/** Preserve OAuth query when redirecting legacy /integrations → /app/integrations */
function LegacyIntegrationsRedirect() {
  const location = useLocation();
  return <Navigate to={`${appPath(AppView.INTEGRATIONS)}${location.search}`} replace />;
}

function LandingRoute() {
  const navigate = useNavigate();
  return (
    <LandingPage
      onNavigateToLogin={() => navigate(PATHS.LOGIN)}
      onNavigateToSignup={() => navigate(PATHS.SIGNUP)}
      onNavigateToPage={(slug) => navigate(`/${slug}`)}
    />
  );
}

function LoginRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  return (
    <GuestOnlyRoute>
      <LoginPage
        onLoginSuccess={(role) => {
          if (role === 'owner' || role === 'admin') {
            navigate(adminPath(AdminView.OVERVIEW), { replace: true });
            return;
          }
          const target =
            from && from.startsWith(PATHS.APP) ? from : appPath(AppView.DASHBOARD);
          navigate(target, { replace: true });
        }}
        onBack={() => navigate(PATHS.HOME)}
        onNavigateToSignup={() => navigate(PATHS.SIGNUP)}
        onNavigateToForgotPassword={() => navigate(PATHS.FORGOT_PASSWORD)}
      />
    </GuestOnlyRoute>
  );
}

/** Login under the secret admin base — used when opening the private panel while logged out */
function AdminLoginRoute() {
  const navigate = useNavigate();

  return (
    <GuestOnlyRoute>
      <LoginPage
        variant="admin"
        onLoginSuccess={(role) => {
          if (role === 'owner' || role === 'admin') {
            navigate(adminPath(AdminView.OVERVIEW), { replace: true });
            return;
          }
          // Non-admin accounts belong in the merchant app
          navigate(appPath(AppView.DASHBOARD), { replace: true });
        }}
        onBack={() => navigate(adminLoginPath())}
        onNavigateToSignup={() => navigate(adminLoginPath())}
      />
    </GuestOnlyRoute>
  );
}

function SignupRoute() {
  const navigate = useNavigate();
  return (
    <GuestOnlyRoute>
      <SignupPage
        onSignupSuccess={() => navigate(appPath(AppView.DASHBOARD), { replace: true })}
        onNavigateToLogin={() => navigate(PATHS.LOGIN)}
        onBack={() => navigate(PATHS.HOME)}
        onNavigateToPage={(slug) => navigate(`/${slug}`)}
      />
    </GuestOnlyRoute>
  );
}

function ForgotPasswordRoute() {
  const navigate = useNavigate();
  return (
    <GuestOnlyRoute>
      <ForgotPasswordPage
        onBack={() => navigate(PATHS.HOME)}
        onNavigateToLogin={() => navigate(PATHS.LOGIN)}
      />
    </GuestOnlyRoute>
  );
}

function ResetPasswordRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || undefined;
  // Do not wrap in GuestOnlyRoute — users may open the email link while still logged in
  return (
    <ResetPasswordPage
      token={token}
      onBack={() => navigate(PATHS.HOME)}
      onNavigateToLogin={() => navigate(PATHS.LOGIN)}
    />
  );
}

function CompleteProfileRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, setToken, isAuthenticated, isLoading } = useAuth();
  const token = searchParams.get('token');

  useEffect(() => {
    if (isAuthenticated) return;
    if (!token) {
      navigate(PATHS.LOGIN, { replace: true });
      return;
    }
    let cancelled = false;
    setToken(token)
      .then(() => {
        if (!cancelled) navigate(PATHS.COMPLETE_PROFILE, { replace: true });
      })
      .catch(() => {
        if (!cancelled) navigate(PATHS.LOGIN, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [token, setToken, navigate, isAuthenticated]);

  if (isLoading || (!isAuthenticated && !!token)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <CompleteProfilePage
      onComplete={() => {
        navigate(postLoginPath(user?.role), { replace: true });
      }}
    />
  );
}

/** Handle Google OAuth `?token=` on any path (typically landing/home) */
function OAuthTokenHandler({ children }: { children: React.ReactNode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { setToken } = useAuth();
  const token = searchParams.get('token');
  const error = searchParams.get('error');

  useEffect(() => {
    // complete-profile has its own token handling
    if (location.pathname === PATHS.COMPLETE_PROFILE) return;
    // Password-reset `?token=` is NOT a JWT — must not go through OAuth setToken
    if (location.pathname === PATHS.RESET_PASSWORD || location.pathname === PATHS.FORGOT_PASSWORD) {
      return;
    }
    // Integration OAuth uses different query keys on /app/integrations
    if (location.pathname.startsWith(PATHS.APP) || location.pathname === PATHS.INTEGRATIONS_LEGACY) {
      return;
    }

    if (token) {
      setToken(token)
        .then(() => {
          navigate(PATHS.HOME, { replace: true });
        })
        .catch(() => {
          navigate(PATHS.LOGIN, { replace: true });
        });
    } else if (error) {
      navigate(`${PATHS.LOGIN}?error=${encodeURIComponent(error)}`, { replace: true });
    }
  }, [token, error, setToken, navigate, location.pathname]);

  return <>{children}</>;
}

function PublicPageRoute() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  if (!slug || RESERVED_ROOT_SEGMENTS.has(slug)) {
    return <Navigate to={PATHS.HOME} replace />;
  }

  return (
    <PageView
      slug={slug}
      onBack={() => navigate(PATHS.HOME)}
      onNavigateToLogin={() => navigate(PATHS.LOGIN)}
      onNavigateToSignup={() => navigate(PATHS.SIGNUP)}
      onNavigateToPage={(pageSlug) => navigate(`/${pageSlug}`)}
    />
  );
}

function StorifyPartnerRoute() {
  const navigate = useNavigate();
  return (
    <StorifyPartnerPage
      onNavigateToLogin={() => navigate(PATHS.LOGIN)}
      onNavigateToSignup={() => navigate(PATHS.SIGNUP)}
      onNavigateToPage={(slug) => navigate(`/${slug}`)}
      onBack={() => navigate(PATHS.HOME)}
    />
  );
}

function AdminLogoutRoute() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  return (
    <ProtectedRoute requireAdmin>
      <AdminApp
        onLogout={() => {
          logout();
          navigate(PATHS.HOME, { replace: true });
        }}
      />
    </ProtectedRoute>
  );
}

function HomeRoute() {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">جاري التحميل...</p>
        </div>
      </div>
    );
  }
  if (isAuthenticated && user) {
    return <Navigate to={postLoginPath(user.role)} replace />;
  }
  return <LandingRoute />;
}

const App: React.FC = () => {
  return (
    <OAuthTokenHandler>
      <Routes>
        <Route path={PATHS.HOME} element={<HomeRoute />} />
        <Route path={PATHS.LOGIN} element={<LoginRoute />} />
        <Route path={PATHS.SIGNUP} element={<SignupRoute />} />
        <Route path={PATHS.FORGOT_PASSWORD} element={<ForgotPasswordRoute />} />
        <Route path={PATHS.RESET_PASSWORD} element={<ResetPasswordRoute />} />
        <Route path={PATHS.COMPLETE_PROFILE} element={<CompleteProfileRoute />} />

        <Route path={PATHS.INTEGRATIONS_LEGACY} element={<LegacyIntegrationsRedirect />} />

        <Route path={PATHS.APP} element={<Navigate to={appPath(AppView.DASHBOARD)} replace />} />
        <Route
          path={`${PATHS.APP}/:viewSlug`}
          element={
            <ProtectedRoute>
              <MerchantApp />
            </ProtectedRoute>
          }
        />

        {/* Secret super-admin panel (path from VITE_ADMIN_BASE_PATH) */}
        <Route path={adminLoginPath()} element={<AdminLoginRoute />} />
        <Route path={PATHS.ADMIN} element={<Navigate to={adminPath(AdminView.OVERVIEW)} replace />} />
        <Route path={`${PATHS.ADMIN}/:viewSlug`} element={<AdminLogoutRoute />} />

        {/* Legacy guessable /admin — closed (no hint that an admin panel exists) */}
        <Route path={PATHS.ADMIN_LEGACY} element={<Navigate to={PATHS.HOME} replace />} />
        <Route path={`${PATHS.ADMIN_LEGACY}/*`} element={<Navigate to={PATHS.HOME} replace />} />

        <Route
          path="/storify"
          element={
            <StorifyPartnerRoute />
          }
        />
        <Route path="/:slug" element={<PublicPageRoute />} />
        <Route path="*" element={<Navigate to={PATHS.HOME} replace />} />
      </Routes>
    </OAuthTokenHandler>
  );
};

export default App;
