import { FileText, Home, ArrowLeft, Globe } from 'lucide-react';
import { useLanguage } from '../i18n';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
}

export function Header({ title, showBack = false, onBack }: HeaderProps) {
  const { language, setLanguage } = useLanguage();

  return (
    <header className="bg-primary-600 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            {showBack && onBack && (
              <button
                onClick={onBack}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <FileText className="w-8 h-8 text-accent-700" />
              <h1 className="text-xl font-bold">{title}</h1>
            </div>
          </div>
          <nav className="flex items-center gap-4">
            <a
              href="/"
              className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <Home className="w-5 h-5" />
              <span className="hidden sm:inline">{language === 'zh' ? '首页' : 'Home'}</span>
            </a>
            <button
              onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
              className="flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors"
              title={language === 'zh' ? 'Switch to English' : '切换到中文'}
            >
              <Globe className="w-5 h-5" />
              <span className="text-sm font-medium">{language === 'zh' ? 'EN' : '中'}</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
}