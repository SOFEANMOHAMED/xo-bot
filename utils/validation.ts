/**
 * Validation utilities for form inputs
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate email format
 */
export const validateEmail = (email: string): ValidationResult => {
  const errors: string[] = [];
  
  if (!email || email.trim() === '') {
    errors.push('البريد الإلكتروني مطلوب');
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push('البريد الإلكتروني غير صحيح');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate password strength
 */
export const validatePassword = (password: string, minLength: number = 6): ValidationResult => {
  const errors: string[] = [];
  
  if (!password || password.length === 0) {
    errors.push('كلمة المرور مطلوبة');
  } else {
    if (password.length < minLength) {
      errors.push(`كلمة المرور يجب أن تكون ${minLength} أحرف على الأقل`);
    }
    if (password.length > 128) {
      errors.push('كلمة المرور طويلة جداً (الحد الأقصى 128 حرف)');
    }
    // Check for common weak passwords
    const weakPasswords = ['password', '123456', '12345678', 'qwerty', 'abc123'];
    if (weakPasswords.includes(password.toLowerCase())) {
      errors.push('كلمة المرور ضعيفة جداً. يرجى اختيار كلمة مرور أقوى');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate required field
 */
export const validateRequired = (value: string | number | null | undefined, fieldName: string, allowZero: boolean = false): ValidationResult => {
  const errors: string[] = [];
  
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    errors.push(`${fieldName} مطلوب`);
  } else if (!allowZero && typeof value === 'number' && value === 0) {
    errors.push(`${fieldName} مطلوب`);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate number range
 */
export const validateNumberRange = (
  value: number | string, 
  min: number, 
  max: number, 
  fieldName: string
): ValidationResult => {
  const errors: string[] = [];
  
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(numValue)) {
    errors.push(`${fieldName} يجب أن يكون رقماً`);
  } else {
    if (numValue < min) {
      errors.push(`${fieldName} يجب أن يكون أكبر من أو يساوي ${min}`);
    }
    if (numValue > max) {
      errors.push(`${fieldName} يجب أن يكون أصغر من أو يساوي ${max}`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate phone number (supports international formats)
 */
export const validatePhone = (phone: string, required: boolean = true): ValidationResult => {
  const errors: string[] = [];
  
  if (!phone || phone.trim() === '') {
    if (required) {
      errors.push('رقم الهاتف مطلوب');
    }
  } else {
    // Remove spaces, dashes, and parentheses
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    // Check if it's a valid phone number (at least 7 digits, can start with +)
    const phoneRegex = /^(\+?[0-9]{1,3})?[0-9]{7,15}$/;
    if (!phoneRegex.test(cleaned)) {
      errors.push('رقم الهاتف غير صحيح. يجب أن يحتوي على 7-15 رقم');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate URL format
 */
export const validateURL = (url: string, required: boolean = false): ValidationResult => {
  const errors: string[] = [];
  
  if (!url || url.trim() === '') {
    if (required) {
      errors.push('الرابط مطلوب');
    }
  } else {
    try {
      // Add protocol if missing
      let urlToTest = url;
      if (!urlToTest.match(/^https?:\/\//)) {
        urlToTest = 'https://' + urlToTest;
      }
      new URL(urlToTest);
    } catch (e) {
      errors.push('الرابط غير صحيح. يجب أن يكون بصيغة صحيحة (مثال: https://example.com)');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate text length
 */
export const validateLength = (
  value: string,
  min: number,
  max: number,
  fieldName: string
): ValidationResult => {
  const errors: string[] = [];
  
  if (!value) {
    errors.push(`${fieldName} مطلوب`);
  } else {
    const length = value.trim().length;
    if (length < min) {
      errors.push(`${fieldName} يجب أن يكون ${min} أحرف على الأقل`);
    }
    if (length > max) {
      errors.push(`${fieldName} يجب أن يكون ${max} أحرف كحد أقصى`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate product data
 */
export const validateProduct = (product: {
  name?: string;
  price?: number;
  category?: string;
  stock?: number;
}): ValidationResult => {
  const errors: string[] = [];
  
  const nameValidation = validateRequired(product.name, 'اسم المنتج');
  if (!nameValidation.isValid) {
    errors.push(...nameValidation.errors);
  }
  
  if (product.price !== undefined && product.price !== null) {
    const priceValidation = validateNumberRange(product.price, 0.01, 1000000, 'السعر');
    if (!priceValidation.isValid) {
      errors.push(...priceValidation.errors);
    }
  } else {
    errors.push('السعر مطلوب');
  }
  
  const categoryValidation = validateRequired(product.category, 'الفئة');
  if (!categoryValidation.isValid) {
    errors.push(...categoryValidation.errors);
  }
  
  if (product.stock !== undefined) {
    const stockValidation = validateNumberRange(product.stock, 0, 1000000, 'الكمية');
    if (!stockValidation.isValid) {
      errors.push(...stockValidation.errors);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate service data
 */
export const validateService = (service: {
  name?: string;
  shortDescription?: string;
  priceLabel?: string;
}): ValidationResult => {
  const errors: string[] = [];
  
  const nameValidation = validateRequired(service.name, 'اسم الخدمة');
  if (!nameValidation.isValid) {
    errors.push(...nameValidation.errors);
  }
  
  const descriptionValidation = validateRequired(service.shortDescription, 'الوصف القصير');
  if (!descriptionValidation.isValid) {
    errors.push(...descriptionValidation.errors);
  }
  
  const priceLabelValidation = validateRequired(service.priceLabel, 'تسمية السعر');
  if (!priceLabelValidation.isValid) {
    errors.push(...priceLabelValidation.errors);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate user registration data
 */
export const validateUserRegistration = (data: {
  email?: string;
  password?: string;
  name?: string;
  phone?: string;
}): ValidationResult => {
  const errors: string[] = [];
  
  const emailValidation = validateEmail(data.email || '');
  if (!emailValidation.isValid) {
    errors.push(...emailValidation.errors);
  }
  
  const passwordValidation = validatePassword(data.password || '');
  if (!passwordValidation.isValid) {
    errors.push(...passwordValidation.errors);
  }
  
  const nameValidation = validateRequired(data.name, 'الاسم');
  if (!nameValidation.isValid) {
    errors.push(...nameValidation.errors);
  }
  
  const phoneValidation = validatePhone(data.phone || '');
  if (!phoneValidation.isValid) {
    errors.push(...phoneValidation.errors);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

