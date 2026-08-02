import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, ChevronRight, ChevronDown } from 'lucide-react';
import apiService from '../services/api';

interface DashboardAssistantProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const DashboardAssistant: React.FC<DashboardAssistantProps> = ({ isOpen, onOpenChange }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<{role: 'user' | 'bot', text: string}[]>([
    { role: 'bot', text: 'مرحباً! أنا مساعدك الشخصي في لوحة التحكم. هل تحتاج مساعدة في إعداد المتجر؟' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const quickQuestions = [
    "كيف أضيف منتج جديد؟",
    "طريقة ربط متجر Shopify",
    "كيف أجرب البوت؟"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async (text: string = input) => {
    if (!text.trim()) return;
    
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);

    try {
      const result = await apiService.generateSaaSBotResponse(text, 'support');
      setMessages(prev => [...prev, { role: 'bot', text: result.response }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'bot', text: 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed top-20 md:top-16 left-4 md:left-8 z-40 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[350px] max-w-[calc(100vw-2rem)] overflow-hidden flex flex-col transition-all duration-300 ${isMinimized ? 'h-[60px]' : 'h-[min(500px,calc(100vh-6rem))]'}`}>
      {/* Header */}
      <div 
        className="bg-brand p-4 flex justify-between items-center text-white cursor-pointer"
        onClick={() => setIsMinimized(!isMinimized)}
      >
         <div className="flex items-center gap-2">
           <div className="bg-white/20 p-1.5 rounded-lg">
             <Bot size={18} />
           </div>
           <h3 className="font-bold text-sm">المساعد الذكي</h3>
         </div>
         <div className="flex items-center gap-2">
           {isMinimized ? <ChevronRight size={18} className="rotate-[-90deg]" /> : <ChevronDown size={18} />}
           <button onClick={(e) => { e.stopPropagation(); onOpenChange(false); }} className="hover:bg-white/20 p-1 rounded-full" aria-label="إغلاق المساعد">
             <X size={18} />
           </button>
         </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50 space-y-4 custom-scrollbar">
             {messages.map((msg, idx) => (
               <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[85%] p-3 text-sm rounded-2xl leading-relaxed whitespace-pre-wrap ${
                   msg.role === 'user' 
                   ? 'bg-brand text-white rounded-tl-none' 
                   : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 shadow-sm border border-gray-100 dark:border-gray-700 rounded-tr-none'
                 }`}>
                   {msg.text}
                 </div>
               </div>
             ))}
             {loading && (
               <div className="flex justify-start">
                  <div className="bg-white dark:bg-gray-800 p-3 rounded-2xl rounded-tr-none shadow-sm border border-gray-100 dark:border-gray-700 flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75"></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150"></span>
                  </div>
               </div>
             )}
             <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900/50 flex gap-2 overflow-x-auto no-scrollbar">
             {quickQuestions.map((q, i) => (
               <button 
                 key={i}
                 onClick={() => handleSend(q)}
                 className="whitespace-nowrap px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
               >
                 {q}
               </button>
             ))}
          </div>

          {/* Input */}
          <div className="p-3 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
             <div className="flex items-center gap-2">
               <input 
                 type="text" 
                 value={input}
                 onChange={(e) => setInput(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                 placeholder="كيف يمكنني..."
                 className="flex-1 bg-gray-100 dark:bg-gray-700 border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand/40 outline-none text-gray-800 dark:text-white"
               />
               <button 
                 onClick={() => handleSend()}
                 disabled={!input.trim() || loading}
                 className="p-2.5 bg-brand text-white rounded-xl hover:bg-brand-600 disabled:opacity-50 transition-all"
               >
                 <Send size={18} />
               </button>
             </div>
          </div>
        </>
      )}
    </div>
  );
};

export default DashboardAssistant;
