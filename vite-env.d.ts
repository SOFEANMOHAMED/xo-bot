/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_APP_TITLE?: string;
  // أضف المزيد من متغيرات البيئة هنا حسب الحاجة
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

