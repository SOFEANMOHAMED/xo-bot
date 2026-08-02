import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import apiService from '../services/api';

interface User {
  id: string;
  email: string;
  name: string | null;
  subscriptionPlan: string;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
  createdAt?: string;
  role?: 'owner' | 'admin' | 'user';
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string, referralCode?: string, phone?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setToken: (token: string | null) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const token = localStorage.getItem('auth_token');
      if (token) {
        try {
          const profile = await apiService.getProfile();
          setUser(profile.user);
        } catch (error) {
          console.error('Failed to get profile:', error);
          localStorage.removeItem('auth_token');
          apiService.setToken(null);
        }
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await apiService.login(email, password);
    setUser(response.user);
    return response.user; // Return user so LoginPage can access role
  };

  const register = async (email: string, password: string, name?: string, referralCode?: string, phone?: string) => {
    const response = await apiService.register(email, password, name, referralCode, phone);
    setUser(response.user);
  };

  const logout = () => {
    // Clear local state immediately (synchronous)
    apiService.setToken(null);
    setUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
    
    // Optionally try to call logout API (fire and forget - don't wait for it)
    // This is not required for JWT tokens but can be useful for server-side logging
    apiService.logout().catch(() => {
      // Silently ignore errors - logout should always succeed locally
    });
  };

  const refreshUser = async () => {
    try {
      console.log('[AuthContext] Refreshing user profile...');
      const profile = await apiService.getProfile();
      console.log('[AuthContext] User profile loaded:', { id: profile.user.id, email: profile.user.email, role: profile.user.role });
      setUser(profile.user);
    } catch (error) {
      console.error('[AuthContext] Failed to refresh user:', error);
      logout();
      throw error; // Re-throw to let caller handle it
    }
  };

  const setToken = async (token: string | null) => {
    if (token) {
      console.log('[AuthContext] Setting token and refreshing user...');
      localStorage.setItem('auth_token', token);
      apiService.setToken(token);
      // Refresh user profile after setting token - wait for it to complete
      setIsLoading(true);
      try {
        await refreshUser();
        console.log('[AuthContext] User refreshed successfully');
      } catch (error) {
        console.error('[AuthContext] Failed to refresh user after setting token:', error);
        // Don't clear token on error - let user retry
        throw error; // Re-throw to let caller handle it
      } finally {
        setIsLoading(false);
      }
    } else {
      localStorage.removeItem('auth_token');
      apiService.setToken(null);
      setUser(null);
    }
  };

  const deleteAccount = async () => {
    try {
      await apiService.deleteAccount();
      // Clear local state after successful deletion
      logout();
    } catch (error) {
      console.error('[AuthContext] Failed to delete account:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        refreshUser,
        setToken,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

