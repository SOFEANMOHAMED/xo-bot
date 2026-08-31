import React, { useState, useEffect, useRef } from 'react';
import { 
  User, 
  Mail, 
  Phone, 
  Lock, 
  Save, 
  Eye, 
  EyeOff,
  Shield,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  Search,
  Info
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import apiService from '../services/api';
import { COUNTRIES, DEFAULT_DIAL_CODE, extractCountryFromPhone } from '../constants/countries';
import { useVisitorCountryDialCode } from '../hooks/useVisitorCountryDialCode';

interface Country {
  code: string;
  dialCode: string;
  name: string;
  nameAr: string;
  flag: string;
}

// Profile uses inline country picker — list from shared constants
const PROFILE_COUNTRIES: Country[] = COUNTRIES;

const extractCountryCode = extractCountryFromPhone;

interface ProfilePageProps {
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

const ProfilePage: React.FC<ProfilePageProps> = ({ showNotification }) => {
  const { user, refreshUser } = useAuth();
  
  // Profile form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState(DEFAULT_DIAL_CODE);
  const [phone, setPhone] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  
  // Country selector state
  const [isCountryOpen, setIsCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const countrySearchInputRef = useRef<HTMLInputElement>(null);
  
  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const { markUserPicked: markCountryUserPicked } = useVisitorCountryDialCode(
    (dialCode) => setCountryCode(dialCode),
    Boolean(user && !(user as { phone?: string }).phone)
  );
  
  // Load user data
  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      // Extract country code from stored phone
      const { countryCode: code, phone: phoneNum } = extractCountryCode((user as any).phone || '');
      setCountryCode(code);
      setPhone(phoneNum);
    }
  }, [user]);

  // Close country dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target as Node)) {
        setIsCountryOpen(false);
        setCountrySearch('');
      }
    };

    if (isCountryOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setTimeout(() => countrySearchInputRef.current?.focus(), 100);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCountryOpen]);

  // Get selected country
  const selectedCountry = PROFILE_COUNTRIES.find(c => c.dialCode === countryCode) || PROFILE_COUNTRIES[0];

  // Filter countries based on search
  const filteredCountries = PROFILE_COUNTRIES.filter(country =>
    country.nameAr.toLowerCase().includes(countrySearch.toLowerCase()) ||
    country.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
    country.dialCode.includes(countrySearch) ||
    country.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const handleSelectCountry = (country: Country) => {
    markCountryUserPicked();
    setCountryCode(country.dialCode);
    setIsCountryOpen(false);
    setCountrySearch('');
  };
  
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      showNotification('الاسم مطلوب', 'error');
      return;
    }
    
    setIsUpdatingProfile(true);
    try {
      // Combine country code with phone number
      const fullPhone = phone ? `${countryCode}${phone}` : '';
      await apiService.updateProfile({ name, phone: fullPhone });
      await refreshUser();
      showNotification('تم تحديث المعلومات الشخصية بنجاح', 'success');
    } catch (error: any) {
      showNotification(error.message || 'فشل في تحديث المعلومات', 'error');
    } finally {
      setIsUpdatingProfile(false);
    }
  };
  
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentPassword) {
      showNotification('كلمة المرور الحالية مطلوبة', 'error');
      return;
    }
    
    if (!newPassword || newPassword.length < 6) {
      showNotification('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل', 'error');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      showNotification('كلمات المرور غير متطابقة', 'error');
      return;
    }
    
    setIsChangingPassword(true);
    try {
      await apiService.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showNotification('تم تغيير كلمة المرور بنجاح', 'success');
    } catch (error: any) {
      showNotification(error.message || 'فشل في تغيير كلمة المرور', 'error');
    } finally {
      setIsChangingPassword(false);
    }
  };
  
  // Password strength indicator
  const getPasswordStrength = (password: string) => {
    if (!password) return { level: 0, text: '', color: '' };
    
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 10) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    
    if (strength <= 1) return { level: 1, text: 'ضعيفة', color: 'bg-red-500' };
    if (strength <= 2) return { level: 2, text: 'متوسطة', color: 'bg-yellow-500' };
    if (strength <= 3) return { level: 3, text: 'جيدة', color: 'bg-blue-500' };
    return { level: 4, text: 'قوية', color: 'bg-green-500' };
  };
  
  const passwordStrength = getPasswordStrength(newPassword);

  return (
    <div className="space-y-8" dir="rtl">
      {/* Page Header */}
      <div className="bg-gradient-to-l from-brand to-brand-600 rounded-2xl p-8 text-white shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
            <User size={40} />
          </div>
          <div>
            <h1 className="text-3xl font-bold">الملف الشخصي</h1>
            <p className="text-brand-200 mt-1">إدارة معلوماتك الشخصية وإعدادات الأمان</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Personal Information Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
          <div className="px-6 py-4 bg-gradient-to-l from-brand-50 to-brand-50 dark:from-brand-900/20 dark:to-brand-900/20 border-b border-gray-100 dark:border-gray-700 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-brand-100 dark:bg-brand-900/50 rounded-lg">
                <User className="w-5 h-5 text-brand dark:text-brand" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">المعلومات الشخصية</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">تعديل الاسم والبريد الإلكتروني ورقم الهاتف</p>
              </div>
            </div>
          </div>
          
          <form onSubmit={handleUpdateProfile} className="p-6 space-y-5">
            {/* Name Field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                الاسم الكامل
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <User size={18} />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand focus:border-transparent transition-all"
                  placeholder="أدخل اسمك الكامل"
                />
              </div>
            </div>
            
            {/* Email Field - Read Only */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Mail size={18} />
                </div>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  dir="ltr"
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <Lock size={14} className="text-gray-400" />
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <Info size={12} />
                لا يمكن تغيير البريد الإلكتروني. تواصل مع الدعم إذا كنت بحاجة للمساعدة.
              </p>
            </div>
            
            {/* Phone Field with Country Code */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                رقم الهاتف
              </label>
              <div className="flex gap-2">
                {/* Country Code Selector */}
                <div className="relative" ref={countryDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsCountryOpen(!isCountryOpen)}
                    className="flex items-center gap-2 h-[50px] px-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-600 transition-all"
                    aria-label="اختر رمز الدولة"
                    aria-expanded={isCountryOpen}
                  >
                    <span className="text-lg">{selectedCountry.flag}</span>
                    <span className="text-sm font-medium min-w-[50px] text-left">{selectedCountry.dialCode}</span>
                    <ChevronDown 
                      size={16} 
                      className={`text-gray-400 transition-transform ${isCountryOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isCountryOpen && (
                    <div className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-[9999] max-h-80 overflow-hidden flex flex-col">
                      {/* Search */}
                      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                        <div className="relative">
                          <Search 
                            size={18} 
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                          />
                          <input
                            ref={countrySearchInputRef}
                            type="text"
                            value={countrySearch}
                            onChange={(e) => setCountrySearch(e.target.value)}
                            placeholder="ابحث عن الدولة..."
                            className="w-full bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white rounded-lg py-2 pr-10 pl-4 focus:ring-2 focus:ring-brand focus:border-transparent outline-none text-sm placeholder-gray-400"
                          />
                        </div>
                      </div>

                      {/* Countries List */}
                      <div className="overflow-y-auto flex-1">
                        {filteredCountries.length > 0 ? (
                          <ul className="py-2">
                            {filteredCountries.map((country) => (
                              <li
                                key={country.code}
                                onClick={() => handleSelectCountry(country)}
                                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                                  country.dialCode === countryCode
                                    ? 'bg-brand-50 dark:bg-brand-900/30 text-brand dark:text-brand'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                }`}
                              >
                                <span className="text-xl">{country.flag}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm">{country.nameAr}</div>
                                  <div className="text-xs text-gray-400">{country.name}</div>
                                </div>
                                <span className="text-sm font-mono text-gray-400">{country.dialCode}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="px-4 py-8 text-center text-gray-400 text-sm">
                            لا توجد نتائج
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Phone Number Input */}
                <div className="relative flex-1">
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Phone size={18} />
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                    className="w-full pr-10 pl-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand focus:border-transparent transition-all"
                    placeholder="5XX XXX XXXX"
                    dir="ltr"
                  />
                </div>
              </div>
            </div>
            
            {/* Submit Button */}
            <button
              type="submit"
              disabled={isUpdatingProfile}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-l from-brand to-brand-600 hover:bg-brand-600 text-white font-medium rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUpdatingProfile ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  <span>حفظ التغييرات</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Change Password Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg">
          <div className="px-6 py-4 bg-gradient-to-l from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-b border-gray-100 dark:border-gray-700 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-lg">
                <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">تغيير كلمة المرور</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">تأمين حسابك بكلمة مرور قوية</p>
              </div>
            </div>
          </div>
          
          <form onSubmit={handleChangePassword} className="p-6 space-y-5">
            {/* Current Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                كلمة المرور الحالية
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Lock size={18} />
                </div>
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full pr-10 pl-12 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  placeholder="أدخل كلمة المرور الحالية"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            
            {/* New Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                كلمة المرور الجديدة
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Lock size={18} />
                </div>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pr-10 pl-12 py-3 border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                  placeholder="أدخل كلمة المرور الجديدة"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              
              {/* Password Strength Indicator */}
              {newPassword && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={`h-1.5 flex-1 rounded-full transition-all ${
                          passwordStrength.level >= level ? passwordStrength.color : 'bg-gray-200 dark:bg-gray-600'
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-sm ${
                    passwordStrength.level <= 1 ? 'text-red-500' :
                    passwordStrength.level === 2 ? 'text-yellow-500' :
                    passwordStrength.level === 3 ? 'text-blue-500' :
                    'text-green-500'
                  }`}>
                    قوة كلمة المرور: {passwordStrength.text}
                  </p>
                </div>
              )}
            </div>
            
            {/* Confirm New Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                تأكيد كلمة المرور الجديدة
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Lock size={18} />
                </div>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full pr-10 pl-12 py-3 border rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all ${
                    confirmPassword && confirmPassword !== newPassword
                      ? 'border-red-300 dark:border-red-600'
                      : confirmPassword && confirmPassword === newPassword
                      ? 'border-green-300 dark:border-green-600'
                      : 'border-gray-200 dark:border-gray-600'
                  }`}
                  placeholder="أعد إدخال كلمة المرور الجديدة"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              
              {/* Match indicator */}
              {confirmPassword && (
                <div className="mt-2 flex items-center gap-2">
                  {confirmPassword === newPassword ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-sm text-green-500">كلمات المرور متطابقة</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      <span className="text-sm text-red-500">كلمات المرور غير متطابقة</span>
                    </>
                  )}
                </div>
              )}
            </div>
            
            {/* Submit Button */}
            <button
              type="submit"
              disabled={isChangingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-l from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-medium rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChangingPassword ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري التغيير...</span>
                </>
              ) : (
                <>
                  <Lock className="w-5 h-5" />
                  <span>تغيير كلمة المرور</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Account Info Card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">معلومات الحساب</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">الخطة الحالية</p>
            <p className="font-bold text-gray-900 dark:text-white">
              {user?.subscriptionPlan === 'trial' ? 'تجريبية' :
               user?.subscriptionPlan === 'comments' ? 'التعليقات' :
               user?.subscriptionPlan === 'single' ? 'القناة الواحدة' :
               user?.subscriptionPlan === 'social' ? 'السوشيال' :
               user?.subscriptionPlan === 'yearly' ? 'السنوية' :
               user?.subscriptionPlan === 'starter' ? 'Starter (قديم)' :
               user?.subscriptionPlan === 'pro' ? 'Pro (قديم)' :
               user?.subscriptionPlan === 'business' ? 'Business (قديم)' :
               user?.subscriptionPlan || 'غير محدد'}
            </p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">تاريخ التسجيل</p>
            <p className="font-bold text-gray-900 dark:text-white">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('ar-SA-u-nu-latn') : 'غير متوفر'}
            </p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">حالة الحساب</p>
            <p className="font-bold text-green-600 dark:text-green-400 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              نشط
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;

