/**
 * English Message Templates
 * Single source of truth for English messages
 */

// ==================== GREETINGS ====================

export const GREETINGS = {
  welcome: 'Hello! How can I help you today?',
  welcome_back: 'Welcome back! How can I help you?',
  morning: 'Good morning! How can I help you?',
  evening: 'Good evening! How can I help you?'
};

// ==================== PRODUCT RELATED ====================

export const PRODUCTS = {
  found_single: (name: string, price: number, currency: string) =>
    `We have ${name} for ${price} ${currency}.`,
  
  found_multiple: (count: number) =>
    `We have ${count} products available.`,
  
  not_found: 'Sorry, we couldn\'t find that product. Can you specify what you\'re looking for?',
  
  out_of_stock: (name: string) =>
    `Unfortunately, ${name} is currently out of stock.`,
  
  low_stock: (name: string, count: number) =>
    `${name} has limited stock (only ${count} left). Order quickly!`,
  
  in_stock: (name: string, count: number) =>
    `${name} is available (${count} units).`,
  
  which_prefer: 'Which product do you prefer?',
  want_more_info: 'Would you like to know more?',
  proceed_with_order: 'Would you like to proceed with the order?'
};

// ==================== ORDER RELATED ====================

export const ORDERS = {
  preparing: 'Sure! To prepare your order, please provide:',
  
  ask_name: 'What is your full name?',
  ask_phone: 'What is your phone number?',
  ask_address: 'What is your detailed address? (Please include neighborhood or street)',
  ask_delivery_time: 'What is the suitable delivery time?',
  ask_city: 'Which city would you like delivery to?',
  
  confirmed: (name: string, storeName: string) =>
    `Thank you for your trust ${name}! 🙏\n\nYour order has been received successfully from ${storeName}, and we will contact you soon to confirm it.`,
  
  summary: 'Your order summary:',
  total: 'Total:',
  
  ready_soon: 'Once I receive this info, I\'ll prepare your order right away! ✨'
};

// ==================== OBJECTIONS ====================

export const OBJECTIONS = {
  price: {
    understand: 'We understand price is important.',
    cheaper_available: 'Would you like to see cheaper alternatives?',
    budget_question: 'What is your preferred budget?',
    value_focus: 'This product features high quality and warranty.'
  },
  
  trust: {
    understand: 'We appreciate your concern for trust.',
    warranty: 'We offer full warranty and a convenient return policy.',
    payment: 'You can pay on delivery.',
    reviews: 'We have excellent reviews from our customers.'
  },
  
  shipping: {
    ask_city: 'Which city do you need delivery to for accurate information?',
    available: (city: string) => `Delivery to ${city} is available.`,
    tracking: 'We provide shipment tracking.'
  },
  
  quality: {
    assurance: 'Our products are of high quality.',
    premium: 'Would you like to see our best quality options?',
    return_policy: 'If you\'re not satisfied, you can return it.'
  }
};

// ==================== CLARIFICATION ====================

export const CLARIFY = {
  what_product: 'What product are you looking for?',
  which_product: 'Which product do you mean?',
  what_looking_for: 'What exactly are you looking for?',
  price_for_what: 'Which product would you like to know the price for?',
  more_details: 'Can you give me more details?'
};

// ==================== ERRORS ====================

export const ERRORS = {
  general: 'Sorry, an error occurred. Please try again.',
  rate_limit: 'Sorry, the service is currently busy. Please try again shortly.',
  timeout: 'The response took too long. How can I help you?',
  not_found: 'Sorry, we couldn\'t find what you\'re looking for.',
  validation: 'Sorry, we didn\'t understand your request. Please rephrase it.'
};

// ==================== SUPPORT ====================

export const SUPPORT = {
  handoff: 'We apologize for any inconvenience. Can you tell us more about the issue?',
  escalating: 'I\'ll transfer you to the support team.',
  thanks: 'Thank you for contacting us!'
};

// ==================== CONFIRMATION ====================

export const CONFIRM = {
  yes_options: ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'confirm', 'correct'],
  no_options: ['no', 'nope', 'cancel', 'never mind'],
  
  is_correct: 'Is this information correct?',
  confirmed: 'Confirmed.',
  cancelled: 'Cancelled. How can I help you?'
};

// ==================== EMOJIS ====================

export const EMOJIS = {
  success: '✅',
  warning: '⚠️',
  error: '❌',
  cart: '🛒',
  package: '📦',
  money: '💰',
  phone: '📞',
  location: '📍',
  time: '⏰',
  star: '⭐',
  heart: '❤️',
  fire: '🔥',
  sparkle: '✨'
};
