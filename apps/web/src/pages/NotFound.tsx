import { LinkButton } from '../components/ui/Button';
import { Logo } from '../components/ui/Logo';
import { useTitle } from '../lib/hooks';

export default function NotFound() {
  useTitle('Страницата не е намерена');
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div>
        <h1 className="font-display text-3xl font-bold">Страницата не е намерена</h1>
        <p className="mt-2 text-muted">Възможно е линкът да е грешен или ресурсът да е изтрит.</p>
      </div>
      <LinkButton to="/app">Към началото</LinkButton>
    </div>
  );
}
