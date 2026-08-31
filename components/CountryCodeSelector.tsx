import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { COUNTRIES } from '../constants/countries';

interface CountryCodeSelectorProps {
  value: string;
  onChange: (dialCode: string) => void;
  className?: string;
}

const CountryCodeSelector: React.FC<CountryCodeSelectorProps> = ({ value, onChange, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedCountry = COUNTRIES.find(c => c.dialCode === value) || COUNTRIES[0];

  const filteredCountries = COUNTRIES.filter(country =>
    country.nameAr.toLowerCase().includes(searchTerm.toLowerCase()) ||
    country.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    country.dialCode.includes(searchTerm) ||
    country.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (country: typeof COUNTRIES[number]) => {
    onChange(country.dialCode);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 px-2.5 sm:px-3 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none transition-all hover:bg-brand-50/50 w-full sm:w-auto justify-center sm:justify-start"
        aria-label="اختر رمز الدولة"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="text-lg shrink-0" role="img" aria-label={selectedCountry.nameAr}>
          {selectedCountry.flag}
        </span>
        <span className="text-sm font-medium min-w-[3.25rem] sm:min-w-[60px] text-start tabular-nums">
          {selectedCountry.dialCode}
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[140] bg-black/50 sm:hidden"
            aria-hidden="true"
            onClick={() => {
              setIsOpen(false);
              setSearchTerm('');
            }}
          />
          <div
            className="
              fixed z-[150] flex flex-col overflow-hidden rounded-xl border border-brand-100 bg-white shadow-2xl shadow-brand/10
              inset-x-3 top-[max(4.5rem,10dvh)] bottom-[max(1rem,env(safe-area-inset-bottom,0px))]
              sm:absolute sm:inset-x-auto sm:bottom-auto sm:start-0 sm:end-auto sm:top-full sm:z-[100] sm:mt-2
              sm:max-h-96 sm:h-auto sm:w-[min(20rem,calc(100vw-1.5rem))] sm:max-w-[20rem]
            "
            aria-label="اختر رمز الدولة"
          >
            <div className="p-3 border-b border-slate-100 shrink-0">
              <div className="relative">
                <Search
                  size={18}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ابحث عن الدولة..."
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-lg py-2.5 pr-10 pl-3 focus:ring-2 focus:ring-brand/40 focus:border-brand outline-none text-sm placeholder-slate-400"
                  aria-label="ابحث عن الدولة"
                  autoComplete="off"
                  autoCorrect="off"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y">
              {filteredCountries.length > 0 ? (
                <ul role="listbox" className="py-2">
                  {filteredCountries.map((country) => (
                    <li
                      key={country.code}
                      role="option"
                      aria-selected={country.dialCode === value}
                      onClick={() => handleSelect(country)}
                      className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 cursor-pointer transition-colors ${
                        country.dialCode === value
                          ? 'bg-brand-50 text-brand'
                          : 'text-slate-700 active:bg-slate-50 sm:hover:bg-brand-50/60'
                      }`}
                    >
                      <span className="text-lg sm:text-xl shrink-0" role="img" aria-label={country.nameAr}>
                        {country.flag}
                      </span>
                      <div className="flex-1 min-w-0 text-start">
                        <div className="font-medium text-sm truncate">{country.nameAr}</div>
                        <div className="text-xs text-slate-400 truncate">{country.name}</div>
                      </div>
                      <span className="text-sm font-mono text-slate-500 shrink-0 tabular-nums">
                        {country.dialCode}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-8 text-center text-slate-400 text-sm">لا توجد نتائج</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CountryCodeSelector;
