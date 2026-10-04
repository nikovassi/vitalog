import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { PageSkeleton } from './components/ui/Feedback';

const Landing = lazy(() => import('./pages/Landing'));
const Auth = lazy(() => import('./pages/Auth'));
const PublicShare = lazy(() => import('./pages/PublicShare'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Upload = lazy(() => import('./pages/Upload'));
const Review = lazy(() => import('./pages/Review'));
const Reports = lazy(() => import('./pages/Reports'));
const ReportDetail = lazy(() => import('./pages/ReportDetail'));
const Compare = lazy(() => import('./pages/Compare'));
const Biomarkers = lazy(() => import('./pages/Biomarkers'));
const BiomarkerDetail = lazy(() => import('./pages/BiomarkerDetail'));
const Trends = lazy(() => import('./pages/Trends'));
const Timeline = lazy(() => import('./pages/Timeline'));
const Documents = lazy(() => import('./pages/Documents'));
const Specialists = lazy(() => import('./pages/Specialists'));
const SpecialistDetail = lazy(() => import('./pages/SpecialistDetail'));
const ManualEntry = lazy(() => import('./pages/ManualEntry'));
const Summary = lazy(() => import('./pages/Summary'));
const Share = lazy(() => import('./pages/Share'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));
const NotFound = lazy(() => import('./pages/NotFound'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading, sessionExpired } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-6"><PageSkeleton /></div>;
  if (!me || me.mfaPending) {
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?next=${next}${sessionExpired ? '&expired=1' : ''}`} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl p-6"><PageSkeleton /></div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/register" element={<Auth mode="register" />} />
        <Route path="/forgot" element={<Auth mode="forgot" />} />
        <Route path="/reset" element={<Auth mode="reset" />} />
        <Route path="/verify" element={<Auth mode="verify" />} />
        <Route path="/s/:token" element={<PublicShare />} />
        <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Suspense fallback={<PageSkeleton />}><Dashboard /></Suspense>} />
          {[
            ['upload', <Upload />], ['review/:jobId', <Review />], ['reports', <Reports />], ['reports/:id', <ReportDetail />],
            ['compare', <Compare />], ['biomarkers', <Biomarkers />], ['biomarkers/:key', <BiomarkerDetail />], ['trends', <Trends />],
            ['timeline', <Timeline />], ['documents', <Documents />], ['specialists', <Specialists />], ['specialists/:id', <SpecialistDetail />],
            ['results/new', <ManualEntry />], ['summary', <Summary />], ['share', <Share />], ['settings', <Settings />], ['admin', <Admin />],
          ].map(([path, el]) => (
            <Route key={path as string} path={path as string} element={<Suspense fallback={<PageSkeleton />}>{el}</Suspense>} />
          ))}
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
