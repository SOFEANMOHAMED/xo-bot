import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PATHS, appPath, adminPath, adminLoginPath } from './paths';
import { AppView, AdminView } from '../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Require owner/admin role */
  requireAdmin?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireAdmin = false }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

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

  if (!isAuthenticated) {
    // Keep admins on the secret surface — never bounce them to public /login
    const loginTo = requireAdmin ? adminLoginPath() : PATHS.LOGIN;
    return <Navigate to={loginTo} replace state={{ from: location.pathname }} />;
  }

  const role = user?.role || 'user';
  const isAdmin = role === 'owner' || role === 'admin';

  if (requireAdmin && !isAdmin) {
    return <Navigate to={appPath(AppView.DASHBOARD)} replace />;
  }

  if (!requireAdmin && isAdmin) {
    // Admins belong in the admin panel, not merchant app
    return <Navigate to={adminPath(AdminView.OVERVIEW)} replace />;
  }

  return <>{children}</>;
};

/** Redirect authenticated users away from public auth pages */
export const GuestOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
    const role = user.role || 'user';
    if (role === 'owner' || role === 'admin') {
      return <Navigate to={adminPath(AdminView.OVERVIEW)} replace />;
    }
    return <Navigate to={appPath(AppView.DASHBOARD)} replace />;
  }

  return <>{children}</>;
};
