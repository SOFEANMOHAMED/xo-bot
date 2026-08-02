import React, { useState, useRef, useEffect } from 'react';
import { Product, Service, MerchantSettings, ChatMessage, BotPersona, Order } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { Send, Bot, RefreshCw, AlertCircle, Facebook, MessageSquare, Sparkles, ShoppingCart, Plus, Check } from 'lucide-react';

interface BotPlaygroundProps {
  products: Product[];
  services?: Service[];
  settings: MerchantSettings;
  onNewQuery: () => void;
  onAddOrder: (order: Order) => void;
}

const BotPlayground: React.FC<BotPlaygroundProps> = ({ products, services = [], settings, onNewQuery, onAddOrder }) => {
  // Safe initialization with fallback to prevent undefined error
  const [messages, setMessages] = useState<ChatMessage[]>([
    { 
      id: '1', 
      role: 'assistant', 
      content: settings?.welcomeMessage || 'أهلاً بك! كيف يمكنني مساعدتك؟', 
      timestamp: new Date(), 
      platform: 'web' 
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [testPlatform, setTestPlatform] = useState<'web' | 'facebook_messenger' | 'facebook_comment'>('web');
  const [testPersona, setTestPersona] = useState<BotPersona>(settings?.botPersona || 'friendly');
  const [botType, setBotType] = useState<'products' | 'services'>('products');
  const [orderCreated, setOrderCreated] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Unique per playground session so reset starts a fresh backend conversation
  const [playgroundSessionId, setPlaygroundSessionId] = useState(() => `playground-${Date.now()}`);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync testPersona if global settings change
  useEffect(() => {
    if (settings && settings.botPersona) {
      setTestPersona(settings.botPersona);
    }
  }, [settings]);

  // Update welcome message if settings load later
  useEffect(() => {
    if (settings?.welcomeMessage && messages.length === 1 && messages[0].role === 'assistant') {
       // Only update if it's the initial state
       try {
         setMessages([{ ...messages[0], content: settings.welcomeMessage }]);
       } catch (err) {
         logger.error('Error updating welcome message:', err);
       }
    }
  }, [settings?.welcomeMessage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !settings) return;

    try {
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: input,
        timestamp: new Date(),
        platform: testPlatform
      };

      const newHistory = [...messages, userMsg];
      setMessages(newHistory);
      setInput('');
      setLoading(true);
      setError(null);
      onNewQuery();

      // Get or create conversation
      let currentConversationId = conversationId;
      if (!currentConversationId) {
        try {
          const convResponse = await apiService.getOrCreateConversation(testPlatform, playgroundSessionId);
          currentConversationId = convResponse.conversation.id;
          setConversationId(currentConversationId);
        } catch (err) {
          logger.error('Error getting or creating conversation:', err);
          // Continue without conversation ID
        }
      }

      // Prepare messages for API (remove IDs and timestamps)
      const apiMessages = newHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Call AI API
      const aiResponse = await apiService.generateChatResponse({
        conversationId: currentConversationId || undefined,
        platform: testPlatform,
        botType: botType, // ✅ Use selected bot type
        messages: apiMessages,
        context: {
          products: products || [],
          services: services || [], // ✅ Pass services to bot
          storeName: settings?.storeName || 'المتجر',
          storeCurrency: settings?.storeCurrency || 'USD',
          systemPrompt: settings?.systemPrompt || '',
          persona: testPersona,
          policies: settings?.storePolicies || {
            shippingPolicy: '',
            deliveryTime: '',
            paymentMethods: '',
            returnPolicy: '',
            additionalNotes: '',
            enableAIInjection: false
          }
        }
      });

      const responseText = aiResponse.response;
      
      // Update conversation ID if it was created
      if (aiResponse.conversationId && !currentConversationId) {
        setConversationId(aiResponse.conversationId);
      }
      
      // Extract order data from response if present
      const orderDataMatch = responseText.match(/\[ORDER_DATA\]([\s\S]*?)\[\/ORDER_DATA\]/);
      let cleanedResponse = responseText.replace(/\[ORDER_DATA\][\s\S]*?\[\/ORDER_DATA\]/g, '').trim();
      
      if (orderDataMatch) {
        try {
          const orderData = JSON.parse(orderDataMatch[1].trim());
          
          // Validate order data
          if (orderData.customerName && orderData.customerPhone && orderData.customerAddress && orderData.products && orderData.products.length > 0) {
            // Validate that product IDs exist in products list
            const validProducts = orderData.products.filter((item: any) => {
              return products?.some(p => p.id === item.productId);
            });
            
            if (validProducts.length === 0) {
              logger.warn('No valid products found in order data');
            } else {
              // Create order
              const orderId = `#ORD-${Math.floor(Math.random() * 10000)}`;
              
              // Calculate total from valid products
              const total = orderData.total || validProducts.reduce((sum: number, item: any) => {
                const product = products?.find(p => p.id === item.productId);
                return sum + ((product?.price || item.price) * (item.quantity || 1));
              }, 0);
              
              const newOrder: Order = {
                id: `ord_${Date.now()}`,
                externalId: orderId,
                customerName: orderData.customerName.trim(),
                customerEmail: orderData.customerEmail?.trim() || `${orderData.customerPhone.replace(/\s+/g, '')}@chat-order.com`,
                total: total,
                currency: settings?.storeCurrency || 'USD',
                status: 'pending',
                date: new Date(),
                source: 'manual',
                items: validProducts.map((item: any) => {
                  const product = products?.find(p => p.id === item.productId);
                  return {
                    productId: item.productId,
                    productName: item.productName || product?.name || 'منتج غير معروف',
                    quantity: item.quantity || 1,
                    price: product?.price || item.price || 0,
                    currency: settings?.storeCurrency || 'USD'
                  };
                })
              };
              
              // Add order to orders list
              onAddOrder(newOrder);
              
              // Single success banner (avoid duplicating the same text inside the bot bubble)
              const orderSuccessMsg: ChatMessage = {
                id: (Date.now() + 2).toString(),
                role: 'system',
                content: `✅ تم استلام طلبك بنجاح! رقم الطلب: ${orderId}. يمكنك رؤيته في قسم "الطلبات".`,
                timestamp: new Date()
              };
              
              setMessages(prev => [...prev, orderSuccessMsg]);
              setOrderCreated(true);
            }
          } else {
            logger.warn('Incomplete order data:', orderData);
          }
        } catch (err) {
          logger.error('Error parsing order data:', err);
          // Don't show error to user, just log it
        }
      }
      
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: cleanedResponse || 'عذراً، لم أتمكن من إرسال رد. يرجى المحاولة مرة أخرى.',
        timestamp: new Date(),
        platform: testPlatform
      };
      
      setMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      logger.error('Error in handleSend:', err);
      setError(err?.message || "فشل الاتصال بخدمة الذكاء الاصطناعي");
      // Add error message to chat
      const errorMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'عذراً، حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى.',
        timestamp: new Date(),
        platform: testPlatform
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const resetChat = () => {
    setMessages([{ 
        id: '1', 
        role: 'assistant', 
        content: settings ? settings.welcomeMessage : 'أهلاً بك!', 
        timestamp: new Date(), 
        platform: testPlatform 
    }]);
    setOrderCreated(false);
    setConversationId(null);
    setPlaygroundSessionId(`playground-${Date.now()}`);
    setError(null);
  };

  // Function to simulate order creation from chat data
  const handleCreateOrder = () => {
    if (!settings) return;

    // Pick the first product as the ordered item for simulation
    const randomProduct = products[0]; 
    if (!randomProduct) {
        setError("لا توجد منتجات لإنشاء طلب.");
        return;
    }

    const orderId = `#ORD-${Math.floor(Math.random() * 10000)}`;
    
    const newOrder: Order = {
        id: `ord_${Date.now()}`,
        externalId: orderId,
        customerName: 'عميل المحادثة (تجريبي)',
        customerEmail: 'chat_customer@example.com',
        total: randomProduct.price,
        currency: settings.storeCurrency,
        status: 'pending',
        date: new Date(),
        source: 'manual', 
        items: [
            {
                productId: randomProduct.id,
                productName: randomProduct.name,
                quantity: 1,
                price: randomProduct.price,
                currency: settings.storeCurrency
            }
        ]
    };

    onAddOrder(newOrder);
    setOrderCreated(true);
    
    // Add system message to chat indicating order creation
    setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'system',
        content: `🎉 تم استلام الطلب بنجاح! رقم الطلب: ${orderId}. يمكنك رؤيته في قسم "الطلبات".`,
        timestamp: new Date()
    }]);

    setTimeout(() => setOrderCreated(false), 3000);
  };

  const personaLabels: Record<BotPersona, string> = {
    formal: 'رسمي (Formal)',
    friendly: 'ودود (Friendly)',
    sales: 'مبيعات (Sales)',
    fast: 'سريع (Fast)',
    luxury: 'فخم (Luxury)'
  };

  // Helper to extract image URL from bot text
  const parseMessageContent = (content: string) => {
    try {
      if (!content || typeof content !== 'string') {
        return { text: '', imageUrl: null };
      }
      
      // Match [IMAGE: ...] where ... can be any characters including base64
      // Strategy: Find [IMAGE: and capture everything until the last ] or end of string
      // For base64, we need to be more careful as it can be very long and might not have closing bracket
      
      // First, try to find [IMAGE: pattern
      const imageStartIndex = content.indexOf('[IMAGE:');
      if (imageStartIndex === -1) {
        return { text: content, imageUrl: null };
      }
      
      // Find the matching closing bracket
      // For base64, we need to find the LAST ] that appears after [IMAGE:
      let bracketIndex = imageStartIndex + 7; // Start after "[IMAGE:"
      let lastBracketIndex = -1;
      
      // Find all closing brackets after [IMAGE:
      for (let i = bracketIndex; i < content.length; i++) {
        if (content[i] === ']') {
          lastBracketIndex = i;
          // Check if there's another [ before this ], which would indicate nested tags
          const nextOpenBracket = content.indexOf('[', bracketIndex);
          if (nextOpenBracket !== -1 && nextOpenBracket < i) {
            // There's a nested tag, use this bracket
            break;
          }
        }
      }
      
      // Extract the image URL
      let imageUrl: string;
      let fullMatch: string;
      
      if (lastBracketIndex === -1) {
        // No closing bracket found - might be base64 that was cut off
        // Try to extract everything after [IMAGE: until end of string or next [
        const nextOpenBracket = content.indexOf('[', bracketIndex);
        const endIndex = nextOpenBracket !== -1 ? nextOpenBracket : content.length;
        imageUrl = content.substring(bracketIndex, endIndex).trim();
        fullMatch = content.substring(imageStartIndex, endIndex);
        
        // If it looks like base64 (starts with data:image/), accept it even without closing bracket
        if (!imageUrl.startsWith('data:image/') && !imageUrl.startsWith('http')) {
          logger.warn('No closing bracket found for [IMAGE: tag and URL does not look valid');
          return { text: content, imageUrl: null };
        }
      } else {
        // Extract the image URL (everything between [IMAGE: and the last ])
        imageUrl = content.substring(bracketIndex, lastBracketIndex).trim();
        fullMatch = content.substring(imageStartIndex, lastBracketIndex + 1);
      }
      
      // Validate and clean image URL
      if (imageUrl) {
          let processedImageUrl = imageUrl.trim();
          
          // Check if it's a base64 data URL
          if (processedImageUrl.startsWith('data:image/')) {
            // Base64 data URL - validate and fix format
            // Ensure it has the proper format: data:image/[type];base64,[data]
            if (!processedImageUrl.includes(';base64,')) {
              // Try to fix common issues - find where base64 starts
              const base64Match = processedImageUrl.match(/data:image\/([^;]+);base64,?(.+)/);
              if (base64Match && base64Match[2]) {
                processedImageUrl = `data:image/${base64Match[1]};base64,${base64Match[2]}`;
              } else {
                // If we can't fix it, it's invalid
                logger.warn('Invalid base64 image URL format:', processedImageUrl.substring(0, 100));
                return { text: content.replace(fullMatch, '').trim(), imageUrl: null };
              }
            }
            
            // Validate base64 data is present and not empty
            let base64Data = processedImageUrl.split(';base64,')[1];
            if (!base64Data || base64Data.trim().length === 0) {
              logger.warn('Empty base64 data in image URL');
              return { text: content.replace(fullMatch, '').trim(), imageUrl: null };
            }
            
            // Clean and fix base64 string
            let trimmedBase64 = base64Data.trim();
            
            // Remove any whitespace, newlines, or invalid characters
            trimmedBase64 = trimmedBase64.replace(/[\s\n\r\t]/g, '');
            
            // Remove any characters that are not valid base64
            trimmedBase64 = trimmedBase64.replace(/[^A-Za-z0-9+\/=]/g, '');
            
            // Check if base64 string is too short (likely incomplete)
            if (trimmedBase64.length < 100) {
              logger.warn('Base64 string seems too short, might be incomplete:', trimmedBase64.length);
              return { text: content.replace(fullMatch, '').trim(), imageUrl: null };
            }
            
            // IMPORTANT: Base64 images should NOT be sent by the bot
            // The bot should only send HTTP/HTTPS URLs from the product data
            // If we receive base64, it's likely an error - log it and reject it
            logger.warn('Received base64 image URL from bot. This should not happen. Bot should only send HTTP/HTTPS URLs.');
            logger.warn('Base64 length:', trimmedBase64.length, 'First 50 chars:', trimmedBase64.substring(0, 50));
            
            // Reject base64 images - the bot should only send HTTP/HTTPS URLs
            return { text: content.replace(fullMatch, '').trim(), imageUrl: null };
          } else if (processedImageUrl.startsWith('http://') || processedImageUrl.startsWith('https://')) {
            // Regular HTTP/HTTPS URL - use as is
            // Validate URL format
            try {
              new URL(processedImageUrl);
              imageUrl = processedImageUrl;
            } catch (e) {
              logger.warn('Invalid HTTP URL format:', processedImageUrl);
              return { text: content.replace(fullMatch, '').trim(), imageUrl: null };
            }
          } else if (processedImageUrl.startsWith('/')) {
            // Relative URL - convert to absolute
            const apiBase = (import.meta as any).env?.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';
            processedImageUrl = `${apiBase}${processedImageUrl}`;
          } else {
            // Invalid URL format - log and skip
            logger.warn('Invalid image URL format:', processedImageUrl.substring(0, 100));
            return { text: content.replace(fullMatch, '').trim(), imageUrl: null };
          }
          
          const textWithoutImage = content.replace(fullMatch, '').trim();
          return { text: textWithoutImage, imageUrl: processedImageUrl };
      }
      
      return { text: content, imageUrl: null };
    } catch (err) {
      logger.error('Error parsing message content:', err);
      return { text: content || '', imageUrl: null };
    }
  };

  if (!settings) return <div className="p-8 text-center text-gray-500">جاري تحميل المحادثة...</div>;

  return (
    <div className="h-[calc(100vh-140px)] flex gap-6 animate-fade-in">
      {/* Chat Container */}
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden relative transition-colors">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center text-brand dark:text-brand">
                <Bot size={20} />
             </div>
             <div>
                <h3 className="font-bold text-gray-800 dark:text-white">بوت المتجر (تجريبي)</h3>
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                   <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> متصل
                </p>
             </div>
          </div>
          <div className="flex items-center gap-2">
             <div className="flex items-center gap-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1">
                <Sparkles size={14} className="text-yellow-500" />
                <select 
                  value={testPersona}
                  onChange={(e) => setTestPersona(e.target.value as BotPersona)}
                  className="text-xs bg-transparent border-none text-gray-600 dark:text-gray-300 focus:outline-none cursor-pointer"
                >
                    <option value="friendly">ودود (Friendly)</option>
                    <option value="formal">رسمي (Formal)</option>
                    <option value="sales">مبيعات (Sales)</option>
                    <option value="fast">سريع (Fast)</option>
                    <option value="luxury">فخم (Luxury)</option>
                </select>
             </div>

             <div className="hidden md:block w-px h-6 bg-gray-200 dark:bg-gray-600 mx-1"></div>

             <select 
               value={botType}
               onChange={(e) => {
                 setBotType(e.target.value as 'products' | 'services');
                 resetChat(); // Reset chat when switching bot type
               }}
               className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 text-gray-600 dark:text-gray-300 focus:outline-none"
             >
                <option value="products">بوت المنتجات</option>
                <option value="services">بوت الخدمات</option>
             </select>

             <div className="hidden md:block w-px h-6 bg-gray-200 dark:bg-gray-600 mx-1"></div>

             <select 
               value={testPlatform}
               onChange={(e) => setTestPlatform(e.target.value as any)}
               className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 text-gray-600 dark:text-gray-300 focus:outline-none"
             >
                <option value="web">Web Chat</option>
                <option value="facebook_messenger">Messenger</option>
                <option value="facebook_comment">Comment</option>
             </select>
             <button onClick={resetChat} className="p-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full" title="إعادة تعيين المحادثة">
               <RefreshCw size={18} />
             </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f0f2f5] dark:bg-gray-900/50">
           {messages.map((msg) => {
             try {
               const { text, imageUrl } = parseMessageContent(msg.content || '');
               
               return (
                 <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : msg.role === 'system' ? 'items-center' : 'items-start'}`}>
                    {/* System Message */}
                    {msg.role === 'system' ? (
                        <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-4 py-2 rounded-full text-xs font-bold shadow-sm my-2 flex items-center gap-2">
                            <Check size={14} />
                            {msg.content || ''}
                        </div>
                    ) : (
                      <>
                          {/* Platform Badge */}
                          {msg.role === 'user' && msg.platform && msg.platform !== 'web' && (
                              <span className="text-[10px] text-gray-400 mb-1 flex items-center gap-1">
                                  {msg.platform === 'facebook_messenger' ? <Facebook size={10} /> : <MessageSquare size={10} />}
                                  {msg.platform === 'facebook_messenger' ? 'Messenger' : 'Comment'}
                              </span>
                          )}
                          
                          <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm ${
                              msg.role === 'user' 
                              ? 'bg-brand text-white rounded-tl-none' 
                              : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-tr-none border border-gray-100 dark:border-gray-600'
                          }`}>
                              <p className="whitespace-pre-wrap text-sm leading-relaxed">{text || ''}</p>
                              {imageUrl && (
                                  <div className="mt-3 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-600">
                                      {imageUrl.startsWith('data:image/') ? (
                                        // For base64 images, use a more robust approach
                                        <div className="relative">
                                          <img 
                                            src={imageUrl} 
                                            alt="Product" 
                                            className="w-full h-auto object-cover max-h-60" 
                                            onError={(e) => {
                                              logger.error('Failed to load base64 image. Length:', imageUrl.length, 'First 100 chars:', imageUrl.substring(0, 100));
                                              const target = e.currentTarget as HTMLImageElement;
                                              
                                              // Try to check if base64 is valid
                                              const base64Part = imageUrl.split(';base64,')[1];
                                              if (base64Part) {
                                                logger.error('Base64 part length:', base64Part.length, 'Ends with:', base64Part.substring(base64Part.length - 10));
                                              }
                                              
                                              target.style.display = 'none';
                                              // Show error message
                                              const parent = target.parentElement;
                                              if (parent && !parent.querySelector('.image-error-message')) {
                                                const errorDiv = document.createElement('div');
                                                errorDiv.className = 'image-error-message text-xs text-red-500 dark:text-red-400 p-2 text-center bg-red-50 dark:bg-red-900/20 rounded';
                                                errorDiv.textContent = 'فشل تحميل الصورة. قد تكون الصورة غير مكتملة أو تالفة.';
                                                parent.appendChild(errorDiv);
                                              }
                                            }}
                                            onLoad={() => {
                                              logger.log('Base64 image loaded successfully. Length:', imageUrl.length);
                                            }}
                                          />
                                        </div>
                                      ) : (
                                        // For regular URLs
                                        <img 
                                          src={imageUrl} 
                                          alt="Product" 
                                          className="w-full h-auto object-cover max-h-60" 
                                          onError={(e) => {
                                            logger.error('Failed to load image URL:', imageUrl);
                                            const target = e.currentTarget as HTMLImageElement;
                                            target.style.display = 'none';
                                            // Show error message
                                            const errorDiv = document.createElement('div');
                                            errorDiv.className = 'text-xs text-red-500 dark:text-red-400 p-2 text-center';
                                            errorDiv.textContent = 'فشل تحميل الصورة';
                                            target.parentElement?.appendChild(errorDiv);
                                          }}
                                          onLoad={() => {
                                            logger.log('Image loaded successfully:', imageUrl.substring(0, 50));
                                          }}
                                        />
                                      )}
                                  </div>
                              )}
                              <span className={`text-[10px] block mt-1 ${msg.role === 'user' ? 'text-brand-200' : 'text-gray-400 dark:text-gray-500'}`}>
                                  {msg.timestamp?.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute:'2-digit' }) || ''}
                              </span>
                          </div>
                      </>
                    )}
                 </div>
               );
             } catch (err) {
               logger.error('Error rendering message:', err);
               return null;
             }
           })}
           {loading && (
             <div className="flex justify-start">
                <div className="bg-white dark:bg-gray-700 px-4 py-3 rounded-2xl rounded-tr-none shadow-sm border border-gray-100 dark:border-gray-600 flex items-center gap-2">
                   <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                   <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s'}}></span>
                   <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s'}}></span>
                </div>
             </div>
           )}
           {error && (
             <div className="flex justify-center my-2">
                <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-2 rounded-full text-xs flex items-center gap-2">
                    <AlertCircle size={14} />
                    {error}
                </div>
             </div>
           )}
           <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
          <div className="relative flex items-center">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="اكتب رسالة لتجربة البوت..." 
              className="w-full pl-12 pr-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand transition-shadow text-gray-800 dark:text-white dark:placeholder-gray-400"
            />
            <button 
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="absolute left-2 p-2 bg-brand text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:hover:bg-brand transition-colors"
            >
              <Send size={18} className={loading ? 'opacity-0' : 'opacity-100'} />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
             <p className="text-xs text-gray-400 flex items-center gap-1">
                يتم الرد بأسلوب: <span className="font-bold text-brand">{personaLabels[testPersona] || 'ودود'}</span>
             </p>
             <button 
                onClick={handleCreateOrder}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all ${
                    orderCreated 
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                    : 'bg-brand-50 text-brand dark:bg-brand-900/30 dark:text-brand hover:bg-brand-100 dark:hover:bg-brand-900/50'
                }`}
                title="محاكاة استلام طلب من العميل"
             >
                {orderCreated ? <Check size={14} /> : <ShoppingCart size={14} />}
                {orderCreated ? 'تم إنشاء الطلب' : 'محاكاة طلب جديد'}
             </button>
          </div>
        </div>
      </div>

      {/* Info Sidebar */}
      <div className="w-80 hidden lg:block space-y-4">
        <div className="bg-brand-900 dark:bg-brand-900 text-white p-6 rounded-2xl shadow-lg">
           <h4 className="font-bold text-lg mb-2">كيف يعمل؟</h4>
           <p className="text-brand-200 text-sm leading-relaxed">
             عندما يسأل العميل عن منتج، يقوم النظام بالبحث في قاعدة بيانات منتجاتك الحالية ويقوم الذكاء الاصطناعي بصياغة الرد المناسب باللغة العربية.
           </p>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
           <h4 className="font-bold text-gray-800 dark:text-white mb-4">عينات أسئلة للتجربة:</h4>
           <ul className="space-y-2">
             {(products || []).slice(0, 3).map(p => (
               <li key={p?.id || Math.random()} 
                   onClick={() => setInput(`كم سعر ${p?.name || 'المنتج'}؟`)}
                   className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                  كم سعر {p?.name || 'المنتج'}؟
               </li>
             ))}
             <li onClick={() => setInput('كم مدة التوصيل؟')}
                 className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
               كم مدة التوصيل؟
             </li>
              <li onClick={() => setInput('هل يمكن الدفع عند الاستلام؟')}
                 className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
               هل يمكن الدفع عند الاستلام؟
             </li>
           </ul>
        </div>
      </div>
    </div>
  );
};

export default BotPlayground;