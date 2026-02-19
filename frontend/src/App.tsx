import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import RacePage from './pages/RacePage';
import ResultsPage from './pages/ResultsPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<RacePage />} />
          <Route path="/results" element={<ResultsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
