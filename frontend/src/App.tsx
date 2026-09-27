import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'

// Every page except the dashboard is split into its own chunk and loaded on
// first visit, which keeps the initial download small on mobile.
const Library = lazy(() => import('./pages/Library'))
const BookDetail = lazy(() => import('./pages/BookDetail'))
const Stats = lazy(() => import('./pages/Stats'))
const Serials = lazy(() => import('./pages/Serials'))
const SerialDetail = lazy(() => import('./pages/SerialDetail'))
const SeriesList = lazy(() => import('./pages/SeriesList'))
const SeriesDetail = lazy(() => import('./pages/SeriesDetail'))
const Settings = lazy(() => import('./pages/Settings'))
const DataManagement = lazy(() => import('./pages/DataManagement'))
const Lenses = lazy(() => import('./pages/Lenses'))
const LensDetail = lazy(() => import('./pages/LensDetail'))
const NotFound = lazy(() => import('./pages/NotFound'))
const SetupWizard = lazy(() => import('./components/SetupWizard'))

export default function App() {
  const [showWizard, setShowWizard] = useState(false)
  const [wizardChecked, setWizardChecked] = useState(false)

  useEffect(() => {
    fetch('/api/shelves')
      .then((r) => r.json())
      .then((data: unknown[]) => {
        if (Array.isArray(data) && data.length === 0) {
          setShowWizard(true)
        }
      })
      .catch(() => {
        // Non-blocking — skip wizard on error
      })
      .finally(() => setWizardChecked(true))
  }, [])

  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {showWizard && wizardChecked && (
        <Suspense fallback={null}>
          <SetupWizard onComplete={() => setShowWizard(false)} />
        </Suspense>
      )}
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="library" element={<Library />} />
          <Route path="books/:id" element={<BookDetail />} />
          <Route path="stats" element={<Stats />} />
          <Route path="serials" element={<Serials />} />
          <Route path="serials/:id" element={<SerialDetail />} />
          <Route path="series" element={<SeriesList />} />
          <Route path="series/:id" element={<SeriesDetail />} />
          <Route path="lenses" element={<Lenses />} />
          <Route path="lenses/:id" element={<LensDetail />} />
          <Route path="settings" element={<Settings />} />
          <Route path="data-management" element={<DataManagement />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
