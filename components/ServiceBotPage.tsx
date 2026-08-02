import React, { useState, useRef, useEffect } from 'react';
import { Service, MerchantSettings, ChatMessage } from '../types';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';
import { Send, Bot, RefreshCw, Briefcase, ChevronRight, MessageCircle } from 'lucide-react';

interface ServiceBotPageProps {
  services: Service[];
  settings: MerchantSettings;
}

const ServiceBotPage: React.FC<ServiceBotPageProps> = ({ services, settings }) => {
  // Safe initialization
  const [messages, setMessages] = useState<ChatMessage[]>([
    { 
      id: '1', 
      role: 'assistant', 
      content: settings?.welcomeMessage || 'مرحباً! كيف يمكنني مساعدتك في استفسارات الخدمات اليوم؟', 
      timestamp: new Date(), 
      platform: 'web' 
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const suggestedQuestions = [
    "ما هي الخدمات المتاحة؟",
    "كم سعر خدمة الحملات الإعلانية؟",
    "كيف أبدأ معكم؟",
    "ماذا يشمل عرض تصميم المواقع؟"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || !settings) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      platform: 'web'
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    try {
      // Get or create conversation
      let currentConversationId = conversationId;
      if (!currentConversationId) {
        try {
          const convResponse = await apiService.getOrCreateConversation('web', 'service-test-user');
          currentConversationId = convResponse.conversation.id;
          setConversationId(currentConversationId);
        } catch (err) {
          logger.error('Error getting or creating conversation:', err);
          // Continue without conversation ID
        }
      }

      // Prepare messages for API
      const apiMessages = newHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Call AI API
      const aiResponse = await apiService.generateChatResponse({
        conversationId: currentConversationId || undefined,
        platform: 'web',
        botType: 'services',
        messages: apiMessages,
        context: {
          services: services || [],
          storeName: settings.storeName
        }
      });

      const responseText = aiResponse.response;
      
      // Update conversation ID if it was created
      if (aiResponse.conversationId && !currentConversationId) {
        setConversationId(aiResponse.conversationId);
      }
      
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        platform: 'web'
      };
      
      setMessages(prev => [...prev, botMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'عذراً، حدث خطأ في النظام. يرجى المحاولة لاحقاً.',
        timestamp: new Date(),
        platform: 'web'
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const resetChat = () => {
    setConversationId(null);
    setMessages([{ 
      id: '1', 
      role: 'assistant', 
      content: settings?.welcomeMessage || 'مرحباً! كيف يمكنني مساعدتك في استفسارات الخدمات اليوم؟', 
      timestamp: new Date(), 
      platform: 'web' 
    }]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!settings) return <div className="p-4 text-center">جاري تحميل الإعدادات...</div>;

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-140px)] gap-6 animate-fade-in">
      
      {/* Services Sidebar */}
      <div className="w-full md:w-72 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden">
         <div className="p-4 bg-brand-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
               <Briefcase size={18} className="text-brand dark:text-brand" />
               قائمة الخدمات المتاحة
            </h3>
         </div>
         <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {services.map((service) => (
               <div key={service.id} 
                    onClick={() => handleSend(`ما هي تفاصيل خدمة ${service.name}؟`)}
                    className="p-3 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-brand-200 dark:hover:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/20 cursor-pointer transition-colors group">
                  <div className="flex justify-between items-center mb-1">
                     <span className="font-bold text-sm text-gray-800 dark:text-white group-hover:text-brand-700 dark:group-hover:text-brand-300">{service.name}</span>
                     <ChevronRight size={14} className="text-gray-400 group-hover:text-brand rtl:rotate-180" />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{service.shortDescription}</p>
               </div>
            ))}
            {services.length === 0 && (
               <div className="text-center py-8 text-gray-400 text-sm">
                  لا توجد خدمات مسجلة.
               </div>
            )}
         </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden relative">
         {/* Header */}
         <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/80">
            <div className="flex items-center gap-3">
               <div className="w-10 h-10 bg-brand-100 dark:bg-brand-900/30 rounded-full flex items-center justify-center text-brand dark:text-brand">
                  <Bot size={20} />
               </div>
               <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">بوت الخدمات الذكي</h3>
                  <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                     <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> متصل - يجيب عن الخدمات
                  </p>
               </div>
            </div>
            <button onClick={resetChat} className="p-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full" title="إعادة تعيين">
               <RefreshCw size={18} />
            </button>
         </div>

         {/* Messages */}
         <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f0f2f5] dark:bg-gray-900/50">
            {messages.map((msg) => (
               <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm text-sm leading-relaxed whitespace-pre-wrap ${
                     msg.role === 'user' 
                     ? 'bg-brand text-white rounded-tl-none' 
                     : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-tr-none border border-gray-100 dark:border-gray-600'
                  }`}>
                     {msg.content}
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1 px-1">
                     {msg.timestamp.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute:'2-digit' })}
                  </span>
               </div>
            ))}
            {loading && (
               <div className="flex justify-start">
                  <div className="bg-white dark:bg-gray-700 px-4 py-3 rounded-2xl rounded-tr-none shadow-sm border border-gray-100 dark:border-gray-600 flex items-center gap-2">
                     <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                     <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></span>
                     <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></span>
                  </div>
               </div>
            )}
            <div ref={messagesEndRef} />
         </div>

         {/* Quick Questions */}
         <div className="px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex gap-2 overflow-x-auto no-scrollbar">
            {suggestedQuestions.map((q, i) => (
               <button 
                  key={i}
                  onClick={() => handleSend(q)}
                  className="whitespace-nowrap px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-brand-50 dark:hover:bg-brand-900/30 text-gray-600 dark:text-gray-300 hover:text-brand dark:hover:text-brand-300 rounded-full text-xs transition-colors border border-transparent hover:border-brand-200 dark:hover:border-brand-700"
               >
                  {q}
               </button>
            ))}
         </div>

         {/* Input */}
         <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
            <div className="relative flex items-center">
               <input 
                  type="text" 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="اكتب سؤالك هنا..." 
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand transition-shadow text-gray-800 dark:text-white dark:placeholder-gray-400"
               />
               <button 
                  onClick={() => handleSend()}
                  disabled={loading || !input.trim()}
                  className="absolute left-2 p-2 bg-brand text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
               >
                  <Send size={18} />
               </button>
            </div>
         </div>
      </div>
    </div>
  );
};

export default ServiceBotPage;