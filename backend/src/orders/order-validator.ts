/**
 * Order Validator - Validate order information
 * Multi-language support for SaaS
 */

import type { OrderData, Language, Message } from '../core/types.js';
import { logger } from '../utils/logger.js';

// ==================== TYPES ====================

export interface ValidationResult {
  isValid: boolean;
  missingFields: string[];
  extractedData: Partial<OrderData>;
  errors: string[];
}

export interface OrderFieldLabels {
  name: string;
  phone: string;
  address: string;
}

// ==================== FIELD LABELS ====================

const FIELD_LABELS: Record<Language, OrderFieldLabels> = {
  arabic: {
    name: 'الاسم الكامل',
    phone: 'رقم الهاتف',
    address: 'العنوان بالتفصيل'
  },
  english: {
    name: 'Full Name',
    phone: 'Phone Number',
    address: 'Detailed Address'
  }
};

// ==================== VALIDATION PATTERNS ====================

// Phone patterns (Syria, Middle East, International)
const PHONE_PATTERNS = [
  /\+?963[0-9]{8,9}/,           // Syria
  /09[0-9]{8}/,                  // Syria mobile
  /0[67][0-9]{8}/,               // Other formats
  /\+?[0-9]{7,15}/               // International
];

// Arabic to English numerals
const normalizePhone = (text: string): string => {
  return text
    .replace(/[٠]/g, '0')
    .replace(/[١]/g, '1')
    .replace(/[٢]/g, '2')
    .replace(/[٣]/g, '3')
    .replace(/[٤]/g, '4')
    .replace(/[٥]/g, '5')
    .replace(/[٦]/g, '6')
    .replace(/[٧]/g, '7')
    .replace(/[٨]/g, '8')
    .replace(/[٩]/g, '9')
    .replace(/[\s\-\.]/g, '');
};

// ==================== EXTRACTION FUNCTIONS ====================

/**
 * Extract name from text
 */
export const extractName = (text: string, recentMessages: Message[] = []): string | null => {
  const allText = recentMessages.map(m => m.content).join(' ') + ' ' + text;
  
  // Pattern: اسمي X or my name is X
  const nameMatch = allText.match(
    /(?:اسم[ي]?|name|الاسم|اسمي|my name is|انا)[\s:]+([أ-يa-zA-Z\s]{3,40})/i
  );
  
  if (nameMatch?.[1]) {
    console.log('[extractName] Found name from pattern:', nameMatch[1]);
    return nameMatch[1].trim();
  }

  // Check if current message is just a name (2+ Arabic/English words)
  const words = text.trim().split(/\s+/);
  if (words.length >= 2 && words.length <= 5) {
    const isArabicName = /^[أ-ي\s]{4,40}$/.test(text.trim());
    const isEnglishName = /^[a-zA-Z\s]{4,40}$/.test(text.trim());
    
    console.log('[extractName] Testing current text:', { 
      text, 
      words: words.length, 
      isArabicName, 
      isEnglishName 
    });
    
    if (isArabicName || isEnglishName) {
      // ✅ ENHANCED: Use regex patterns for better matching (handles typos)
      const excludedPatterns = [
        /^(السلام|سلام|مرحبا|أهلا|هلا|صباح|مساء)/i,  // Greetings (start with)
        /عليكم|عليك/i,  // Common greeting suffix
        /\b(بدي|ابي|اريد|عاوز|حابب|ابغى|ابغا)\b/i,  // Want/Need verbs
        /\b(اطلب|أطلب|اشتري|احجز|اشوف|أشوف)\b/i  // Action verbs
      ];
      
      const isExcluded = excludedPatterns.some(pattern => pattern.test(text));
      
      console.log('[extractName] Exclusion check:', { 
        isExcluded, 
        text: text 
      });
      
      if (!isExcluded) {
        console.log('[extractName] Extracted name from current text:', text.trim());
        return text.trim();
      } else {
        console.log('[extractName] Text excluded due to greeting/action patterns');
      }
    }
  }

  console.log('[extractName] No name extracted');
  return null;
};

/**
 * Extract phone from text
 */
export const extractPhone = (text: string, recentMessages: Message[] = []): string | null => {
  const allText = recentMessages.map(m => m.content).join(' ') + ' ' + text;
  const normalized = normalizePhone(allText);
  
  for (const pattern of PHONE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const phone = match[0].replace(/[^\d+]/g, '');
      if (phone.length >= 7) {
        return phone;
      }
    }
  }
  
  return null;
};

/**
 * Extract address from text
 */
export const extractAddress = (text: string, recentMessages: Message[] = []): string | null => {
  const allText = recentMessages.map(m => m.content).join(' ') + ' ' + text;
  
  // Pattern with keyword
  const addressMatch = allText.match(
    /(?:عنوان|address|مكان|مدينة|العنوان|المنطقة|الحي|الشارع|street)[\s:]+([أ-ي\s،,0-9]{5,})/i
  );
  
  if (addressMatch?.[1]) {
    return addressMatch[1].trim();
  }

  // Check if message looks like an address (contains street/area indicators)
  const addressIndicators = ['شارع', 'منطقة', 'حي', 'حارة', 'مبنى', 'بناية', 'طابق', 'سوق', 'دوار', 'موقف', 'قرب', 'جنب', 'خلف', 'street', 'building', 'floor', 'near', 'next to'];
  if (addressIndicators.some(ind => text.toLowerCase().includes(ind))) {
    return text.trim();
  }

  // If message contains a city + additional detail, treat it as address
  const city = extractCity(text) || extractCity(allText);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (city && words.length >= 2) {
    return text.trim();
  }

  return null;
};

/**
 * Extract delivery time from text
 */
export const extractDeliveryTime = (text: string, recentMessages: Message[] = []): string | null => {
  const allText = recentMessages.map(m => m.content).join(' ') + ' ' + text;
  
  const timePatterns = [
    // Arabic days and times
    /اليوم|بكرا|غداً|غدا/i,
    /السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة/i,
    /صباحاً|مساءً|الظهر|بعد الظهر|المساء|الصبح|العصر|الليل|ليلاً/i,
    /الساعة\s*\d{1,2}(:\d{2})?/i,
    // English
    /today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i,
    /morning|afternoon|evening|night/i,
    /\d{1,2}(:\d{2})?\s*(am|pm)/i
  ];
  
  for (const pattern of timePatterns) {
    const match = allText.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }
  
  return null;
};

/**
 * Extract city from text
 */
export const extractCity = (text: string): string | null => {
  const syrianCities = [
    'دمشق', 'حلب', 'حمص', 'اللاذقية', 'طرطوس', 'حماة', 'الرقة', 'دير الزور',
    'السويداء', 'درعا', 'القنيطرة', 'ادلب', 'الحسكة',
    'damascus', 'aleppo', 'homs', 'latakia', 'tartus', 'hama'
  ];
  
  const textLower = text.toLowerCase();
  for (const city of syrianCities) {
    if (textLower.includes(city.toLowerCase())) {
      return city;
    }
  }
  
  return null;
};

// ==================== MAIN VALIDATION ====================

/**
 * Validate order and extract information
 */
export const validateOrder = (
  currentMessage: string,
  recentMessages: Message[],
  language: Language = 'arabic'
): ValidationResult => {
  const labels = FIELD_LABELS[language];
  const missingFields: string[] = [];
  const errors: string[] = [];

  // Extract all fields
  const name = extractName(currentMessage, recentMessages);
  const phone = extractPhone(currentMessage, recentMessages);
  const address = extractAddress(currentMessage, recentMessages);
  const deliveryTime = extractDeliveryTime(currentMessage, recentMessages);
  const city = extractCity(currentMessage) || extractCity(recentMessages.map(m => m.content).join(' '));

  // Check for missing fields
  if (!name) missingFields.push(labels.name);
  if (!phone) missingFields.push(labels.phone);
  if (!address) missingFields.push(labels.address);
  // deliveryTime is optional

  // Validate address completeness
  // ✅ ENHANCED: More strict address validation
  if (address) {
    const addressIndicators = ['شارع', 'منطقة', 'حي', 'مبنى', 'بناية', 'طابق', 'street', 'area', 'building', 'floor', 'near', 'قرب', 'جنب'];
    const hasDetailedAddress = addressIndicators.some(ind => address.toLowerCase().includes(ind));
    
    // ✅ Increased minimum length from 15 to 20 characters for better accuracy
    if (!hasDetailedAddress && address.length < 20) {
      // Address is too vague (just city name)
      if (!missingFields.includes(labels.address)) {
        missingFields.push(labels.address);
      }
      errors.push(language === 'arabic' 
        ? 'العنوان غير مكتمل - يرجى ذكر المنطقة والشارع ورقم المبنى'
        : 'Address is incomplete - please include area, street and building number');
    } else if (hasDetailedAddress && address.length < 10) {
      // Even with indicators, too short
      if (!missingFields.includes(labels.address)) {
        missingFields.push(labels.address);
      }
      errors.push(language === 'arabic'
        ? 'العنوان قصير جداً - يرجى إضافة المزيد من التفاصيل'
        : 'Address is too short - please add more details');
    }
  }

  // Validate phone format
  if (phone && phone.length < 7) {
    errors.push(language === 'arabic'
      ? 'رقم الهاتف غير صحيح'
      : 'Phone number is invalid');
  }

  const extractedData: Partial<OrderData> = {
    customerName: name || undefined,
    customerPhone: phone || undefined,
    customerAddress: address || undefined,
    deliveryTime: deliveryTime || undefined,
    city: city || undefined
  };

  const isValid = missingFields.length === 0 && errors.length === 0;

  logger.debug('Order validation completed', {
    isValid,
    missingFieldsCount: missingFields.length,
    errorsCount: errors.length
  });

  return {
    isValid,
    missingFields,
    extractedData,
    errors
  };
};

/**
 * Check if all mandatory fields are present
 */
export const hasAllMandatoryFields = (orderData: Partial<OrderData>): boolean => {
  return !!(
    orderData.customerName &&
    orderData.customerPhone &&
    orderData.customerAddress
  );
};

/**
 * Get next missing field
 */
export const getNextMissingField = (
  missingFields: string[],
  language: Language = 'arabic'
): string | null => {
  if (missingFields.length === 0) return null;
  
  // Priority order
  const labels = FIELD_LABELS[language];
  const priority = [labels.name, labels.phone, labels.address];
  
  for (const field of priority) {
    if (missingFields.includes(field)) {
      return field;
    }
  }
  
  return missingFields[0];
};
