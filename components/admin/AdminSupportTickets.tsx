import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Clock, CheckCircle, XCircle, AlertCircle, Search, Send, ArrowLeft, Image, XCircle as XCircleIcon } from 'lucide-react';
import apiService from '../../services/api';
import { logger } from '../../utils/logger';
import EmojiPicker from '../EmojiPicker';

interface Attachment {
  url: string;
  filename: string;
  mimetype: string;
  size: number;
}

interface SupportTicketReply {
  id: string;
  message: string;
  senderType: 'user' | 'admin';
  senderId: string;
  senderName?: string;
  senderEmail?: string;
  attachments?: Attachment[];
  createdAt: string;
}

interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  adminResponse?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  merchant: {
    id: string;
    email: string;
    name?: string;
  };
  admin?: {
    id: string;
    name?: string;
  } | null;
  replies?: SupportTicketReply[];
}

const AdminSupportTickets: React.FC = () => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ url: string; filename: string; mimetype: string; size: number }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Build messages array from ticket (moved before useEffect to avoid initialization error)
  const buildMessages = React.useCallback((ticket: SupportTicket) => {
    const messages: Array<{
      id: string;
      message: string;
      senderType: 'user' | 'admin';
      senderName: string;
      createdAt: string;
    }> = [];

    // Add original message
    messages.push({
      id: `original-${ticket.id}`,
      message: ticket.message,
      senderType: 'user',
      senderName: ticket.merchant.name || ticket.merchant.email,
      createdAt: ticket.createdAt
    });

    // Add replies
    if (ticket.replies && ticket.replies.length > 0) {
      ticket.replies.forEach(reply => {
        messages.push({
          id: reply.id,
          message: reply.message,
          senderType: reply.senderType,
          senderName: reply.senderType === 'admin' ? (reply.senderName || 'أنت') : (reply.senderName || ticket.merchant.name || ticket.merchant.email),
          createdAt: reply.createdAt
        });
      });
    } else if (ticket.adminResponse) {
      // Legacy admin response
      messages.push({
        id: `admin-response-${ticket.id}`,
        message: ticket.adminResponse,
        senderType: 'admin',
        senderName: ticket.admin?.name || 'أنت',
        createdAt: ticket.updatedAt
      });
    }

    return messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, []);

  useEffect(() => {
    loadTickets();
    loadStats();
  }, [filterStatus, filterPriority, page]);

  useEffect(() => {
    if (selectedTicket) {
      scrollToBottom();
    }
  }, [selectedTicket]);

  // Live updates for selected ticket
  useEffect(() => {
    if (!selectedTicket) return;

    const interval = setInterval(async () => {
      try {
        const updated = await apiService.getSupportTicket(selectedTicket.id);
        const updatedTicket = updated.ticket as any;
        
        if (updatedTicket) {
          const oldMessagesCount = buildMessages(selectedTicket).length;
          const newMessagesCount = buildMessages(updatedTicket).length;
          
          setSelectedTicket(updatedTicket);
          
          // Scroll to bottom if new messages arrived
          if (newMessagesCount > oldMessagesCount) {
            setTimeout(scrollToBottom, 100);
          }
        }
      } catch (error) {
        logger.error('Error updating ticket', error);
      }
    }, 3000); // Update every 3 seconds

    return () => clearInterval(interval);
  }, [selectedTicket, buildMessages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadTickets = async () => {
    setIsLoading(true);
    try {
      const params: any = { page, limit: 20 };
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterPriority !== 'all') params.priority = filterPriority;

      const response = await apiService.getAllSupportTickets(params);
      setTickets(response.tickets);
      setTotalPages(response.pagination.totalPages);
    } catch (error) {
      logger.error('Error loading support tickets', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await apiService.getSupportTicketsStats();
      setStats(response.stats);
    } catch (error) {
      logger.error('Error loading support tickets stats', error);
    }
  };

  const loadSelectedTicket = async (ticketId: string) => {
    try {
      const response = await apiService.getSupportTicket(ticketId);
      setSelectedTicket(response.ticket as any);
    } catch (error) {
      logger.error('Error loading ticket', error);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setError(null);

    try {
      const fileArray = Array.from(files) as File[];
      const response = await apiService.uploadFiles(fileArray);
      
      if (response && response.files) {
        const newAttachments = response.files.map((file: any) => ({
          url: file.url,
          filename: file.filename,
          mimetype: file.mimetype,
          size: file.size
        }));
        setAttachments(prev => [...prev, ...newAttachments]);
      }
    } catch (error: any) {
      logger.error('Error uploading files', error);
      const errorMessage = error?.message || 'فشل رفع الملفات. يرجى المحاولة مرة أخرى.';
      setError(errorMessage);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleEmojiSelect = (emoji: string) => {
    setReplyMessage(prev => prev + emoji);
  };

  const handleReply = async (ticketId: string) => {
    if (!replyMessage.trim() && attachments.length === 0) {
      setError('يرجى إدخال رسالة أو إرفاق ملف');
      return;
    }

    setIsReplying(true);
    setError(null);
    try {
      const response = await apiService.replyToSupportTicket(ticketId, replyMessage, attachments);
      // Response should have reply object
      if (response && (response.reply || response)) {
        setReplyMessage('');
        setAttachments([]);
        // Reload tickets and selected ticket
        await loadTickets();
        if (selectedTicket && selectedTicket.id === ticketId) {
          await loadSelectedTicket(ticketId);
          setTimeout(scrollToBottom, 100);
        }
        await loadStats();
      } else {
        setError('فشل إرسال الرسالة. يرجى المحاولة مرة أخرى.');
      }
    } catch (error: any) {
      logger.error('Error sending reply', error);
      // Try to extract error message from different error formats
      const errorMessage = error?.response?.data?.error?.message 
        || error?.data?.error?.message 
        || error?.message 
        || 'حدث خطأ أثناء إرسال الرسالة. يرجى التحقق من الاتصال والمحاولة مرة أخرى.';
      setError(errorMessage);
    } finally {
      setIsReplying(false);
    }
  };

  const handleUpdateStatus = async (ticketId: string, status: 'open' | 'in_progress' | 'resolved' | 'closed') => {
    try {
      await apiService.updateSupportTicket(ticketId, { status });
      await loadTickets();
      if (selectedTicket && selectedTicket.id === ticketId) {
        await loadSelectedTicket(ticketId);
      }
      await loadStats();
    } catch (error) {
      logger.error('Error updating ticket status', error);
    }
  };

  const handleUpdatePriority = async (ticketId: string, priority: 'low' | 'medium' | 'high' | 'urgent') => {
    try {
      await apiService.updateSupportTicket(ticketId, { priority });
      await loadTickets();
      if (selectedTicket && selectedTicket.id === ticketId) {
        await loadSelectedTicket(ticketId);
      }
    } catch (error) {
      logger.error('Error updating ticket priority', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'resolved':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'closed':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <Clock size={14} />;
      case 'in_progress':
        return <AlertCircle size={14} />;
      case 'resolved':
        return <CheckCircle size={14} />;
      case 'closed':
        return <XCircle size={14} />;
      default:
        return <MessageSquare size={14} />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'عاجلة';
      case 'high':
        return 'عالية';
      case 'medium':
        return 'متوسطة';
      case 'low':
        return 'منخفضة';
      default:
        return priority;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open':
        return 'مفتوحة';
      case 'in_progress':
        return 'قيد المعالجة';
      case 'resolved':
        return 'تم الحل';
      case 'closed':
        return 'مغلقة';
      default:
        return status;
    }
  };

  const filteredTickets = tickets.filter(ticket => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        ticket.subject.toLowerCase().includes(search) ||
        ticket.message.toLowerCase().includes(search) ||
        ticket.merchant.email.toLowerCase().includes(search) ||
        (ticket.merchant.name && ticket.merchant.name.toLowerCase().includes(search))
      );
    }
    return true;
  });

  // If no ticket selected, show list
  if (!selectedTicket) {
    return (
      <div className="space-y-6 animate-fade-in">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">المفتوحة</p>
                  <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mt-2">{stats.open}</p>
                </div>
                <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Clock className="text-blue-600 dark:text-blue-400" size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">قيد المعالجة</p>
                  <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400 mt-2">{stats.inProgress}</p>
                </div>
                <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                  <AlertCircle className="text-yellow-600 dark:text-yellow-400" size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">عاجلة</p>
                  <p className="text-3xl font-bold text-red-600 dark:text-red-400 mt-2">{stats.urgent}</p>
                </div>
                <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
                  <AlertCircle className="text-red-600 dark:text-red-400" size={24} />
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">المجموع</p>
                  <p className="text-3xl font-bold text-gray-600 dark:text-gray-400 mt-2">{stats.total}</p>
                </div>
                <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                  <MessageSquare className="text-gray-600 dark:text-gray-400" size={24} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters and Search */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="ابحث في الرسائل..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pr-10 pl-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setPage(1);
                }}
                className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white"
              >
                <option value="all">جميع الحالات</option>
                <option value="open">مفتوحة</option>
                <option value="in_progress">قيد المعالجة</option>
                <option value="resolved">تم الحل</option>
                <option value="closed">مغلقة</option>
              </select>

              <select
                value={filterPriority}
                onChange={(e) => {
                  setFilterPriority(e.target.value);
                  setPage(1);
                }}
                className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white"
              >
                <option value="all">جميع الأولويات</option>
                <option value="urgent">عاجلة</option>
                <option value="high">عالية</option>
                <option value="medium">متوسطة</option>
                <option value="low">منخفضة</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tickets List */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {isLoading ? (
            <div className="p-12 text-center">
              <div className="inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="mt-4 text-gray-500 dark:text-gray-400">جاري التحميل...</p>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare className="mx-auto text-gray-400" size={48} />
              <p className="mt-4 text-gray-500 dark:text-gray-400">لا توجد رسائل دعم</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[60vh] overflow-y-auto">
                {filteredTickets.map((ticket) => {
                  const messages = buildMessages(ticket);
                  const lastMessage = messages[messages.length - 1];
                  return (
                    <div
                      key={ticket.id}
                      className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">{ticket.subject}</h3>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 flex-shrink-0 ${getStatusColor(ticket.status)}`}>
                              {getStatusIcon(ticket.status)}
                              {getStatusLabel(ticket.status)}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1 truncate">
                            {ticket.merchant.name || ticket.merchant.email}
                          </p>
                          {lastMessage && (
                            <p className="text-sm text-gray-500 dark:text-gray-500 truncate">
                              {lastMessage.message}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
                  >
                    السابق
                  </button>
                  <span className="text-sm text-gray-500">
                    صفحة {page} من {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
                  >
                    التالي
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Chat view
  const messages = buildMessages(selectedTicket);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col animate-fade-in">
      {/* Chat Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            <button
              onClick={() => setSelectedTicket(null)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{selectedTicket.subject}</h2>
                <span className={`px-2 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${getStatusColor(selectedTicket.status)}`}>
                  {getStatusIcon(selectedTicket.status)}
                  {getStatusLabel(selectedTicket.status)}
                </span>
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${getPriorityColor(selectedTicket.priority)}`}>
                  {getPriorityLabel(selectedTicket.priority)}
                </span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {selectedTicket.merchant.name || selectedTicket.merchant.email} • {new Date(selectedTicket.createdAt).toLocaleDateString('ar-SA-u-nu-latn')}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <select
              value={selectedTicket.status}
              onChange={(e) => handleUpdateStatus(selectedTicket.id, e.target.value as 'open' | 'in_progress' | 'resolved' | 'closed')}
              className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
            >
              <option value="open">مفتوحة</option>
              <option value="in_progress">قيد المعالجة</option>
              <option value="resolved">تم الحل</option>
              <option value="closed">مغلقة</option>
            </select>
            <select
              value={selectedTicket.priority}
              onChange={(e) => handleUpdatePriority(selectedTicket.id, e.target.value as 'low' | 'medium' | 'high' | 'urgent')}
              className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
            >
              <option value="low">منخفضة</option>
              <option value="medium">متوسطة</option>
              <option value="high">عالية</option>
              <option value="urgent">عاجلة</option>
            </select>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
        {/* Live indicator */}
        <div className="px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800 flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-xs text-green-700 dark:text-green-300 font-medium">متصل - التحديث التلقائي مفعّل</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, index) => {
            const isAdmin = msg.senderType === 'admin';
            const showAvatar = index === 0 || messages[index - 1].senderType !== msg.senderType;
            
            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isAdmin ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {/* Avatar */}
                {showAvatar && (
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                    isAdmin 
                      ? 'bg-indigo-600 text-white' 
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}>
                    {isAdmin ? (
                      <Send size={20} />
                    ) : (
                      <MessageSquare size={20} />
                    )}
                  </div>
                )}
                {!showAvatar && <div className="w-10"></div>}

                {/* Message Bubble */}
                <div className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'} max-w-[70%]`}>
                  {showAvatar && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 mb-1 px-2">
                      {msg.senderName}
                    </span>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-2 ${
                      isAdmin
                        ? 'bg-indigo-600 text-white rounded-tr-sm'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-tl-sm'
                    }`}
                  >
                    {msg.message && (
                      <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                    )}
                    {msg.attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                      <div className={`space-y-2 ${msg.message ? 'mt-2' : ''}`}>
                        {msg.attachments.map((attachment: any, idx: number) => {
                          // Handle both string and object formats
                          let att: any;
                          try {
                            att = typeof attachment === 'string' ? JSON.parse(attachment) : attachment;
                          } catch (e) {
                            console.error('Error parsing attachment:', e, attachment);
                            return null;
                          }
                          
                          if (!att || !att.url) {
                            console.warn('Invalid attachment:', att);
                            return null;
                          }
                          
                          // Ensure URL is absolute
                          const apiBase = (import.meta as any).env?.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';
                          const imageUrl = att.url.startsWith('http') ? att.url : `${apiBase}${att.url.startsWith('/') ? att.url : '/' + att.url}`;
                          
                          return (
                            <div key={idx}>
                              {att.mimetype && att.mimetype.startsWith('image/') ? (
                                <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="block">
                                  <img 
                                    src={imageUrl} 
                                    alt={att.filename || 'صورة'}
                                    className="max-w-xs max-h-64 rounded-lg cursor-pointer hover:opacity-90 transition-opacity object-contain"
                                    onError={(e) => {
                                      console.error('Image load error:', imageUrl);
                                      const target = e.target as HTMLImageElement;
                                      target.style.display = 'none';
                                      // Show error message
                                      const errorDiv = document.createElement('div');
                                      errorDiv.className = 'text-xs text-red-500 p-2';
                                      errorDiv.textContent = 'فشل تحميل الصورة';
                                      target.parentElement?.appendChild(errorDiv);
                                    }}
                                  />
                                </a>
                              ) : (
                                <a 
                                  href={imageUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                                    isAdmin 
                                      ? 'bg-white/10 hover:bg-white/20' 
                                      : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500'
                                  }`}
                                >
                                  <Image size={20} />
                                  <span className="text-sm truncate">{att.filename || 'ملف'}</span>
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 mt-1 px-2">
                    {new Date(msg.createdAt).toLocaleTimeString('ar-SA-u-nu-latn', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        {selectedTicket.status !== 'closed' && (
          <div className="border-t border-gray-200 dark:border-gray-700 p-4">
            {error && (
              <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
              </div>
            )}
            
            {/* Attachments Preview */}
            {attachments.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachments.map((attachment, index) => (
                  <div key={index} className="relative group">
                    {attachment.mimetype.startsWith('image/') ? (
                      <div className="relative">
                        <img 
                          src={attachment.url} 
                          alt={attachment.filename}
                          className="w-20 h-20 object-cover rounded-lg"
                        />
                        <button
                          onClick={() => removeAttachment(index)}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <XCircleIcon size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="relative bg-gray-100 dark:bg-gray-700 p-2 rounded-lg">
                        <p className="text-xs truncate w-20">{attachment.filename}</p>
                        <button
                          onClick={() => removeAttachment(index)}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <XCircleIcon size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <div className="flex-1 flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || isReplying}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                  aria-label="رفع ملف"
                >
                  {isUploading ? (
                    <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Image size={20} className="text-gray-600 dark:text-gray-400" />
                  )}
                </button>
                <EmojiPicker onEmojiSelect={handleEmojiSelect} />
                <textarea
                  value={replyMessage}
                  onChange={(e) => {
                    setReplyMessage(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleReply(selectedTicket.id);
                    }
                  }}
                  placeholder="اكتب ردك..."
                  className="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  rows={2}
                />
              </div>
              <button
                onClick={() => handleReply(selectedTicket.id)}
                disabled={(!replyMessage.trim() && attachments.length === 0) || isReplying || isUploading}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-colors flex items-center gap-2"
              >
                {isReplying ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Send size={18} />
                    إرسال
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {selectedTicket.status === 'closed' && (
          <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-700/50">
            <p className="text-sm text-center text-gray-500 dark:text-gray-400">
              هذه المحادثة مغلقة ولا يمكن إضافة ردود جديدة
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSupportTickets;
