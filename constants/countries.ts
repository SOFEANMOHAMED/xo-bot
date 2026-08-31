export interface Country {
  code: string;
  dialCode: string;
  name: string;
  nameAr: string;
  flag: string;
}

/** Default when visitor country cannot be resolved */
export const DEFAULT_DIAL_CODE = '+966';

export const COUNTRIES: Country[] = [
  { code: 'SA', dialCode: '+966', name: 'Saudi Arabia', nameAr: 'السعودية', flag: '🇸🇦' },
  { code: 'AE', dialCode: '+971', name: 'United Arab Emirates', nameAr: 'الإمارات', flag: '🇦🇪' },
  { code: 'KW', dialCode: '+965', name: 'Kuwait', nameAr: 'الكويت', flag: '🇰🇼' },
  { code: 'QA', dialCode: '+974', name: 'Qatar', nameAr: 'قطر', flag: '🇶🇦' },
  { code: 'BH', dialCode: '+973', name: 'Bahrain', nameAr: 'البحرين', flag: '🇧🇭' },
  { code: 'OM', dialCode: '+968', name: 'Oman', nameAr: 'عمان', flag: '🇴🇲' },
  { code: 'JO', dialCode: '+962', name: 'Jordan', nameAr: 'الأردن', flag: '🇯🇴' },
  { code: 'LB', dialCode: '+961', name: 'Lebanon', nameAr: 'لبنان', flag: '🇱🇧' },
  { code: 'IQ', dialCode: '+964', name: 'Iraq', nameAr: 'العراق', flag: '🇮🇶' },
  { code: 'EG', dialCode: '+20', name: 'Egypt', nameAr: 'مصر', flag: '🇪🇬' },
  { code: 'MA', dialCode: '+212', name: 'Morocco', nameAr: 'المغرب', flag: '🇲🇦' },
  { code: 'DZ', dialCode: '+213', name: 'Algeria', nameAr: 'الجزائر', flag: '🇩🇿' },
  { code: 'TN', dialCode: '+216', name: 'Tunisia', nameAr: 'تونس', flag: '🇹🇳' },
  { code: 'LY', dialCode: '+218', name: 'Libya', nameAr: 'ليبيا', flag: '🇱🇾' },
  { code: 'SD', dialCode: '+249', name: 'Sudan', nameAr: 'السودان', flag: '🇸🇩' },
  { code: 'YE', dialCode: '+967', name: 'Yemen', nameAr: 'اليمن', flag: '🇾🇪' },
  { code: 'SY', dialCode: '+963', name: 'Syria', nameAr: 'سوريا', flag: '🇸🇾' },
  { code: 'PS', dialCode: '+970', name: 'Palestine', nameAr: 'فلسطين', flag: '🇵🇸' },
  { code: 'IL', dialCode: '+972', name: 'Israel', nameAr: 'إسرائيل', flag: '🇮🇱' },
  { code: 'US', dialCode: '+1', name: 'United States', nameAr: 'الولايات المتحدة', flag: '🇺🇸' },
  { code: 'GB', dialCode: '+44', name: 'United Kingdom', nameAr: 'المملكة المتحدة', flag: '🇬🇧' },
  { code: 'FR', dialCode: '+33', name: 'France', nameAr: 'فرنسا', flag: '🇫🇷' },
  { code: 'DE', dialCode: '+49', name: 'Germany', nameAr: 'ألمانيا', flag: '🇩🇪' },
  { code: 'IT', dialCode: '+39', name: 'Italy', nameAr: 'إيطاليا', flag: '🇮🇹' },
  { code: 'ES', dialCode: '+34', name: 'Spain', nameAr: 'إسبانيا', flag: '🇪🇸' },
  { code: 'TR', dialCode: '+90', name: 'Turkey', nameAr: 'تركيا', flag: '🇹🇷' },
  { code: 'IN', dialCode: '+91', name: 'India', nameAr: 'الهند', flag: '🇮🇳' },
  { code: 'PK', dialCode: '+92', name: 'Pakistan', nameAr: 'باكستان', flag: '🇵🇰' },
  { code: 'BD', dialCode: '+880', name: 'Bangladesh', nameAr: 'بنغلاديش', flag: '🇧🇩' },
  { code: 'CN', dialCode: '+86', name: 'China', nameAr: 'الصين', flag: '🇨🇳' },
  { code: 'JP', dialCode: '+81', name: 'Japan', nameAr: 'اليابان', flag: '🇯🇵' },
  { code: 'KR', dialCode: '+82', name: 'South Korea', nameAr: 'كوريا الجنوبية', flag: '🇰🇷' },
  { code: 'AU', dialCode: '+61', name: 'Australia', nameAr: 'أستراليا', flag: '🇦🇺' },
  { code: 'CA', dialCode: '+1', name: 'Canada', nameAr: 'كندا', flag: '🇨🇦' },
  { code: 'BR', dialCode: '+55', name: 'Brazil', nameAr: 'البرازيل', flag: '🇧🇷' },
  { code: 'MX', dialCode: '+52', name: 'Mexico', nameAr: 'المكسيك', flag: '🇲🇽' },
  { code: 'RU', dialCode: '+7', name: 'Russia', nameAr: 'روسيا', flag: '🇷🇺' },
  { code: 'ZA', dialCode: '+27', name: 'South Africa', nameAr: 'جنوب أفريقيا', flag: '🇿🇦' },
  { code: 'NG', dialCode: '+234', name: 'Nigeria', nameAr: 'نيجيريا', flag: '🇳🇬' },
  { code: 'KE', dialCode: '+254', name: 'Kenya', nameAr: 'كينيا', flag: '🇰🇪' },
];

export function dialCodeForCountryIso(iso: string | null | undefined): string | null {
  if (!iso || iso.length !== 2) return null;
  const upper = iso.toUpperCase();
  const match = COUNTRIES.find((c) => c.code === upper);
  return match?.dialCode ?? null;
}

export function extractCountryFromPhone(fullPhone: string): { countryCode: string; phone: string } {
  if (!fullPhone) return { countryCode: DEFAULT_DIAL_CODE, phone: '' };

  const sorted = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  for (const country of sorted) {
    if (fullPhone.startsWith(country.dialCode)) {
      return {
        countryCode: country.dialCode,
        phone: fullPhone.slice(country.dialCode.length).trim(),
      };
    }
  }

  return { countryCode: DEFAULT_DIAL_CODE, phone: fullPhone };
}
