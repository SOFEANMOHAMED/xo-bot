import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import apiService from '../services/api';

interface User {
  id: string;
  email: string;
  name: string | null;
  subscriptionPlan: string;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
  subscriptionEndsAt?: string | null;
  createdAt?: string;
  role?: 'owner' | 'admin' | 'user';
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    name?: string,
    referralCode?: string,
    phone?: string,
    acquisition?: Record<string, unknown>
  ) => Promise<void>;
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
    const checkAuth = async () => {
      try {
        // Cookie session (preferred) or transitional in-memory Bearer
        const profile = await apiService.getProfile();
        setUser(profile.user);
      } catch {
        apiService.setToken(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await apiService.login(email, password);
    setUser(response.user);
    return response.user;
  };

  const register = async (
    email: string,
    password: string,
    name?: string,
    referralCode?: string,
    phone?: string,
    acquisition?: Record<string, unknown>
  ) => {
    const response = await apiService.register(email, password, name, referralCode, phone, acquisition);
    setUser(response.user);
  };

  const logout = () => {
    apiService.setToken(null);
    setUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
    apiService.logout().catch(() => {});
  };

  const refreshUser = async () => {
    try {
      const profile = await apiService.getProfile();
      setUser(profile.user);
    } catch (error) {
      logout();
      throw error;
    }
  };

  const setToken = async (token: string | null) => {
    if (token) {
      apiService.setToken(token);
      setIsLoading(true);
      try {
        await apiService.establishSession(token);
        await refreshUser();
      } catch (error) {
        throw error;
      } finally {
        setIsLoading(false);
      }
    } else {
      apiService.setToken(null);
      setUser(null);
    }
  };

  const deleteAccount = async () => {
    try {
      await apiService.deleteAccount();
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
