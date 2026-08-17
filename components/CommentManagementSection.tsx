import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle, MessageSquare, Send } from 'lucide-react';
import { apiService } from '../services/api';
import {
  COMMENT_PUBLIC_REPLY_PRESETS,
  COMMENT_DM_AFTER_PRESETS
} from '../constants/commentReplyPresets';

interface CommentManagementSectionProps {
  facebookConnected: boolean;
  instagramConnected: boolean;
  showNotification?: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  /** Merchant-level Messenger auto-reply */
  autoReplyMessenger: boolean;
  autoReplyComments: boolean;
  /** When false, Messenger / IG DM sales bot toggles are hidden (comments-only plan). */
  hasSalesBot?: boolean;
  onUpdateMerchantSettings: (patch: {
    autoReplyMessenger?: boolean;
    autoReplyComments?: boolean;
  }) => Promise<void>;
}

type PlatformTab = 'facebook' | 'instagram';

const ToggleRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  accentClass?: string;
}> = ({ icon, title, subtitle, checked, onChange, accentClass = 'peer-checked:bg-brand' }) => (
  <div className="flex items-center justify-between p-3 border border-gray-100 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-gray-800 dark:text-gray-200">{title}</p>
        {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
      </div>
    </div>
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div
        className={`w-9 h-5 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all ${accentClass}`}
      />
    </label>
  </div>
);

const CommentManagementSection: React.FC<CommentManagementSectionProps> = ({
  facebookConnected,
  instagramConnected,
  showNotification,
  autoReplyMessenger,
  autoReplyComments,
  hasSalesBot = true,
  onUpdateMerchantSettings
}) => {
  const [platform, setPlatform] = useState<PlatformTab>(
    facebookConnected ? 'facebook' : 'instagram'
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fb, setFb] = useState({
    sendDmOnComment: false,
    commentReplyTemplate: '',
    commentDmTemplate: ''
  });
  const [ig, setIg] = useState({
    autoReplyComments: true,
    autoReplyDM: true,
    sendDmOnComment: true,
    commentReplyTemplate: '',
    commentDmTemplate: ''
  });
  const [presetNonce, setPresetNonce] = useState({ reply: 0, dm: 0 });

  const notify = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (showNotification) showNotification(msg, type);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const integrations = await apiService.getIntegrations();
      if (integrations.facebook?.isConnected) {
        setFb({
          sendDmOnComment: integrations.facebook.sendDmOnComment ?? false,
          commentReplyTemplate: integrations.facebook.commentReplyTemplate || '',
          commentDmTemplate: integrations.facebook.commentDmTemplate || ''
        });
      }
      if (integrations.instagram?.isConnected) {
        setIg({
          autoReplyComments: integrations.instagram.autoReplyComments ?? true,
          autoReplyDM: integrations.instagram.autoReplyDM ?? true,
          sendDmOnComment: integrations.instagram.sendDmOnComment ?? true,
          commentReplyTemplate: integrations.instagram.commentReplyTemplate || '',
          commentDmTemplate: integrations.instagram.commentDmTemplate || ''
        });
      }
    } catch (e: any) {
      notify(e?.message || 'فشل تحميل إعدادات التعليقات', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (platform === 'facebook' && !facebookConnected && instagramConnected) {
      setPlatform('instagram');
    } else if (platform === 'instagram' && !instagramConnected && facebookConnected) {
      setPlatform('facebook');
    }
  }, [platform, facebookConnected, instagramConnected]);

  const saveFbTemplates = async () => {
    setSaving(true);
    try {
      await apiService.updateFacebookCommentSettings({
        commentReplyTemplate: fb.commentReplyTemplate,
        commentDmTemplate: fb.commentDmTemplate,
        sendDmOnComment: fb.sendDmOnComment
      });
      notify('تم حفظ قوالب تعليقات فيسبوك', 'success');
    } catch (e: any) {
      notify(e?.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveIgTemplates = async () => {
    setSaving(true);
    try {
      await apiService.updateInstagramSettings({
        commentReplyTemplate: ig.commentReplyTemplate,
        commentDmTemplate: ig.commentDmTemplate
      });
      notify('تم حفظ قوالب تعليقات إنستغرام', 'success');
    } catch (e: any) {
      notify(e?.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleFbSendDm = async (checked: boolean) => {
    const prev = fb.sendDmOnComment;
    setFb((s) => ({ ...s, sendDmOnComment: checked }));
    try {
      await apiService.updateFacebookCommentSettings({ sendDmOnComment: checked });
    } catch {
      setFb((s) => ({ ...s, sendDmOnComment: prev }));
      notify('فشل حفظ الإعداد', 'error');
    }
  };

  const toggleIg = async (
    key: 'autoReplyComments' | 'autoReplyDM' | 'sendDmOnComment',
    value: boolean
  ) => {
    const prev = { ...ig };
    setIg((s) => ({ ...s, [key]: value }));
    try {
      await apiService.updateInstagramSettings({ [key]: value });
    } catch {
      setIg(prev);
      notify('فشل حفظ إعداد إنستغرام', 'error');
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">جاري التحميل…</div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-5 border-b border-gray-100 dark:border-gray-700">
        <h3 className="font-bold text-gray-900 dark:text-white text-lg">إدارة التعليقات</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          تفعيل الردود التلقائية وقوالب الرد العام والرسالة الخاصة بعد التعليق.
        </p>
        <div className="flex gap-2 mt-4">
          {facebookConnected && (
            <button
              type="button"
              onClick={() => setPlatform('facebook')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                platform === 'facebook'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
              }`}
            >
              فيسبوك
            </button>
          )}
          {instagramConnected && (
            <button
              type="button"
              onClick={() => setPlatform('instagram')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                platform === 'instagram'
                  ? 'bg-pink-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
              }`}
            >
              إنستغرام
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {platform === 'facebook' && facebookConnected && (
          <>
            <div className="space-y-3">
              {hasSalesBot && (
                <ToggleRow
                  icon={<MessageCircle size={16} className="text-brand" />}
                  title="الرد على Messenger"
                  checked={autoReplyMessenger}
                  onChange={(v) => onUpdateMerchantSettings({ autoReplyMessenger: v })}
                />
              )}
              <ToggleRow
                icon={<MessageCircle size={16} className="text-green-600" />}
                title="الرد على التعليقات"
                checked={autoReplyComments}
                onChange={(v) => onUpdateMerchantSettings({ autoReplyComments: v })}
                accentClass="peer-checked:bg-green-500"
              />
              <ToggleRow
                icon={<Send size={16} className="text-orange-600" />}
                title="رسالة خاصة بعد التعليق"
                subtitle="إرسال DM تلقائي بعد كل تعليق على المنشورات"
                checked={fb.sendDmOnComment}
                onChange={toggleFbSendDm}
                accentClass="peer-checked:bg-orange-500"
              />
            </div>

            <div className="rounded-xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/30 dark:bg-slate-900/40 p-4 space-y-3">
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                ردود التعليقات الثابتة (وضع القالب العام). اترك الحقل فارغاً للنص الافتراضي. يمكنك استخدام{' '}
                <code className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1 rounded">{'{{name}}'}</code> و{' '}
                <code className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1 rounded">{'{{comment}}'}</code>.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  نص الرد على التعليق (يظهر للعامة)
                </label>
                <select
                  key={`fb-r-${presetNonce.reply}`}
                  className="w-full mb-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 py-2 px-3"
                  value=""
                  onChange={(e) => {
                    const p = COMMENT_PUBLIC_REPLY_PRESETS.find((x) => x.id === e.target.value);
                    if (!p) return;
                    setFb((s) => ({ ...s, commentReplyTemplate: p.body }));
                    setPresetNonce((n) => ({ ...n, reply: n.reply + 1 }));
                  }}
                >
                  <option value="">— إدراج قالب جاهز لرد التعليق —</option>
                  {COMMENT_PUBLIC_REPLY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={fb.commentReplyTemplate}
                  onChange={(e) => setFb((s) => ({ ...s, commentReplyTemplate: e.target.value }))}
                  rows={3}
                  maxLength={2000}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-3"
                  placeholder="اكتب ردك أو اختر قالباً أعلاه…"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  نص الرسالة الخاصة بعد التعليق
                </label>
                <select
                  key={`fb-d-${presetNonce.dm}`}
                  className="w-full mb-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 py-2 px-3"
                  value=""
                  onChange={(e) => {
                    const p = COMMENT_DM_AFTER_PRESETS.find((x) => x.id === e.target.value);
                    if (!p) return;
                    setFb((s) => ({ ...s, commentDmTemplate: p.body }));
                    setPresetNonce((n) => ({ ...n, dm: n.dm + 1 }));
                  }}
                >
                  <option value="">— إدراج قالب جاهز للرسالة الخاصة —</option>
                  {COMMENT_DM_AFTER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={fb.commentDmTemplate}
                  onChange={(e) => setFb((s) => ({ ...s, commentDmTemplate: e.target.value }))}
                  rows={3}
                  maxLength={2000}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-3"
                  placeholder="رسالة الترحيب في الخاص…"
                />
              </div>
              <button
                type="button"
                onClick={saveFbTemplates}
                disabled={saving}
                className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60"
              >
                {saving ? 'جاري الحفظ…' : 'حفظ قوالب التعليقات (فيسبوك)'}
              </button>
            </div>
          </>
        )}

        {platform === 'instagram' && instagramConnected && (
          <>
            <div className="space-y-3">
              <ToggleRow
                icon={<MessageCircle size={16} className="text-pink-600" />}
                title="الرد على التعليقات"
                checked={ig.autoReplyComments}
                onChange={(v) => toggleIg('autoReplyComments', v)}
                accentClass="peer-checked:bg-pink-500"
              />
              <ToggleRow
                icon={<Send size={16} className="text-orange-600" />}
                title="إرسال رسالة بعد التعليق"
                subtitle="رسالة مباشرة تلقائية بعد أي تعليق"
                checked={ig.sendDmOnComment}
                onChange={(v) => toggleIg('sendDmOnComment', v)}
                accentClass="peer-checked:bg-orange-500"
              />
              {hasSalesBot && (
                <ToggleRow
                  icon={<MessageSquare size={16} className="text-brand" />}
                  title="الرد على الرسائل المباشرة"
                  checked={ig.autoReplyDM}
                  onChange={(v) => toggleIg('autoReplyDM', v)}
                />
              )}
            </div>

            <div className="rounded-xl border border-pink-100 dark:border-pink-900/40 bg-pink-50/30 dark:bg-slate-900/40 p-4 space-y-3">
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                ردود تعليقات ثابتة. فارغ = الافتراضي. استخدم{' '}
                <code className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1 rounded">{'{{name}}'}</code> و{' '}
                <code className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1 rounded">{'{{comment}}'}</code>.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  نص الرد على التعليق
                </label>
                <select
                  key={`ig-r-${presetNonce.reply}`}
                  className="w-full mb-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 py-2 px-3"
                  value=""
                  onChange={(e) => {
                    const p = COMMENT_PUBLIC_REPLY_PRESETS.find((x) => x.id === e.target.value);
                    if (!p) return;
                    setIg((s) => ({ ...s, commentReplyTemplate: p.body }));
                    setPresetNonce((n) => ({ ...n, reply: n.reply + 1 }));
                  }}
                >
                  <option value="">— إدراج قالب جاهز لرد التعليق —</option>
                  {COMMENT_PUBLIC_REPLY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={ig.commentReplyTemplate}
                  onChange={(e) => setIg((s) => ({ ...s, commentReplyTemplate: e.target.value }))}
                  rows={3}
                  maxLength={2000}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-3"
                  placeholder="اكتب ردك أو اختر قالباً…"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  نص الرسالة الخاصة بعد التعليق
                </label>
                <select
                  key={`ig-d-${presetNonce.dm}`}
                  className="w-full mb-2 text-xs rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 py-2 px-3"
                  value=""
                  onChange={(e) => {
                    const p = COMMENT_DM_AFTER_PRESETS.find((x) => x.id === e.target.value);
                    if (!p) return;
                    setIg((s) => ({ ...s, commentDmTemplate: p.body }));
                    setPresetNonce((n) => ({ ...n, dm: n.dm + 1 }));
                  }}
                >
                  <option value="">— إدراج قالب جاهز للرسالة الخاصة —</option>
                  {COMMENT_DM_AFTER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={ig.commentDmTemplate}
                  onChange={(e) => setIg((s) => ({ ...s, commentDmTemplate: e.target.value }))}
                  rows={3}
                  maxLength={2000}
                  className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-3"
                  placeholder="رسالة الترحيب في الخاص…"
                />
              </div>
              <button
                type="button"
                onClick={saveIgTemplates}
                disabled={saving}
                className="w-full py-2 rounded-lg bg-gradient-to-r from-pink-500 to-orange-400 hover:from-pink-600 hover:to-orange-500 text-white text-sm font-medium disabled:opacity-60"
              >
                {saving ? 'جاري الحفظ…' : 'حفظ قوالب التعليقات (إنستغرام)'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CommentManagementSection;
