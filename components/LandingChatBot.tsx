
import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Bot, Sparkles } from 'lucide-react';
import apiService from '../services/api';

const LandingChatBot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{role: 'user' | 'bot', text: string}[]>([
    { role: 'bot', text: 'أهلاً بك! 👋 أنا هنا لمساعدتك في معرفة المزيد عن "Xo Bot". كيف يمكنني خدمتك؟' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userText = input;
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setInput('');
    setLoading(true);

    try {
      const result = await apiService.generateSaaSBotResponse(userText, 'marketing');
      setMessages(prev => [...prev, { role: 'bot', text: result.response }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'bot', text: 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end font-sans dir-rtl">
      {/* Chat Window */}
      {isOpen && (
        <div className="mb-4 w-[350px] max-w-[90vw] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col animate-fade-in-up origin-bottom-right h-[500px]">
          {/* Header */}
          <div className="bg-brand p-4 flex justify-between items-center text-white">
             <div className="flex items-center gap-3">
               <div className="bg-white/20 p-2 rounded-xl">
                 <Bot size={20} />
               </div>
               <div>
                 <h3 className="font-bold text-sm">مساعد المبيعات الذكي</h3>
                 <p className="text-[10px] text-brand-100 flex items-center gap-1">
                   <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span> متصل الآن
                 </p>
               </div>
             </div>
             <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1 rounded-full transition-colors">
               <X size={18} />
             </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-3 custom-scrollbar">
             {messages.map((msg, idx) => (
               <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[85%] p-3 text-sm rounded-2xl ${
                   msg.role === 'user' 
                   ? 'bg-brand text-white rounded-tl-none' 
                   : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-tr-none'
                 }`}>
                   {msg.text}
                 </div>
               </div>
             ))}
             {loading && (
               <div className="flex justify-start">
                  <div className="bg-white p-3 rounded-2xl rounded-tr-none shadow-sm border border-gray-100 flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75"></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150"></span>
                  </div>
               </div>
             )}
             <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 bg-white border-t border-gray-100">
             <div className="flex items-center gap-2">
               <input 
                 type="text" 
                 value={input}
                 onChange={(e) => setInput(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                 placeholder="اسألني عن الخدمة..."
                 className="flex-1 bg-gray-100 border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand/40 outline-none text-gray-800"
               />
               <button 
                 onClick={handleSend}
                 disabled={!input.trim() || loading}
                 className="p-2.5 bg-brand text-white rounded-xl hover:bg-brand-600 disabled:opacity-50 transition-colors"
               >
                 <Send size={18} />
               </button>
             </div>
             <p className="text-[10px] text-gray-400 text-center mt-2 flex items-center justify-center gap-1">
               <Sparkles size={10} /> مدعوم بالذكاء الاصطناعي
             </p>
          </div>
        </div>
      )}

      {/* Trigger Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-brand text-white rounded-2xl shadow-lg shadow-brand/35 hover:bg-brand-600 hover:scale-105 transition-all flex items-center justify-center"
      >
        {isOpen ? <X size={28} /> : <MessageCircle size={28} />}
      </button>
    </div>
  );
};

export default LandingChatBot;
