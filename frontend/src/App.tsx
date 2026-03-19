import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Library from './pages/Library'
import BookDetail from './pages/BookDetail'
import Stats from './pages/Stats'
import Serials from './pages/Serials'
import SerialDetail from './pages/SerialDetail'
import SeriesList from './pages/SeriesList'
import SeriesDetail from './pages/SeriesDetail'
import Settings from './pages/Settings'
import DataManagement from './pages/DataManagement'
import NotFound from './pages/NotFound'
import SetupWizard from './components/SetupWizard'

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
        <SetupWizard onComplete={() => setShowWizard(false)} />
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
          <Route path="settings" element={<Settings />} />
          <Route path="data-management" element={<DataManagement />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
