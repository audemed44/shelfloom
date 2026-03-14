import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Library from './pages/Library'
import BookDetail from './pages/BookDetail'
import Stats from './pages/Stats'
import Serials from './pages/Serials'
import SeriesList from './pages/SeriesList'
import SeriesDetail from './pages/SeriesDetail'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="library" element={<Library />} />
          <Route path="books/:id" element={<BookDetail />} />
          <Route path="stats" element={<Stats />} />
          <Route path="serials" element={<Serials />} />
          <Route path="series" element={<SeriesList />} />
          <Route path="series/:id" element={<SeriesDetail />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
